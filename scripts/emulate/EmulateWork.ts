import {
  Borrower,
  Controller, IChangePriceForTests__factory, IDebtMonitor__factory,
  IERC20Metadata, IKeeperCallback__factory, IPlatformAdapter__factory
} from "../../typechain";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {BigNumber} from "ethers";
import {BalanceUtils} from "../../test/baseUT/utils/BalanceUtils";
import {TimeUtils} from "../utils/TimeUtils";
import {DeployerUtils} from "../utils/DeployerUtils";

//region Data types
export interface IEmulationCommand {
  command: string;
  /**
   * User id OR contract name.
   * Users have the following ids: 1, 2, 3.
   * Valid contract names are specified in this.contractAddresses
   */
  user: string;
  asset1: string;
  asset2: string;
  amount: string;
  /**
   * Arbitrary parameters.
   * I.e. it contains "holder" address in "deposit" command
   *      and "price-change-multiplier100" in "price" command
   */
  value: string;
  pauseInBlocks: string;
}

export interface IUserResult {
  /** Parsed amounts (without decimals) of the assets (in same order as EmulateWork.assets) */
  assetBalances: string[]
}

export interface IEmulationCommandResult {
  userResults: IUserResult[];
  /** For borrow command only: the converter that was used for the borrowing */
  converter?: string;
}
//endregion Data types

/**
 * Create 3 users, use 4 assets.
 * Try to borrow and repay various amounts several times according to the CSV-list of commands.
 * Check balances after each command and save results to result CSV file.
 *
 * Supported commands
 *    deposit: put some amount on borrower's balance
 *    borrow: borrow amount in TetuConverter
 *    repay: make partial or full repay of the borrow
 *    freeze/unfreeze: freeze/unfreeze given lending platform in TetuConverter
 *    price: call IChangePriceForTests.changePrice on the given price oracle mock
 *    rebalance: work as a keeper: call DebtMonitor.changeHealth and TetuConverter.requireRepay if necessary
 */
export class EmulateWork {
  controller: Controller;
  public users: Borrower[];
  public assets: IERC20Metadata[];
  /**
   * List of contracts
   *    name : address
   * Name allows to get address of the contract.
   * Contract interface is detected by command title.
   * I.e. for "freeze" command contract is platform adapter.
   */
  public contractAddresses: Map<string, string>;

  constructor(
    controller: Controller,
    users: Borrower[],
    assets: IERC20Metadata[],
    contractAddresses: Map<string, string>
  ) {
    this.controller = controller;
    this.users = users;
    this.assets = assets;
    this.contractAddresses = contractAddresses;
  }

//region Main
  public async executeCommand(command: IEmulationCommand) : Promise<IEmulationCommandResult> {
    const user = await this.getUser(command.user);
    const asset1 = await this.getAsset(command.asset1);
    let converter: string | undefined;

    switch (command.command) {
      case "deposit":
        await this.executeDeposit(
          user,
          asset1,
          await this.getAmount(command.amount, asset1),
          command.value
        );
        break;
      case "borrow":
        converter = await this.executeBorrow(
          user,
          asset1,
          await this.getAsset(command.asset2),
          await this.getAmount(command.amount, await this.getAsset(command.asset2))
        );
        break;
      case "repay":
        await this.executeRepay(
          user,
          asset1,
          await this.getAsset(command.asset2),
          await this.getAmountOptional(command.amount, await this.getAsset(command.asset2))
        );
        break;
      case "freeze":
      case "unfreeze":
        await this.executeFreeze(command.user, command.command === "freeze");
        break;
      case "price":
        await this.executeChangePrice(command.user, command.asset1, command.value);
        break;
      case "keeper":
        await this.executeRebalance();
        break;
      default:
        throw Error(`Undefined command ${command.command}`);
    }
    if (command.pauseInBlocks) {
      const blocks = Number(command.pauseInBlocks);
      await TimeUtils.advanceNBlocks(blocks);
    }

    return {
      userResults: await this.getResultBalances(),
      converter
    };
  }

