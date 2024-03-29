/**
 * Utils to deploy and setup TetuConverter app
 */
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {RunHelper} from "../../../utils/RunHelper";
import {BigNumber} from "ethers";
import {
  Bookkeeper__factory,
  BorrowManager__factory,
  ConverterController,
  ConverterController__factory, DebtMonitor__factory,
  IBorrowManager,
  IBorrowManager__factory, Keeper__factory, SwapManager__factory, TetuConverter__factory
} from "../../../../typechain";
import {appendFileSync} from "fs";
import {ethers, network} from "hardhat";
import {Misc} from "../../../utils/Misc";
import {writeFileSyncRestoreFolder} from "../../../../test/baseUT/utils/FileUtils";
import {CoreContractsHelper} from "../../../../test/baseUT/app/CoreContractsHelper";
import {ZkevmAddresses} from "../../../addresses/ZkevmAddresses";
import {parseUnits} from "ethers/lib/utils";
import {AdaptersHelper} from "../../../../test/baseUT/app/AdaptersHelper";

//region Data types
export interface IControllerSetupParams {
  minHealthFactor2: number;
  targetHealthFactor2: number;
  blocksPerDay: number; // i.e. 41142
  debtGap: number;
}

export interface IBorrowManagerSetupParams {
  /*
   *  Reward APR is taken into account with given factor. Decimals 18.
   *  The value is divided on {REWARDS_FACTOR_DENOMINATOR_18}
   */
  rewardsFactor: BigNumber;
}

export interface IKeeperSetupParams {
  blocksPerDayAutoUpdatePeriodSec: number // i.e. 3 * 24 * 60 * 60 == 3 days
}

export interface IDeployedContracts {
  controller?: string;
  tetuConverter?: string;
  borrowManager?: string;
  debtMonitor?: string;
  swapManager?: string;
  keeper?: string;
  priceOracle?: string;
  bookkeeper?: string;
}

export interface IDeployCoreResults {
  controller: string;
  tetuConverter: string;
  borrowManager: string;
  debtMonitor: string;
  swapManager: string;
  keeper: string;
  priceOracle: string;
  bookkeeper: string;
  tetuLiquidator: string;
  controllerSetupParams: IControllerSetupParams;
  borrowManagerSetupParams: IBorrowManagerSetupParams;
  keeperSetupParams: IKeeperSetupParams;
  proxyUpdater: string;
}

export interface IPlatformAdapterResult {
  lendingPlatformTitle: string;
  platformAdapterAddress: string;
  converters: string[];
  /* All cTokens (actual for compound-based platforms) */
  cTokensActive?: string[];
  /* We need to manually set priceOracle for HundredFinance only */
  priceOracle?: string;
}

export interface IPlatformAdapterAssets {
  leftAssets: string[];
  rightAssets: string[];
}

export interface ITargetHealthFactorValue {
  asset: string;
  healthFactor2: number;
}
//endregion Data types

const GAS_DEPLOY_LIMIT = 8_000_000;

