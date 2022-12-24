import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {TokenDataTypes} from "../../types/TokenDataTypes";
import {getBigNumberFrom} from "../../../../scripts/utils/NumberUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BigNumber} from "ethers";

type MakeBorrowFixedAmountFunc = (
  collateralToken: TokenDataTypes,
  collateralHolder: string,
  collateralAmountRequired: BigNumber | undefined,
  borrowToken: TokenDataTypes,
  borrowAmountRequired: BigNumber | undefined
) => Promise<{ sret: string, sexpected: string }>;

export class AaveBorrowUtils {
  static async daiWMatic(
    deployer: SignerWithAddress,
    makeBorrowFunc : MakeBorrowFixedAmountFunc,
    collateralAmountNum: number | undefined,
    borrowAmountNum: number | undefined
  ) : Promise<{ret: string, expected: string}> {
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

    const r = await makeBorrowFunc(
      collateralToken,
      collateralHolder,
      collateralAmount,
      borrowToken,
      borrowAmount,
    );

    return {ret: r.sret, expected: r.sexpected};
  }

  static async daiUsdc(
    deployer: SignerWithAddress,
    makeBorrowFunc : MakeBorrowFixedAmountFunc,
    collateralAmountNum: number | undefined,
    borrowAmountNum: number | undefined
  ) : Promise<{ret: string, expected: string}> {
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

    const r = await makeBorrowFunc(
      collateralToken
      , collateralHolder
      , collateralAmount
      , borrowToken
      , borrowAmount
    );
    return {ret: r.sret, expected: r.sexpected};
  }

  static async eursTether(
    deployer: SignerWithAddress,
    makeBorrowFunc: MakeBorrowFixedAmountFunc,
    collateralAmountNum: number | undefined,
    borrowAmountNum: number | undefined
  ) : Promise<{ret: string, expected: string}> {
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

    const r = await makeBorrowFunc(
      collateralToken
      , collateralHolder
      , collateralAmount
      , borrowToken
      , borrowAmount
    );
    return {ret: r.sret, expected: r.sexpected};
  }

  static async usdcDai(
    deployer: SignerWithAddress,
    makeBorrowFunc: MakeBorrowFixedAmountFunc,
    collateralAmountNum: number | undefined,
    borrowAmountNum: number | undefined
  ) : Promise<{ret: string, expected: string}> {
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

    const r = await makeBorrowFunc(
      collateralToken,
      collateralHolder,
      collateralAmount,
      borrowToken,
      borrowAmount,
    );

    return {ret: r.sret, expected: r.sexpected};
  }

  static async wbtcTether(
    deployer: SignerWithAddress,
    makeBorrowFunc: MakeBorrowFixedAmountFunc,
    collateralAmountNum: number | undefined,
    borrowAmountNum: number | undefined
  ) : Promise<{ret: string, expected: string}> {
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

    const r = await makeBorrowFunc(
      collateralToken,
      collateralHolder,
      collateralAmount,
      borrowToken,
      borrowAmount
    );
    return {ret: r.sret, expected: r.sexpected};
  }
}