import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {IERC20Metadata__factory} from "../../../../typechain";
import {BigNumber} from "ethers";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {IPlatformActor} from "../../types/IPlatformActor";

export interface IPredictBrParams {
  collateralAsset: string;
  borrowAsset: string;
  collateralHolders: string[];
  part10000: number;
}

export interface IPredictBrResults {
  br: BigNumber;
  brPredicted: BigNumber;
}

/**
 * We are going to borrow some amount.
 * 1. Get predicted borrow
 * 2. Borrow amount
 * 3. Get borrow rate after the borrow.
 * 4. Ensure, that the real borrow rate is almost the same as predicted.
 *
 * The amounts are almost equal, not exactly, because predicted borrow rate
 * doesn't take into account interest that appears between borrow moment and getting-borrow-rate moment
 */
export class PredictBrUsesCase {
  static async predictBrTest(signer: SignerWithAddress, actor: IPlatformActor, p: IPredictBrParams) : Promise<IPredictBrResults> {
    // get available liquidity, we are going to borrow given part of the liquidity
    //                 [available liquidity] * percent100 / 100
    const availableLiquidity = await actor.getAvailableLiquidity();
    const amountToBorrow = availableLiquidity.mul(p.part10000).div(10000);

    // we assume, that total amount of collateral on holders accounts should be enough to borrow required amount
    for (const h of p.collateralHolders) {
      const cAsH = IERC20Metadata__factory.connect(p.collateralAsset, await DeployerUtils.startImpersonate(h));
      await cAsH.transfer(signer.address, await cAsH.balanceOf(h));
    }
    const collateralAmount = await IERC20Metadata__factory.connect(p.collateralAsset, signer).balanceOf(signer.address);

    // before borrow
    const brBefore = await actor.getCurrentBR();
    const brPredicted = await actor.getBorrowRateAfterBorrow(p.borrowAsset, amountToBorrow);
    console.log(`Current BR=${brBefore.toString()} predicted BR=${brPredicted.toString()}`);

    // supply collateral
    await actor.supplyCollateral(collateralAmount);

    // borrow
    await actor.borrow(amountToBorrow);

    const brAfter = await actor.getCurrentBR();
    const brPredictedAfter = await actor.getBorrowRateAfterBorrow(p.borrowAsset, 0);
    console.log(`Current BR=${brAfter.toString()} predicted BR=${brPredictedAfter.toString()}`);

    return {br: brAfter, brPredicted};
  }
}
