import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../../scripts/utils/NumberUtils";
import {IAave3ReserveInfo} from "../../../../scripts/integration/helpers/Aave3Helper";
import {IAaveToken__factory} from "../../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

export class Aave3Utils {
  /* Calculate max allowed amount to borrow by markets configuration data */
  public static async getMaxAmountToBorrow(
    borrowAssetData: IAave3ReserveInfo,
    collateralAssetData: IAave3ReserveInfo
  ) : Promise<BigNumber> {
    let expectedMaxAmountToBorrow = BigNumber.from(borrowAssetData.liquidity.totalAToken)
      .sub(borrowAssetData.liquidity.totalVariableDebt)
      .sub(borrowAssetData.liquidity.totalStableDebt);
    if (!borrowAssetData.data.borrowCap.eq(0)) {
      const borrowCap = borrowAssetData.data.borrowCap.mul(getBigNumberFrom(1, borrowAssetData.data.decimals));
      const totalDebt = borrowAssetData.liquidity.totalVariableDebt.add(borrowAssetData.liquidity.totalStableDebt);
      if (totalDebt.gt(borrowCap)) {
        expectedMaxAmountToBorrow = BigNumber.from(0);
      } else {
        if (totalDebt.add(expectedMaxAmountToBorrow).gt(borrowCap)) {
          expectedMaxAmountToBorrow = borrowCap.sub(totalDebt);
        }
      }
    }

    if (!collateralAssetData.data.debtCeiling.eq(0)) {
      // isolation mode
      const expectedMaxAmountToBorrowDebtCeiling =
        collateralAssetData.data.debtCeiling
          .sub(collateralAssetData.data.isolationModeTotalDebt)
          .mul(
            getBigNumberFrom(1, borrowAssetData.data.decimals - 2)
          );
      if (expectedMaxAmountToBorrow.gt(expectedMaxAmountToBorrowDebtCeiling)) {
        expectedMaxAmountToBorrow = expectedMaxAmountToBorrowDebtCeiling;
      }
    }

    return expectedMaxAmountToBorrow;
  }

  /* Calcluate max allowed amount to supply by markets configuration data */
  public static async getMaxAmountToSupply(
    deployer: SignerWithAddress,
    collateralAssetData: IAave3ReserveInfo
  ) : Promise<BigNumber> {
    let expectedMaxAmountToSupply = BigNumber.from(2).pow(256).sub(1); // == type(uint).max
    if (! collateralAssetData.data.supplyCap.eq(0)) {
      // see sources of AAVE3\ValidationLogic.sol\validateSupply
      const totalSupply =
        (await IAaveToken__factory.connect(collateralAssetData.aTokenAddress, deployer).scaledTotalSupply())
          .mul(collateralAssetData.data.liquidityIndex)
          .add(getBigNumberFrom(5, 26)) // HALF_RAY = 0.5e27
          .div(getBigNumberFrom(1, 27)); // RAY = 1e27
      const supplyCap = collateralAssetData.data.supplyCap
        .mul(getBigNumberFrom(1, collateralAssetData.data.decimals));
      expectedMaxAmountToSupply = supplyCap.gt(totalSupply)
        ? supplyCap.sub(totalSupply)
        : BigNumber.from(0);
    }

    return expectedMaxAmountToSupply;
  }
}