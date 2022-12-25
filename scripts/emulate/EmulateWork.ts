import {
  Borrower,
  Controller,
  IERC20Metadata,
  IERC20Metadata__factory
} from "../../typechain";
import {MaticAddresses} from "../addresses/MaticAddresses";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {BigNumber} from "ethers";
import {BalanceUtils} from "../../test/baseUT/utils/BalanceUtils";


interface ICommand {
  command: string;
  user: string;
  asset1: string;
  asset2: string;
  amount: string;
  holder: string;
  pause: string;
  blocks: string;
}

interface IUserResult {
  usdcBalance: string;
  usdtBalance: string;
  daiBalance: string;
  wethBalance: string;
}

interface ICommandResult {
  userResults?: IUserResult[];
  error?: string;
}

/**
 * Create 3 users, use 4 assets.
 * Try to borrow and repay various amounts several times according to the CSV-list of commands.
 * Check balances after each command and save results to result CSV file.
 */
export class EmulateWork {
  controller: Controller;
  users: Borrower[];
  usdc: IERC20Metadata;
  usdt: IERC20Metadata;
  dai: IERC20Metadata;
  weth: IERC20Metadata;

  constructor(
    controller: Controller,
    users: Borrower[],
  ) {
    this.controller = controller;
    this.users = users;

    this.usdc = IERC20Metadata__factory.connect(MaticAddresses.USDC, this.controller.signer);
    this.usdt = IERC20Metadata__factory.connect(MaticAddresses.USDT, this.controller.signer);
    this.dai = IERC20Metadata__factory.connect(MaticAddresses.DAI, this.controller.signer);
    this.weth = IERC20Metadata__factory.connect(MaticAddresses.WETH, this.controller.signer);
  }

  public async executeCommand(command: ICommand) : Promise<ICommandResult> {
    try {
      const user = await this.getUser(command.user);
      const asset1 = await this.getAsset(command.asset1);
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
          await this.executeBorrow(
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
    } catch (e: any) {
      console.log(e);
      const re = /VM Exception while processing transaction: reverted with reason string\s*(.*)/i;
      if (e.message) {
        const found = e.message.match(re);
        console.log("found", found)
        if (found && found[1]) {
          return {
            error: found[1]
          }
        }
      }
      return {
        error: "Unknown error"
      }
    }

    return await this.getResultBalances()
  }

  public async getResultBalances() : Promise<ICommandResult> {
    return {
      userResults: await Promise.all(
        this.users.map(async user => {
          const userResult: IUserResult = {
            daiBalance: formatUnits(await this.dai.balanceOf(user.address), await this.dai.decimals()),
            usdcBalance: formatUnits(await this.usdc.balanceOf(user.address), await this.usdc.decimals()),
            usdtBalance: formatUnits(await this.usdt.balanceOf(user.address), await this.usdt.decimals()),
            wethBalance: formatUnits(await this.weth.balanceOf(user.address), await this.weth.decimals()),
          }
          return userResult;
        })
      )
    }
  }

  /** Transfer the amount from the holder's balance to the user's balance */
  public async executeDeposit(user: Borrower, asset: IERC20Metadata, amount: BigNumber, holder: string) {
    await BalanceUtils.getRequiredAmountFromHolders(amount, asset, [holder], user.address);
  }

  /** Make a borrow */
  public async executeBorrow(user: Borrower, asset1: IERC20Metadata, asset2: IERC20Metadata, amount: BigNumber) {
    await user.borrowMaxAmount(asset1.address, amount, asset2.address, user.address);
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
    if (userNum1 <= 0 || userNum1 >= this.users.length) {
      throw Error(`Incorrect user id ${user}`);
    }
    return this.users[userNum1];
  }

  public static async getAssetAddress(assetName: string): Promise<string> {
    switch (assetName.toUpperCase()) {
      case "USDC": return MaticAddresses.USDC;
      case "USDT": return MaticAddresses.USDT;
      case "DAI": return MaticAddresses.DAI;
      case "WETH": return MaticAddresses.WETH;
    }

    throw Error(`Unsupported asset ${assetName}`)
  }

  public async getAsset(assetName: string): Promise<IERC20Metadata> {
    const assetAddress = await EmulateWork.getAssetAddress(assetName);
    return IERC20Metadata__factory.connect(assetAddress, this.controller.signer);
  }
}