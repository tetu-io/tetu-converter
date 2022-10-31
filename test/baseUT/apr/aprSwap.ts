import {TokenDataTypes} from "../types/TokenDataTypes";
import {
  ISwapManager__factory
} from "../../../typechain";
import {BigNumber} from "ethers";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  IStrategyToConvert
} from "./aprDataTypes";
import {AppDataTypes} from "../../../typechain/contracts/core/SwapManager";
import {TetuConverterApp} from "../helpers/TetuConverterApp";
import {BalanceUtils} from "../utils/BalanceUtils";
import {MocksHelper} from "../helpers/MocksHelper";

export interface IMakeSwapTestResults {
  strategyToConvert: IStrategyToConvert;
  amountToBorrow: BigNumber;
  userContractBorrowAssetBalanceAfterSwap: BigNumber;
  swapManagerAddress: string;
}

export class AprSwap {
  /**
   * 0. Predict APR
   * 1. Make swap
   * 3. Calculate real APR
   * 4. Ensure that predicted and real APR are the same
   *
   */
  static async makeSwapTest(
    deployer: SignerWithAddress,
    collateralToken: TokenDataTypes,
    collateralHolders: string[],
    collateralAmount: BigNumber,
    borrowToken: TokenDataTypes,
    amountToBorrow0: BigNumber | undefined,
  ) : Promise<IMakeSwapTestResults> {
    const {controller} = await TetuConverterApp.buildApp(
      deployer,
      undefined // there are no registered lending platforms, only swap is possible
    );
    const userContract = await MocksHelper.deployBorrower(deployer.address, controller, 4000);

    await BalanceUtils.getRequiredAmountFromHolders(
      collateralAmount,
      collateralToken.token,
      collateralHolders,
      userContract.address
    );

    const swapManager = ISwapManager__factory.connect(await controller.swapManager(), deployer);

    console.log("Tetu liquidator", await controller.tetuLiquidator());

    const params: AppDataTypes.InputConversionParamsStruct = {
      periodInBlocks: 1, // count blocks
      sourceAmount: collateralAmount,
      sourceToken: collateralToken.address,
      targetToken: borrowToken.address
    };
    const strategyToConvert: IStrategyToConvert = await swapManager.getConverter(params);

    const userContractCollateralAssetBalanceBeforeSwap = await collateralToken.token.balanceOf(userContract.address);
    console.log("userContractCollateralAssetBalanceBeforeSwap", userContractCollateralAssetBalanceBeforeSwap);

    await userContract.borrowExactAmount(
      collateralToken.address,
      collateralAmount,
      borrowToken.address,
      userContract.address,
      strategyToConvert.maxTargetAmount
    );

    const userContractBorrowAssetBalanceAfterSwap = await borrowToken.token.balanceOf(userContract.address);

    return {
      userContractBorrowAssetBalanceAfterSwap,
      amountToBorrow: strategyToConvert.maxTargetAmount,
      strategyToConvert,
      swapManagerAddress: swapManager.address
    }
  }
}