export class ZkEvmDeploySolutionUtils {
//region Main script
  static async runMain(
    signer: SignerWithAddress,
    proxyUpdater: string,
    alreadyDeployed?: IDeployedContracts
  ) : Promise<IDeployCoreResults> {

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    /// Initial settings
    const destPathTxt = "tmp/deployed_zkevm.txt";
    const tetuLiquidatorAddress = ZkevmAddresses.TETU_LIQUIDATOR;
    const controllerSetupParams: IControllerSetupParams = {
      blocksPerDay: 38602, // (8579569 - 7079569) / (3357287/(24*60*60)) = 38602
      minHealthFactor2: 105,
      targetHealthFactor2: 200,
      debtGap: 1_000
    };
    const borrowManagerSetupParams: IBorrowManagerSetupParams = {
      rewardsFactor: parseUnits("1", 17)
    };
    const keeperSetupParams: IKeeperSetupParams = {
      blocksPerDayAutoUpdatePeriodSec: 3 * 24 * 60 * 60 // 3 days by default
    }

    const targetHealthFactorsAssets = [
      ZkevmAddresses.USDC,
      ZkevmAddresses.USDT,
      // ZkevmAddresses.MATIC,
      // ZkevmAddresses.WETH,
    ];
    const targetHealthFactorsValues = [
      115, // MaticAddresses.USDC,
      115, // MaticAddresses.USDT,
      // 200, // MaticAddresses.MATIC,
      // 200, // MaticAddresses.WETH,
    ];

    const deployKeom = true;
    const keomComptroller = ZkevmAddresses.KEOM_COMPTROLLER;
    const keomCTokens = [
      ZkevmAddresses.KEOM_USDC,
      ZkevmAddresses.KEOM_USDT,
      // ZkevmAddresses.KEOM_MATIC,
      // ZkevmAddresses.KEOM_WETH,
    ];
    const keomPairs = ZkEvmDeploySolutionUtils.generateAssetPairs([
      ZkevmAddresses.USDC,
      ZkevmAddresses.USDT,
      // ZkevmAddresses.MATIC,
      // ZkevmAddresses.WETH,
    ]);

    ///////////////////////////////////////////////////////////////////////////////////////////////////



    console.log("Deploy contracts");
    // Deploy all core contracts
    const deployCoreResults = await ZkEvmDeploySolutionUtils.deployCoreContracts(
      signer,
      proxyUpdater,
      tetuLiquidatorAddress,
      controllerSetupParams,
      borrowManagerSetupParams,
      keeperSetupParams,
      alreadyDeployed
    );

    console.log("Deploy platform adapters");
    const borrowManager: IBorrowManager = IBorrowManager__factory.connect(deployCoreResults.borrowManager, signer);
    const deployedPlatformAdapters: IPlatformAdapterResult[] = [];

    // Deploy all Platform adapters and pool adapters
    const platformAdapterKeom = deployKeom
      ? await ZkEvmDeploySolutionUtils.createPlatformAdapterKeom(signer,
        deployCoreResults.controller,
        keomComptroller,
        keomCTokens,
      )
      : undefined;
    if (platformAdapterKeom) {
      console.log("Register platform adapter Keom");
      deployedPlatformAdapters.push(platformAdapterKeom);
      await ZkEvmDeploySolutionUtils.registerPlatformAdapter(
        borrowManager,
        platformAdapterKeom.platformAdapterAddress,
        keomPairs
      );
    }

    console.log("setTargetHealthFactors");
    // set target health factors
    await RunHelper.runAndWait2(borrowManager.populateTransaction.setTargetHealthFactors(targetHealthFactorsAssets, targetHealthFactorsValues));

    console.log("write results to file");
    // save deploy results to file
    await ZkEvmDeploySolutionUtils.writeResultsToFile(
      destPathTxt,
      deployCoreResults,
      deployedPlatformAdapters,
      targetHealthFactorsAssets,
      targetHealthFactorsValues
    );

    return deployCoreResults;
  }
//endregion Main script

//region Setup core
  static async deployCoreContracts(
    deployer: SignerWithAddress,
    proxyUpdater: string,
    tetuLiquidator: string,
    controllerSetupParams: IControllerSetupParams,
    borrowManagerSetupParams: IBorrowManagerSetupParams,
    keeperSetupParams: IKeeperSetupParams,
    alreadyDeployed?: IDeployedContracts
  ) : Promise<IDeployCoreResults> {
    const priceOracle = alreadyDeployed?.priceOracle
      || (await CoreContractsHelper.createPriceOracleKeomZkevm(deployer, ZkevmAddresses.ZEROVIX_PRICE_ORACLE)).address;
    console.log("Result PriceOracle: ", priceOracle);

    const controllerAddress = alreadyDeployed?.controller || await CoreContractsHelper.deployController(deployer);
    console.log("Result controller", controllerAddress);

    const borrowManager = alreadyDeployed?.borrowManager || await CoreContractsHelper.deployBorrowManager(deployer);
    console.log("Result borrowManager", borrowManager);
    const keeper = alreadyDeployed?.keeper || await CoreContractsHelper.deployKeeper(deployer);
    console.log("Result keeper", keeper);
    const swapManager = alreadyDeployed?.swapManager || await CoreContractsHelper.deploySwapManager(deployer);
    console.log("Result swapManager", swapManager);
    const debtMonitor = alreadyDeployed?.debtMonitor || await CoreContractsHelper.deployDebtMonitor(deployer);
    console.log("Result debtMonitor", debtMonitor);
    const tetuConverter = alreadyDeployed?.tetuConverter || await CoreContractsHelper.deployTetuConverter(deployer);
    console.log("Result tetuConverter", tetuConverter);
    const bookkeeper = alreadyDeployed?.bookkeeper || await CoreContractsHelper.deployBookkeeper(deployer);
    console.log("Result bookeeper", bookkeeper);

    await RunHelper.runAndWait2(
      ConverterController__factory.connect(controllerAddress, deployer).populateTransaction.init(
        proxyUpdater,
        deployer.address,
        tetuConverter,
        borrowManager,
        debtMonitor,
        keeper,
        swapManager,
        priceOracle,
        tetuLiquidator,
        controllerSetupParams.blocksPerDay,
      )
    );
    console.log("Controller was initialized");

    const controller: ConverterController = ConverterController__factory.connect(controllerAddress, deployer);
    await RunHelper.runAndWait2(controller.populateTransaction.setBookkeeper(bookkeeper));
    console.log("Bookkeeper was set");

    await RunHelper.runAndWait2(Bookkeeper__factory.connect(bookkeeper, deployer).populateTransaction.init(controllerAddress));
    console.log("Bookkeeper was initialized");

    await RunHelper.runAndWait2(controller.populateTransaction.setMinHealthFactor2(controllerSetupParams.minHealthFactor2));
    console.log("min health factor was set");

    await RunHelper.runAndWait2(controller.populateTransaction.setTargetHealthFactor2(controllerSetupParams.targetHealthFactor2));
    console.log("target health factor was set");

    await RunHelper.runAndWait2(controller.populateTransaction.setDebtGap(controllerSetupParams.debtGap));
    console.log("setDebtGap was set");

    await RunHelper.runAndWait2(BorrowManager__factory.connect(borrowManager, deployer).populateTransaction.init(controllerAddress, borrowManagerSetupParams.rewardsFactor));
    console.log("borrowManager was initialized");

    await RunHelper.runAndWait2(Keeper__factory.connect(keeper, deployer).populateTransaction.init(controllerAddress, keeperSetupParams?.blocksPerDayAutoUpdatePeriodSec));

    await RunHelper.runAndWait2(TetuConverter__factory.connect(tetuConverter, deployer).populateTransaction.init(controllerAddress));
    console.log("tetuConverter was initialized");

    await RunHelper.runAndWait2(DebtMonitor__factory.connect(debtMonitor, deployer).populateTransaction.init(controllerAddress));
    console.log("debtMonitor was initialized");

    await RunHelper.runAndWait2(SwapManager__factory.connect(swapManager, deployer).populateTransaction.init(controllerAddress));
    console.log("swapManager was initialized");

    return {
      controller: controllerAddress,
      tetuConverter,
      borrowManager,
      debtMonitor,
      swapManager,
      keeper,
      priceOracle,
      bookkeeper,
      tetuLiquidator,
      controllerSetupParams,
      borrowManagerSetupParams,
      keeperSetupParams,
      proxyUpdater
    }
  }
//endregion Setup core

//region Platform adapters
  static async createPlatformAdapterKeom(deployer: SignerWithAddress, controller: string, comptroller: string, cTokensActive: string[]) : Promise<IPlatformAdapterResult> {
    const converterNormal = await AdaptersHelper.createKeomPoolAdapter(deployer);
    const platformAdapter = await AdaptersHelper.createKeomPlatformAdapter(
      deployer,
      controller,
      comptroller,
      converterNormal.address,
      cTokensActive,
    );

    return {
      lendingPlatformTitle: "Keom",
      converters: [converterNormal.address],
      platformAdapterAddress: platformAdapter.address,
      cTokensActive,
    }
  }
//endregion Platform adapters

//region Utils
  static async registerPlatformAdapter(
    borrowManager: IBorrowManager,
    platformAdapter: string,
    assetPairs: IPlatformAdapterAssets
  ) {
    console.log("registerPlatformAdapter", platformAdapter, assetPairs);
    await RunHelper.runAndWait2(
      borrowManager.populateTransaction.addAssetPairs(
        platformAdapter,
        assetPairs.leftAssets,
        assetPairs.rightAssets,
      )
    );
  }

