import {
  Borrower,
  Controller,
  IERC20Metadata
} from "../../typechain";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {BigNumber} from "ethers";
import {BalanceUtils} from "../../test/baseUT/utils/BalanceUtils";
import {TimeUtils} from "../utils/TimeUtils";


export interface IEmulationCommand {
  command: string;
  user: string;
  asset1: string;
  asset2: string;
  amount: string;
  holder: string;
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

/**
 * Create 3 users, use 4 assets.
 * Try to borrow and repay various amounts several times according to the CSV-list of commands.
 * Check balances after each command and save results to result CSV file.
 */
export class EmulateWork {
  controller: Controller;
  public users: Borrower[];
  public assets: IERC20Metadata[];

  constructor(
    controller: Controller,
    users: Borrower[],
    assets: IERC20Metadata[]
  ) {
    this.controller = controller;
    this.users = users;
    this.assets = assets;
  }

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
          command.holder
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
}