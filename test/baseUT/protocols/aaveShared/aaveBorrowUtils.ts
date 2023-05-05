import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {TokenDataTypes} from "../../types/TokenDataTypes";
import {getBigNumberFrom} from "../../../../scripts/utils/NumberUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BigNumber} from "ethers";
import {ConverterController} from "../../../../typechain";

type MakeBorrowFixedAmountFunc = (
  converter: ConverterController,
  collateralToken: TokenDataTypes,
  collateralHolder: string,
  collateralAmountRequired: BigNumber | undefined,
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
  ignoreRepay?: boolean;
  ignoreWithdraw?: boolean;
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
    const collateralHolder = MaticAddresses.HOLDER_DAI;
    const borrowAsset = MaticAddresses.WMATIC;

    const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
    const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

    const collateralAmount = collateralAmountNum
      ? getBigNumberFrom(collateralAmountNum, collateralToken.decimals)
      : undefined;
    const borrowAmount = borrowAmountNum
      ? getBigNumberFrom(borrowAmountNum, borrowToken.decimals)
      : undefined;

    return makeBorrowFunc(converter, collateralToken, collateralHolder, collateralAmount, borrowToken, borrowAmount);
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
      ? getBigNumberFrom(collateralAmountNum, collateralToken.decimals)
      : undefined;
    const borrowAmount = borrowAmountNum
      ? getBigNumberFrom(borrowAmountNum, borrowToken.decimals)
      : undefined;

    return makeBorrowFunc(converter, collateralToken, collateralHolder, collateralAmount, borrowToken, borrowAmount);
  }

  static async eursTether(
    deployer: SignerWithAddress,
    converter: ConverterController,
    makeBorrowFunc: MakeBorrowFixedAmountFunc,
    collateralAmountNum: number | undefined,
    borrowAmountNum: number | undefined
  ) : Promise<IMakeBorrowTestResults> {
    const collateralAsset = MaticAddresses.EURS;
    const collateralHolder = MaticAddresses.HOLDER_EURS;
    const borrowAsset = MaticAddresses.USDT;

    const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
    const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

    const collateralAmount = collateralAmountNum
      ? getBigNumberFrom(collateralAmountNum, collateralToken.decimals)
      : undefined;
    const borrowAmount = borrowAmountNum
      ? getBigNumberFrom(borrowAmountNum, borrowToken.decimals)
      : undefined;

    return makeBorrowFunc(converter, collateralToken, collateralHolder, collateralAmount, borrowToken, borrowAmount);
  }

  static async usdcDai(
    deployer: SignerWithAddress,
    converter: ConverterController,
    makeBorrowFunc: MakeBorrowFixedAmountFunc,
    collateralAmountNum: number | undefined,
    borrowAmountNum: number | undefined
  ) : Promise<IMakeBorrowTestResults> {
    const collateralAsset = MaticAddresses.USDC;
    const collateralHolder = MaticAddresses.HOLDER_USDC;
    const borrowAsset = MaticAddresses.DAI;

    const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
    const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

    const collateralAmount = collateralAmountNum
      ? getBigNumberFrom(collateralAmountNum, collateralToken.decimals)
      : undefined;
    const borrowAmount = borrowAmountNum
      ? getBigNumberFrom(borrowAmountNum, borrowToken.decimals)
      : undefined;

    return makeBorrowFunc(converter, collateralToken, collateralHolder, collateralAmount, borrowToken, borrowAmount);
  }

  static async wbtcTether(
    deployer: SignerWithAddress,
    converter: ConverterController,
    makeBorrowFunc: MakeBorrowFixedAmountFunc,
    collateralAmountNum: number | undefined,
    borrowAmountNum: number | undefined
  ) : Promise<IMakeBorrowTestResults> {
    const collateralAsset = MaticAddresses.WBTC;
    const collateralHolder = MaticAddresses.HOLDER_WBTC;
    const borrowAsset = MaticAddresses.USDT;

    const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
    const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

    const collateralAmount = collateralAmountNum
      ? getBigNumberFrom(collateralAmountNum, collateralToken.decimals)
      : undefined;
    const borrowAmount = borrowAmountNum
      ? getBigNumberFrom(borrowAmountNum, borrowToken.decimals)
      : undefined;

    return makeBorrowFunc(converter, collateralToken, collateralHolder, collateralAmount, borrowToken, borrowAmount);
  }
}