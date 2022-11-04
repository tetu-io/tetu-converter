import {TokenDataTypes} from "../types/TokenDataTypes";
import {
  ISwapManager__factory, SwapManager__factory
} from "../../../typechain";
import {BigNumber} from "ethers";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  IStrategyToConvert, ISwapResults
} from "./aprDataTypes";
import {AppDataTypes} from "../../../typechain/contracts/core/SwapManager";
import {TetuConverterApp} from "../helpers/TetuConverterApp";
import {BalanceUtils} from "../utils/BalanceUtils";
import {MocksHelper} from "../helpers/MocksHelper";
import {CompareAprUsesCase, ISwapTestResults} from "../uses-cases/CompareAprUsesCase";

export interface IMakeSwapTestResults {
  strategyToConvert: IStrategyToConvert;
  swapResults?: ISwapResults;
  error?: string;
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

    const swapManager = SwapManager__factory.connect(await controller.swapManager(), deployer);

    console.log("Tetu liquidator", await controller.tetuLiquidator());

    const params: AppDataTypes.InputConversionParamsStruct = {
      periodInBlocks: 1, // count blocks
      sourceAmount: collateralAmount,
      sourceToken: collateralToken.address,
      targetToken: borrowToken.address
    };
    const strategyToConvert: IStrategyToConvert = await swapManager.getConverter(params);

    const swapResults = await CompareAprUsesCase.makeSwapThereAndBack(
      swapManager,
      collateralToken.address,
      collateralHolders,
      collateralAmount,
      borrowToken.address,
      strategyToConvert
    );

    return {
      swapResults,
      strategyToConvert,
      swapManagerAddress: swapManager.address
    }
  }
}