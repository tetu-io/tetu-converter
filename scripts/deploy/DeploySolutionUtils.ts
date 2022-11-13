/**
 * Utils to deploy and setup TetuConverter app
 */
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {CoreContractsHelper} from "../../test/baseUT/helpers/CoreContractsHelper";
import {RunHelper} from "../utils/RunHelper";
import {BigNumber} from "ethers";
import {IBorrowManager, IBorrowManager__factory} from "../../typechain";
import {AdaptersHelper} from "../../test/baseUT/helpers/AdaptersHelper";
import {appendFileSync} from "fs";
import {ethers, network} from "hardhat";
import {Misc} from "../utils/Misc";
import {MaticAddresses} from "../addresses/MaticAddresses";
import {DeployerUtils} from "../utils/DeployerUtils";
import {MocksHelper} from "../../test/baseUT/helpers/MocksHelper";

//region Data types
export interface IControllerSetupParams {
  minHealthFactor2: number;
  targetHealthFactor2: number;
  maxHealthFactor2: number;
  blocksPerDay: number; // i.e. 41142
}

export interface IBorrowManagerSetupParams {
  /*
   *  Reward APR is taken into account with given factor. Decimals 18.
   *  The value is divided on {REWARDS_FACTOR_DENOMINATOR_18}
   */
  rewardsFactor: BigNumber;
}

export interface IDeployCoreResults {
  controller: string;
  tetuConverter: string;
  borrowManager: string;
  debtMonitor: string;
  swapManager: string;
  keeper: string;
  tetuLiquidator: string;
  controllerSetupParams: IControllerSetupParams;
  borrowManagerSetupParams: IBorrowManagerSetupParams;
  gelatoOpsReady: string;
}