  public async getResultBalances() : Promise<IUserResult[]> {
    return Promise.all(
        this.users.map(async user => {
            const userResult: IUserResult = {
              assetBalances: await Promise.all(
                this.assets.map(async asset => {
                    return formatUnits(await asset.balanceOf(user.address), await asset.decimals());
                })
              )}
            return userResult;
          }
        )
      );
  }
//endregion Main

//region Commands
  /** Transfer the amount from the holder's balance to the user's balance */
  public async executeDeposit(user: Borrower, asset: IERC20Metadata, amount: BigNumber, holder: string) {
    await BalanceUtils.getRequiredAmountFromHolders(amount, asset, [holder], user.address);
  }

  /** Make a borrow, returns converter address */
  public async executeBorrow(
    user: Borrower,
    asset1: IERC20Metadata,
    asset2: IERC20Metadata,
    amount: BigNumber
  ) : Promise<string> {
    const dest = await user.callStatic.borrowMaxAmount(asset1.address, amount, asset2.address, user.address);
    await user.borrowMaxAmount(asset1.address, amount, asset2.address, user.address);
    return dest.converterOut;
  }

  /** Make full or complete repay */
  public async executeRepay(user: Borrower, asset1: IERC20Metadata, asset2: IERC20Metadata, amount?: BigNumber) {
    if (amount) {
      await user.makeRepayPartial(asset1.address, asset2.address, user.address, amount);
    } else {
      await user.makeRepayComplete(asset1.address, asset2.address, user.address);
    }
  }

  /** Freeze or unfreeze borrowing on the given lending platform */
  public async executeFreeze(platformAdapterName: string, freeze: boolean) {
    const platformAdapterAddress = this.contractAddresses.get(`${platformAdapterName}:platformAdapter`);
    if (platformAdapterAddress) {
      await IPlatformAdapter__factory.connect(
        platformAdapterAddress,
        await DeployerUtils.startImpersonate(await this.controller.governance())
      ).setFrozen(freeze);
    } else {
      throw Error(`Cannot find address of platform adapter for ${platformAdapterName}`);
    }
  }

  /** Multiple a price of the asset1 on (multiplier100/100) in all price oracle mocks */
  public async executeChangePrice(platformAdapterName: string, asset1: string, multiplier100: string) {
    const platformAdapterAddress = this.contractAddresses.get(`${platformAdapterName}:priceOracle`);
    if (platformAdapterAddress) {
      await IChangePriceForTests__factory.connect(
        platformAdapterAddress,
        await DeployerUtils.startImpersonate(await this.controller.governance())
      ).changePrice(asset1, multiplier100);
    } else {
      throw Error(`Cannot find address of platform adapter for ${platformAdapterName}`);
    }
  }

  /**
   * call DebtMonitor.changeHealth (read-only)
   * than call TetuConverter.requireRepay (writable) if necessary
   *
   * For simplicity, we make direct calls to DebtMonitor and TetuConverter,
   * and fix only one unhealthy adapter per call
   */
  public async executeRebalance() {
    const keeper = await this.controller.keeper();
    const ret = await IDebtMonitor__factory.connect(
      await this.controller.debtMonitor(),
      await DeployerUtils.startImpersonate(keeper)
    ).checkHealth(0, 1000, 1);

    if (ret.outPoolAdapters.length) {
      await IKeeperCallback__factory.connect(
        await this.controller.tetuConverter(),
        await DeployerUtils.startImpersonate(keeper)
      ).requireRepay(
        ret.outAmountBorrowAsset[0],
        ret.outAmountCollateralAsset[0],
        ret.outPoolAdapters[0]
      );
    }
  }
//endregion Commands

//region Utils
  public async getAmount(amount: string, asset: IERC20Metadata): Promise<BigNumber> {
    return parseUnits(amount, await asset.decimals());
  }
  public async getAmountOptional(amount: string, asset: IERC20Metadata): Promise<BigNumber | undefined> {
    return amount
      ? parseUnits(amount, await asset.decimals())
      : undefined;
  }

  public async getUser(user: string): Promise<Borrower> {
    const userNum1 = Number(user);
    if (userNum1 <= 0 || userNum1 > this.users.length) {
      throw Error(`Incorrect user id ${user}`);
    }
    return this.users[userNum1 - 1];
  }

  public async getAsset(assetName: string): Promise<IERC20Metadata> {
    for (const asset of this.assets) {
      const name = await asset.symbol();
      if (name.toUpperCase() === assetName.toUpperCase()) {
        return asset;
      }
    }
    throw Error(`Unsupported asset ${assetName}`)
  }
//endregion Utils
}