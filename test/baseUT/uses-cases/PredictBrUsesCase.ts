import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {CoreContractsHelper} from "../helpers/CoreContractsHelper";
import {Controller, IERC20__factory, IERC20Extended__factory, IPlatformAdapter} from "../../../typechain";
import {BigNumber} from "ethers";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {areAlmostEqual} from "../utils/CommonUtils";

export interface IPlatformActor {
  getAvailableLiquidity: () => Promise<BigNumber>,
  getCurrentBR: () => Promise<BigNumber>,
  supplyCollateral: (collateralAmount: BigNumber) => Promise<void>,
  borrow: (borrowAmount: BigNumber) => Promise<void>,
}

/**
 * We are going to borrow some amount.
 * 1. Get predicted borrow
 * 2. Borrow amount
 * 3. Get borrow rate after the borrow.
 * 4. Ensure, that predicted borrow rate is almost the same as predicted.
 * The amounts are almost equal, not exactly, because predicted borrow rate
 * doesn't take into account interest that appears between borrow moment and getting-borrow-rate moment
 */
export class PredictBrUsesCase {
  static async makeTest(
    deployer: SignerWithAddress,
    actor: IPlatformActor,
    platformAdapterFabric: (controller: Controller) => Promise<IPlatformAdapter>,
    collateralAsset: string,
    borrowAsset: string,
    collateralHolders: string[],
    part10000: number
  ) : Promise<{br: BigNumber, brPredicted: BigNumber}> {
    console.log(`collateral ${collateralAsset} borrow ${borrowAsset}`);

    const controller = await CoreContractsHelper.createController(deployer);
    const platformAdapter = await platformAdapterFabric(controller);

    // get available liquidity
    // we are going to borrow given part of the liquidity
    //                 [available liquidity] * percent100 / 100
    const availableLiquidity = await actor.getAvailableLiquidity();
    console.log(`Available liquidity ${availableLiquidity.toString()}`);

    const amountToBorrow = availableLiquidity.mul(part10000).div(10000);
    console.log(`Try to borrow ${amountToBorrow.toString()}`);

    // we assume, that total amount of collateral on holders accounts should be enough to borrow required amount
    for (const h of collateralHolders) {
      const cAsH = IERC20Extended__factory.connect(collateralAsset, await DeployerUtils.startImpersonate(h));
      await cAsH.transfer(deployer.address, await cAsH.balanceOf(h) );
    }
    const collateralAmount = await IERC20Extended__factory.connect(collateralAsset, deployer)
      .balanceOf(deployer.address);
    console.log(`Collateral balance ${collateralAmount}`);

    // before borrow
    const brBefore = await actor.getCurrentBR();
    const brPredicted = await platformAdapter.getBorrowRateAfterBorrow(borrowAsset, amountToBorrow);
    console.log(`Current BR=${brBefore.toString()} predicted BR=${brPredicted.toString()}`);

    // supply collateral
    await actor.supplyCollateral(collateralAmount);

    // borrow
    console.log(`borrow ${borrowAsset} amount ${amountToBorrow}`);
    await actor.borrow(amountToBorrow);

    const availableLiquidityAfter = await actor.getAvailableLiquidity();
    console.log(`Available liquidity AFTER ${availableLiquidity.toString()}`);
    const brAfter = await actor.getCurrentBR();
    const brPredictedAfter = await platformAdapter.getBorrowRateAfterBorrow(borrowAsset, 0);
    console.log(`Current BR=${brAfter.toString()} predicted BR=${brPredictedAfter.toString()}`);

    return {br: brAfter, brPredicted};
  }
}