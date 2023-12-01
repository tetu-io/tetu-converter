import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {IERC20Metadata__factory} from "../../../../typechain";
import {BigNumber} from "ethers";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {IPlatformActor} from "../../types/IPlatformActor";
import {TokenUtils} from "../../../../scripts/utils/TokenUtils";

export interface IPredictBrParams {
  collateralAsset: string;
  borrowAsset: string;
  borrowPart10000: number; // borrow amount = available liquidity * borrowPart10000 / 10000
  collateralMult?: number; // collateral amount = borrow amount * collateralMult, 2 by default
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
    const amountToBorrow = availableLiquidity.mul(p.borrowPart10000).div(10000);

    const collateralAmount = amountToBorrow.mul(p.collateralMult ?? 2);
    await TokenUtils.getToken(p.collateralAsset, signer.address, collateralAmount);

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
