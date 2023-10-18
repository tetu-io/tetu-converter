import {TokenDataTypes} from "../../types/TokenDataTypes";
import {
  IERC20__factory,
  SwapManager__factory
} from "../../../../typechain";
import {BigNumber} from "ethers";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  IStrategyToConvert, IStrategyToSwap, ISwapResults
} from "./aprDataTypes";
import {BalanceUtils} from "../../utils/BalanceUtils";
import {CompareAprUsesCase} from "../../uses-cases/app/CompareAprUsesCase";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {TetuConverterApp} from "../../app/TetuConverterApp";
import {MocksHelper} from "../../app/MocksHelper";

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
      undefined,// there are no registered lending platforms, only swap is possible
      {
        tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR
      }
    );
    const userContract = await MocksHelper.deployBorrower(deployer.address, controller, 4000);
    await controller.connect(await DeployerUtils.startImpersonate(await controller.governance())).setWhitelistValues([userContract.address], true);

    await BalanceUtils.getRequiredAmountFromHolders(
      collateralAmount,
      collateralToken.token,
      collateralHolders,
      userContract.address
    );
    await IERC20__factory.connect(
      collateralToken.token.address,
      await DeployerUtils.startImpersonate(userContract.address)
    ).approve(await controller.tetuConverter(), collateralAmount);

    const swapManager = SwapManager__factory.connect(await controller.swapManager(), deployer);

    console.log("Tetu liquidator", await controller.tetuLiquidator());

    const strategyToSwap: IStrategyToSwap = await swapManager.callStatic.getConverter(
      userContract.address,
      collateralToken.address,
      collateralAmount,
      borrowToken.address
    );
    const apr18 = await swapManager.getApr18(
      collateralToken.address,
      collateralAmount,
      borrowToken.address,
      strategyToSwap.maxTargetAmount
    );

    const swapResults = await CompareAprUsesCase.makeSwapThereAndBack(
      swapManager,
      collateralToken.address,
      collateralHolders,
      collateralAmount,
      borrowToken.address,
    );

    return {
      swapResults,
      strategyToConvert: {
        converter: strategyToSwap.converter,
        amountToBorrowOut: strategyToSwap.maxTargetAmount,
        collateralAmountOut: collateralAmount,
        apr18
      },
      swapManagerAddress: swapManager.address,
    }
  }
}