export interface IPlatformAdapterResult {
  lendingPlatformTitle: string;
  platformAdapterAddress: string;
  converters: string[];
  /* All cTokens (actual for DForce and HundredFinance only) */
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

export class DeploySolutionUtils {
//region Main script
  static async runMain(signer: SignerWithAddress) : Promise<IDeployCoreResults> {

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    /// Initial settings
    const destPathTxt = "tmp/deployed.txt";
    const tetuLiquidatorAddress = MaticAddresses.TETU_LIQUIDATOR;
    const controllerSetupParams: IControllerSetupParams = {
      blocksPerDay: 41142,
      minHealthFactor2: 120,
      targetHealthFactor2: 200,
      maxHealthFactor2: 400
    };
    const borrowManagerSetupParams: IBorrowManagerSetupParams = {
      rewardsFactor: Misc.WEI.div(2) // 0.5e18
    };

    const targetHealthFactorsAssets = [
      MaticAddresses.USDC,
      MaticAddresses.USDT,
      MaticAddresses.DAI,
      MaticAddresses.EURS,
      MaticAddresses.jEUR,
      MaticAddresses.WETH,
      MaticAddresses.WMATIC,
      MaticAddresses.WBTC
    ];
    const targetHealthFactorsValues = [
      200, // MaticAddresses.USDC,
      200, // MaticAddresses.USDT,
      200, // MaticAddresses.DAI,
      200, // MaticAddresses.EURS,
      200, // MaticAddresses.jEUR,
      200, // MaticAddresses.WETH,
      200, // MaticAddresses.WMATIC,
      200, // MaticAddresses.WBTC
    ];

    const deployAave3 = true;
    const aave3Pool = MaticAddresses.AAVE_V3_POOL;
    const aave3AssetPairs = DeploySolutionUtils.generateAssetPairs([
      MaticAddresses.USDC,
      MaticAddresses.USDT,
      MaticAddresses.DAI,
      MaticAddresses.EURS,
      MaticAddresses.jEUR,
      MaticAddresses.WETH,
      MaticAddresses.WMATIC,
      MaticAddresses.WBTC
    ]);

    const deployAaveTwo = true;
    const aaveTwoPool = MaticAddresses.AAVE_TWO_POOL;
    const aaveTwoPairs = DeploySolutionUtils.generateAssetPairs([
      MaticAddresses.USDC,
      MaticAddresses.USDT,
      MaticAddresses.DAI,
      MaticAddresses.WMATIC,
      MaticAddresses.WETH,
      MaticAddresses.WBTC
    ]);

    const deployDForce = true;
    const dForceComptroller = MaticAddresses.DFORCE_CONTROLLER;
    const dForceCTokens = [
      MaticAddresses.dForce_iDAI,
      MaticAddresses.dForce_iMATIC,
      MaticAddresses.dForce_iUSDC,
      MaticAddresses.dForce_iWETH,
      MaticAddresses.dForce_iUSDT,
      MaticAddresses.dForce_iWBTC,
      // MaticAddresses.dForce_iEUX,
      MaticAddresses.dForce_iUSX,
      // MaticAddresses.dForce_iDF,
      // MaticAddresses.dForce_iAAVE,
      // MaticAddresses.dForce_iCRV
    ];
    const dForcePairs = DeploySolutionUtils.generateAssetPairs([
      MaticAddresses.USDC,
      MaticAddresses.USDT,
      MaticAddresses.DAI,
      MaticAddresses.WMATIC,
      MaticAddresses.WETH,
      MaticAddresses.WBTC,
      MaticAddresses.dForce_USD
    ]);

    const deployHundredFinance = true;
    const hundredFinanceComptroller = MaticAddresses.HUNDRED_FINANCE_COMPTROLLER;
    const hundredFinanceCTokens = [
      MaticAddresses.hDAI,
      MaticAddresses.hMATIC,
      MaticAddresses.hUSDC,
      MaticAddresses.hETH,
      MaticAddresses.hUSDT,
      MaticAddresses.hWBTC,
      // MaticAddresses.hLINK,
      // MaticAddresses.hFRAX,
    ];
    const hundredFinancePriceOracle = MaticAddresses.HUNDRED_FINANCE_PRICE_ORACLE;
    const hundredFinancePairs = DeploySolutionUtils.generateAssetPairs([
      MaticAddresses.USDC,
      MaticAddresses.USDT,
      MaticAddresses.DAI,
      MaticAddresses.WMATIC,
      MaticAddresses.WETH,
      MaticAddresses.WBTC,
    ]);

    ///////////////////////////////////////////////////////////////////////////////////////////////////

    // TODO: deploy KeeperCaller mock as replacement for gelato
    // TODO: it allows us to test keeper
    const gelatoOpsReady = await MocksHelper.createKeeperCaller(signer);

    console.log("Deploy contracts");
    // Deploy all core contracts
    const deployCoreResults = await DeploySolutionUtils.deployCoreContracts(
      signer,
      gelatoOpsReady.address,
      tetuLiquidatorAddress,
      controllerSetupParams,
      borrowManagerSetupParams
    );

    console.log("Deploy platform adapters");
    const borrowManager = IBorrowManager__factory.connect(deployCoreResults.borrowManager, signer);
    const deployedPlatformAdapters: IPlatformAdapterResult[] = [];

    // Deploy all Platform adapters and pool adapters
    const platformAdapterAave3 = deployAave3
      ? await DeploySolutionUtils.createPlatformAdapterAAVE3(signer,
        deployCoreResults.controller,
        aave3Pool
      )
      : undefined;
    if (platformAdapterAave3) {
      console.log("Register platform adapter AAVE3");
      deployedPlatformAdapters.push(platformAdapterAave3);

      await DeploySolutionUtils.registerPlatformAdapter(
        borrowManager,
        platformAdapterAave3.platformAdapterAddress,
        aave3AssetPairs
      );
    }

    const platformAdapterAaveTwo = deployAaveTwo
      ? await DeploySolutionUtils.createPlatformAdapterAAVETwo(signer,
        deployCoreResults.controller,
        aaveTwoPool
      )
      : undefined;
    if (platformAdapterAaveTwo) {
      console.log("Register platform adapter AAVE2");
      deployedPlatformAdapters.push(platformAdapterAaveTwo);
      await DeploySolutionUtils.registerPlatformAdapter(
        borrowManager,
        platformAdapterAaveTwo.platformAdapterAddress,
        aaveTwoPairs
      );
    }

    const platformAdapterDForce = deployDForce
      ? await DeploySolutionUtils.createPlatformAdapterDForce(signer,
        deployCoreResults.controller,
        dForceComptroller,
        dForceCTokens
      )
      : undefined;
    if (platformAdapterDForce) {
      console.log("Register platform adapter DForce");
      deployedPlatformAdapters.push(platformAdapterDForce);
      await DeploySolutionUtils.registerPlatformAdapter(
        borrowManager,
        platformAdapterDForce.platformAdapterAddress,
        dForcePairs
      );
    }

    const platformAdapterHundredFinance = deployHundredFinance
      ? await DeploySolutionUtils.createPlatformAdapterHundredFinance(signer,
        deployCoreResults.controller,
        hundredFinanceComptroller,
        hundredFinanceCTokens,
      )
      : undefined;
    if (platformAdapterHundredFinance) {
      console.log("Register platform adapter HundredFinance");
      deployedPlatformAdapters.push(platformAdapterHundredFinance);
      await DeploySolutionUtils.registerPlatformAdapter(
        borrowManager,
        platformAdapterHundredFinance.platformAdapterAddress,
        hundredFinancePairs
      );
    }

    console.log("setTargetHealthFactors");
    // set target health factors
    await RunHelper.runAndWait(
      () =>  borrowManager.setTargetHealthFactors(
        targetHealthFactorsAssets,
        targetHealthFactorsValues,
        {gasLimit: GAS_DEPLOY_LIMIT}
      )
    );

    console.log("write results to file");
    // save deploy results to file
    await DeploySolutionUtils.writeResultsToFile(
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
    gelatoOpsReady: string,
    tetuLiquidator: string,
    controllerSetupParams: IControllerSetupParams,
    borrowManagerSetupParams: IBorrowManagerSetupParams
  ) : Promise<IDeployCoreResults> {
    const controller = await CoreContractsHelper.createController(
      deployer,
      controllerSetupParams.minHealthFactor2,
      controllerSetupParams.targetHealthFactor2,
      controllerSetupParams.maxHealthFactor2,
      controllerSetupParams.blocksPerDay,
      false // don't initialize controller using empty addresses
    );
    const borrowManager = await CoreContractsHelper.createBorrowManager(
      deployer,
      controller,
      borrowManagerSetupParams.rewardsFactor
    );
    const debtMonitor = await CoreContractsHelper.createDebtMonitor(deployer, controller.address);
    const tetuConverter = await CoreContractsHelper.createTetuConverter(deployer, controller);
    const swapManager = await CoreContractsHelper.createSwapManager(deployer, controller);
    const keeper = await CoreContractsHelper.createKeeper(deployer, controller, gelatoOpsReady);

    await RunHelper.runAndWait(
      () => controller.initialize(
        tetuConverter.address,
        borrowManager.address,
        debtMonitor.address,
        keeper.address,
        tetuLiquidator,
        swapManager.address,
        {gasLimit: GAS_DEPLOY_LIMIT}
      )
    );

    return {
      controller: controller.address,
      tetuConverter: tetuConverter.address,
      borrowManager: borrowManager.address,
      debtMonitor: debtMonitor.address,
      swapManager: swapManager.address,
      keeper: keeper.address,
      tetuLiquidator,
      controllerSetupParams,
      borrowManagerSetupParams,
      gelatoOpsReady
    }
  }
//endregion Setup core

//region Platform adapters
  static async createPlatformAdapterAAVE3(
    deployer: SignerWithAddress,
    controller: string,
    aavePoolAddress: string
  ) : Promise<IPlatformAdapterResult> {
    const converterNormal = await AdaptersHelper.createAave3PoolAdapter(deployer);
    const converterEModde = await AdaptersHelper.createAave3PoolAdapterEMode(deployer);
    const platformAdapter = await AdaptersHelper.createAave3PlatformAdapter(
      deployer,
      controller,
      aavePoolAddress,
      converterNormal.address,
      converterEModde.address
    );

    return {
      lendingPlatformTitle: "AAVE v3",
      converters: [converterNormal.address, converterEModde.address],
      platformAdapterAddress: platformAdapter.address
    }
  }

  static async createPlatformAdapterAAVETwo(
    deployer: SignerWithAddress,
    controller: string,
    aavePoolAddress: string
  ) : Promise<IPlatformAdapterResult> {
    const converterNormal = await AdaptersHelper.createAaveTwoPoolAdapter(deployer);
    const platformAdapter = await AdaptersHelper.createAaveTwoPlatformAdapter(
      deployer,
      controller,
      aavePoolAddress,
      converterNormal.address,
    );

    return {
      lendingPlatformTitle: "AAVE-TWO",
      converters: [converterNormal.address],
      platformAdapterAddress: platformAdapter.address
    }
  }

  static async createPlatformAdapterDForce(
    deployer: SignerWithAddress,
    controller: string,
    comptroller: string,
    cTokensActive: string[]
  ) : Promise<IPlatformAdapterResult> {
    const converterNormal = await AdaptersHelper.createDForcePoolAdapter(deployer);
    const platformAdapter = await AdaptersHelper.createDForcePlatformAdapter(
      deployer,
      controller,
      comptroller,
      converterNormal.address,
      cTokensActive
    );

    return {
      lendingPlatformTitle: "DForce",
      converters: [converterNormal.address],
      platformAdapterAddress: platformAdapter.address,
      cTokensActive
    }
  }

  static async createPlatformAdapterHundredFinance(
    deployer: SignerWithAddress,
    controller: string,
    comptroller: string,
    cTokensActive: string[],
  ) : Promise<IPlatformAdapterResult> {
    const converterNormal = await AdaptersHelper.createHundredFinancePoolAdapter(deployer);
    const platformAdapter = await AdaptersHelper.createHundredFinancePlatformAdapter(
      deployer,
      controller,
      comptroller,
      converterNormal.address,
      cTokensActive,
    );

    return {
      lendingPlatformTitle: "Hundred Finance",
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
    await RunHelper.runAndWait(
      () => borrowManager.addAssetPairs(
        platformAdapter,
        assetPairs.leftAssets,
        assetPairs.rightAssets,
        {gasLimit: GAS_DEPLOY_LIMIT}
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
    appendFileSync(destPathTxt, '\n-----------\n', 'utf8');
    appendFileSync(destPathTxt, `${new Date().toISOString()}\n`, 'utf8');
    appendFileSync(destPathTxt, `${network.name}\n`, 'utf8');
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