  static generateAssetPairs(tokens: string[]) : IPlatformAdapterAssets {
    const leftAssets: string[] = [];
    const rightAssets: string[] = [];
    for (let i = 0; i < tokens.length; ++i) {
      for (let j = i + 1; j < tokens.length; ++j) {
        leftAssets.push(tokens[i]);
        rightAssets.push(tokens[j]);
      }
    }
    return {leftAssets, rightAssets};
  }

  static async writeResultsToFile(
    destPathTxt: string,
    deployCoreResults: IDeployCoreResults,
    deployedPlatformAdapters: IPlatformAdapterResult[],
    targetHealthFactorsAssets: string[],
    targetHealthFactorsValues: number[]
  ) {
    writeFileSyncRestoreFolder(destPathTxt, '\n-----------\n', { encoding: 'utf8', flag: 'a' });
    appendFileSync(destPathTxt, `${new Date().toISOString()}\n`, 'utf8');
    appendFileSync(destPathTxt, `${network.name}\n`, 'utf8');
    appendFileSync(destPathTxt, `chain id = ${Misc.getChainId()}\n`, 'utf8');
    appendFileSync(destPathTxt, `chain name = ${Misc.getChainName()}\n`, 'utf8');
    appendFileSync(destPathTxt, `${(await ethers.provider.getNetwork()).name}\n`, 'utf8');

    for (const [key, value] of Object.entries(deployCoreResults)) {
      const txt = `${key} ${JSON.stringify(value)}\n`;
      appendFileSync(destPathTxt, txt, 'utf8');
    }

    for (const platformAdapter of deployedPlatformAdapters) {
      appendFileSync(destPathTxt, `Platform: ${platformAdapter.lendingPlatformTitle}\n`, 'utf8');
      appendFileSync(destPathTxt, `Platform adapter: ${platformAdapter.platformAdapterAddress}\n`, 'utf8');
      appendFileSync(destPathTxt, `Converters: ${platformAdapter.converters.join()}\n`, 'utf8');
      if (platformAdapter.cTokensActive) {
        appendFileSync(destPathTxt, `CTokens: ${platformAdapter.cTokensActive.join()}\n`, 'utf8');
      }
      if (platformAdapter.priceOracle) {
        appendFileSync(destPathTxt, `priceOracle: ${platformAdapter.priceOracle}\n`, 'utf8');
      }
      appendFileSync(destPathTxt, `\n\n`, 'utf8');
    }
    const targetHealthFactors: ITargetHealthFactorValue[] = [...Array(targetHealthFactorsAssets.length).keys()].map(
      (_, index) => ({
        asset: targetHealthFactorsAssets[index],
        healthFactor2: targetHealthFactorsValues[index]
      })
    );
    const sTargetHealthFactors = targetHealthFactors.map(x => `${x.asset}=${x.healthFactor2}`);
    appendFileSync(destPathTxt, `Assigned target health factors:\n`, 'utf8');
    appendFileSync(destPathTxt, `${sTargetHealthFactors.join("\n")}`, 'utf8');
    appendFileSync(destPathTxt, `\n\n`, 'utf8');
  }
//endregion Utils

}
