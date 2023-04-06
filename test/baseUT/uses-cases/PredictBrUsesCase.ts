import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {AaveTwoAprLibFacade, ConverterController, IERC20Metadata__factory, IPlatformAdapter} from "../../../typechain";
import {BigNumber, BigNumberish} from "ethers";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {TetuConverterApp} from "../helpers/TetuConverterApp";
import {MocksHelper} from "../helpers/MocksHelper";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {DForceUtils} from "../utils/DForceUtils";

export interface IPlatformActor {
  getAvailableLiquidity: () => Promise<BigNumber>,
  getCurrentBR: () => Promise<BigNumber>,
  // eslint-disable-next-line no-unused-vars
  supplyCollateral: (collateralAmount: BigNumber) => Promise<void>,
  // eslint-disable-next-line no-unused-vars
  borrow: (borrowAmount: BigNumber) => Promise<void>,
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
  static async getBorrowRateAfterBorrow(
    signer: SignerWithAddress,
    platformAdapterName: string,
    borrowAsset: string,
    amountToBorrow: BigNumberish
  ): Promise<BigNumber> {
    if (platformAdapterName === "aave3") {
      const libFacade = await MocksHelper.getAave3AprLibFacade(signer);
      return libFacade.getBorrowRateAfterBorrow(MaticAddresses.AAVE_V3_POOL, borrowAsset, amountToBorrow);
    } else if (platformAdapterName === "aaveTwo") {
      const libFacade = await MocksHelper.getAaveTwoAprLibFacade(signer);
      return libFacade.getBorrowRateAfterBorrow(MaticAddresses.AAVE_TWO_POOL, borrowAsset, amountToBorrow);
    } else if (platformAdapterName === "dforce") {
      const libFacade = await MocksHelper.getDForceAprLibFacade(signer);
      return libFacade.getBorrowRateAfterBorrow(DForceUtils.getCTokenAddressForAsset(borrowAsset), amountToBorrow);
    }

    throw new Error(`PredictBrUsesCase.getBorrowRateAfterBorrow not implemented: ${platformAdapterName}`)
  }
  static async makeTest(
    deployer: SignerWithAddress,
    actor: IPlatformActor,
    platformAdapterName: string,
    collateralAsset: string,
    borrowAsset: string,
    collateralHolders: string[],
    part10000: number
  ) : Promise<{br: BigNumber, brPredicted: BigNumber}> {
    console.log(`collateral ${collateralAsset} borrow ${borrowAsset}`);

    const controller = await TetuConverterApp.createController(deployer);

    // get available liquidity
    // we are going to borrow given part of the liquidity
    //                 [available liquidity] * percent100 / 100
    const availableLiquidity = await actor.getAvailableLiquidity();
    console.log(`Available liquidity ${availableLiquidity.toString()}`);

    const amountToBorrow = availableLiquidity.mul(part10000).div(10000);
    console.log(`Try to borrow ${amountToBorrow.toString()}`);

    // we assume, that total amount of collateral on holders accounts should be enough to borrow required amount
    for (const h of collateralHolders) {
      const cAsH = IERC20Metadata__factory.connect(collateralAsset, await DeployerUtils.startImpersonate(h));
      await cAsH.transfer(deployer.address, await cAsH.balanceOf(h));
    }
    const collateralAmount = await IERC20Metadata__factory.connect(collateralAsset, deployer)
      .balanceOf(deployer.address);
    console.log(`Collateral balance ${collateralAmount}`);

    // before borrow
    const brBefore = await actor.getCurrentBR();
    const brPredicted = await this.getBorrowRateAfterBorrow(deployer, platformAdapterName, borrowAsset, amountToBorrow);
    console.log(`Current BR=${brBefore.toString()} predicted BR=${brPredicted.toString()}`);

    // supply collateral
    await actor.supplyCollateral(collateralAmount);

    // borrow
    console.log(`borrow ${borrowAsset} amount ${amountToBorrow}`);
    await actor.borrow(amountToBorrow);

    console.log(`Available liquidity AFTER ${availableLiquidity.toString()}`);
    const brAfter = await actor.getCurrentBR();
    const brPredictedAfter = await this.getBorrowRateAfterBorrow(deployer, platformAdapterName, borrowAsset, 0);
    console.log(`Current BR=${brAfter.toString()} predicted BR=${brPredictedAfter.toString()}`);

    return {br: brAfter, brPredicted};
  }
}
