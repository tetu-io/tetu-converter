import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {TokenDataTypes} from "../../types/TokenDataTypes";
import {getBigNumberFrom} from "../../../../scripts/utils/NumberUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BigNumber} from "ethers";
import {ConverterController} from "../../../../typechain";
import {parseUnits} from "ethers/lib/utils";

type MakeBorrowFixedAmountFunc = (
  converter: ConverterController,
  collateralToken: TokenDataTypes,
  collateralAmountRequired: BigNumber,
  borrowToken: TokenDataTypes,
  borrowAmountRequired: BigNumber | undefined
) => Promise<IMakeBorrowTestResults>;

export interface IMakeBorrowTestResults {
  borrowedAmount: BigNumber;
  priceBorrow: BigNumber;
  borrowAssetDecimals: number;

  collateralAmount: BigNumber;
  priceCollateral: BigNumber;
  collateraAssetDecimals: number;

  userBalanceBorrowedAsset: BigNumber;
  poolAdapterBalanceCollateralAsset: BigNumber;
  totalCollateralBase: BigNumber;
  totalDebtBase: BigNumber;
}

export interface IMakeRepayBadPathsParams {
  amountToRepayStr?: string;
  makeRepayAsNotTc?: boolean;
  closePosition?: boolean;
  usePoolMock?: boolean;
  grabAllBorrowAssetFromSenderOnRepay?: boolean;
  collateralPriceIsZero?: boolean;
  borrowPriceIsZero?: boolean;
  ignoreRepay?: boolean;
  ignoreWithdraw?: boolean;

  /**
   * After call of repay() get current user status, save it and add given value to the saved health factor.
   * So, next call of the status will return modified health factor.
   */
  addToHealthFactorAfterRepay?: string;
}

export class AaveBorrowUtils {
  static async daiWMatic(
    deployer: SignerWithAddress,
    converter: ConverterController,
    makeBorrowFunc : MakeBorrowFixedAmountFunc,
    collateralAmountNum: number | undefined,
    borrowAmountNum: number | undefined
  ) : Promise<IMakeBorrowTestResults> {
    const collateralAsset = MaticAddresses.DAI;
    const borrowAsset = MaticAddresses.WMATIC;

    const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
    const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

    const collateralAmount = collateralAmountNum
      ? parseUnits(collateralAmountNum.toString(), collateralToken.decimals)
      : parseUnits("10000000", collateralToken.decimals);
    const borrowAmount = borrowAmountNum
      ? parseUnits(borrowAmountNum.toString(), borrowToken.decimals)
      : undefined;

    return makeBorrowFunc(converter, collateralToken, collateralAmount, borrowToken, borrowAmount);
  }

  static async daiUsdc(
    deployer: SignerWithAddress,
    converter: ConverterController,
    makeBorrowFunc : MakeBorrowFixedAmountFunc,
    collateralAmountNum: number | undefined,
    borrowAmountNum: number | undefined
  ) : Promise<IMakeBorrowTestResults> {
    const collateralAsset = MaticAddresses.DAI;
    const collateralHolder = MaticAddresses.HOLDER_DAI;
    const borrowAsset = MaticAddresses.USDC;

    const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
    const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

    const collateralAmount = collateralAmountNum
      ? parseUnits(collateralAmountNum.toString(), collateralToken.decimals)
      : parseUnits("10000000", collateralToken.decimals);
    const borrowAmount = borrowAmountNum
      ? parseUnits(borrowAmountNum.toString(), borrowToken.decimals)
      : undefined;

    return makeBorrowFunc(converter, collateralToken, collateralAmount, borrowToken, borrowAmount);
  }

  static async eursTether(
    deployer: SignerWithAddress,
    converter: ConverterController,
    makeBorrowFunc: MakeBorrowFixedAmountFunc,
    collateralAmountNum: number | undefined,
    borrowAmountNum: number | undefined
  ) : Promise<IMakeBorrowTestResults> {
    const collateralAsset = MaticAddresses.EURS;
    const borrowAsset = MaticAddresses.USDT;

    const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
    const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

    const collateralAmount = collateralAmountNum
      ? parseUnits(collateralAmountNum.toString(), collateralToken.decimals)
      : parseUnits("10000000", collateralToken.decimals);
    const borrowAmount = borrowAmountNum
      ? parseUnits(borrowAmountNum.toString(), borrowToken.decimals)
      : undefined;

    return makeBorrowFunc(converter, collateralToken, collateralAmount, borrowToken, borrowAmount);
  }

  static async wbtcTether(
    deployer: SignerWithAddress,
    converter: ConverterController,
    makeBorrowFunc: MakeBorrowFixedAmountFunc,
    collateralAmountNum: number | undefined,
    borrowAmountNum: number | undefined
  ) : Promise<IMakeBorrowTestResults> {
    const collateralAsset = MaticAddresses.WBTC;
    const borrowAsset = MaticAddresses.USDT;

    const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
    const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

    const collateralAmount = collateralAmountNum
      ? parseUnits(collateralAmountNum.toString(), collateralToken.decimals)
      : parseUnits("10000000", collateralToken.decimals);
    const borrowAmount = borrowAmountNum
      ? parseUnits(borrowAmountNum.toString(), borrowToken.decimals)
      : undefined;

    return makeBorrowFunc(converter, collateralToken, collateralAmount, borrowToken, borrowAmount);
  }
}