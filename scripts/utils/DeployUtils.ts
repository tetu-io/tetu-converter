import {ethers, network, web3} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Logger} from "tslog";
import logSettings from "../../log_settings";
import {ContractFactory, utils} from "ethers";
import {Libraries} from "hardhat-deploy/dist/types";
import {
  CompanyManager, DebtsManager, PaymentsManager,
  RequestsManager, PriceOracle, Controller, ApprovalsManager, ProxyControlled__factory, ProxyControlled, BatchReader
} from "../../typechain";
import {CoreInstances} from "../app-model/CoreInstances";
import {getMockUniswapV2Pair} from "../../test/baseUt/FabricUtils";
import axios from "axios";
import {config as dotEnvConfig} from "dotenv";
import {DeployerUtils} from "./DeployerUtils";
import {Misc} from "./Misc";
import {VerifyUtils} from "./VerifyUtils";

const log: Logger = new Logger(logSettings);

const libraries = new Map<string, string>([
  ['', '']
]);
const hre = require("hardhat");

dotEnvConfig();
// tslint:disable-next-line:no-var-requires
const argv = require('yargs/yargs')()
    .env('TETU')
    .options({
      networkScanKey: {
        type: "string",
      },
    }).argv;

export class DeployUtils {

//region Contract connection
  /**
   * Deploy a contract
   * @param signer
   * @param name contract name
   * @param args values for contract's constructor
   */
  public static async deployContract<T extends ContractFactory>(
      signer: SignerWithAddress,
      name: string,
      // tslint:disable-next-line:no-any
      ...args: any[]
  ) {
    log.info(`Deploying ${name}`);
    log.info("Account balance: " + utils.formatUnits(await signer.getBalance(), 18));

    const gasPrice = await web3.eth.getGasPrice();
    log.info("Gas price: " + gasPrice);
    const lib: string | undefined = libraries.get(name);
    let _factory;
    if (lib) {
      log.info('DEPLOY LIBRARY', lib, 'for', name);
      const libAddress = (await DeployUtils.deployContract(signer, lib)).address;
      const librariesObj: Libraries = {};
      librariesObj[lib] = libAddress;
      _factory = (await ethers.getContractFactory(
          name,
          {
            signer,
            libraries: librariesObj
          }
      )) as T;
    } else {
      _factory = (await ethers.getContractFactory(
          name,
          signer
      )) as T;
    }
    const instance = await _factory.deploy(...args);
    log.info('Deploy tx:', instance.deployTransaction.hash);
    await instance.deployed();

    const receipt = await ethers.provider.getTransactionReceipt(instance.deployTransaction.hash);
    console.log('DEPLOYED: ', name, receipt.contractAddress);

    if (hre.network.name !== 'hardhat' && network.name !== 'localhost') {
      await Misc.wait(10);
      if (args.length === 0) {
        await VerifyUtils.verify(receipt.contractAddress);
      } else {
        await VerifyUtils.verifyWithArgs(receipt.contractAddress, args);
        if (name === 'ProxyControlled') {
          await VerifyUtils.verifyProxy(receipt.contractAddress);
        }
      }
    }

    return _factory.attach(receipt.contractAddress);
  }
//endregion Contract connection

//region Core
  /**
   * Instantiate all core contracts
   */
  public static async deployCore(
      governance: SignerWithAddress
      , firstEpoch = 100
  ) : Promise<CoreInstances>{
    const networkTokenFabric = await ethers.getContractFactory('MockERC20');
    const networkToken = await networkTokenFabric.deploy('MockWMATIC', 'MockWMATIC', 18);
    console.log("Network token", networkToken.address);

    const rewardTokenFabric = await ethers.getContractFactory('MockERC20');
    const rewardToken = await rewardTokenFabric.deploy('MockTETU', 'MockTETU', 18);
    console.log("Reward token", rewardToken.address);

    const usdcTokenFabric = await ethers.getContractFactory('MockERC20');
    const usdcToken = await usdcTokenFabric.deploy('MockUSDC', 'MockUSDC', 18);
    console.log("USDC token", usdcToken.address);

    // deploy contracts
    let controller = (await DeployUtils.deployContract(governance, 'Controller')) as Controller;
    let requestsManager = (await DeployUtils.deployContract(governance, 'RequestsManager')) as RequestsManager;
    let companyManager = (await DeployUtils.deployContract(governance, 'CompanyManager')) as CompanyManager;
    let clerk =  (await DeployUtils.deployContract(governance, 'PaymentsManager')) as PaymentsManager;
    let debtsManager = (await DeployUtils.deployContract(governance, 'DebtsManager')) as DebtsManager
    let priceOracle = (await DeployUtils.deployContract(governance, 'PriceOracle')) as PriceOracle;
    let pair = (await getMockUniswapV2Pair(governance, usdcToken.address, rewardToken.address));
    let approvalsManager = (await DeployUtils.deployContract(governance, 'ApprovalsManager')) as ApprovalsManager;
    let batchReader = (await DeployUtils.deployContract(governance, 'BatchReader')) as BatchReader;

    // deploy readers
//    let companyManagerReader = (await Deploy.deployContract(governance, 'CompanyManagerReader')) as CompanyManagerReader;
//    let requestsManagerReader = (await Deploy.deployContract(governance, 'RequestsManagerReader')) as RequestsManagerReader;
//    let debtsManagerReader = (await Deploy.deployContract(governance, 'DebtsManagerReader')) as DebtsManagerReader;

    // initialize deployed contracts
    await controller.initialize(
        companyManager.address
        , requestsManager.address
        , debtsManager.address
        , priceOracle.address
        , clerk.address
        , approvalsManager.address
        , batchReader.address
    );

    await clerk.initialize(controller.address);

    await companyManager.initialize(
        controller.address
        , rewardToken.address
    );
    await companyManager.initRoles(
        ["novice", "educated", "blessed", "nomarch"]
        , [1, 1, 1, 2] // count of required approvals
    );

    await requestsManager.initialize(
        controller.address
    );

    await debtsManager.initialize(
        controller.address
        , firstEpoch
    );

    await priceOracle.initialize(
        controller.address
        , pair.address
        , rewardToken.address
        , usdcToken.address
    );

    await approvalsManager.initialize(controller.address);

    await batchReader.initialize(controller.address);

    return new CoreInstances(
        networkToken
        , rewardToken
        , usdcToken
        , controller
        , companyManager
        , requestsManager
        , clerk
        , debtsManager
        , priceOracle
        , pair
        , approvalsManager
        , batchReader
        // , companyManagerReader
        // , requestsManagerReader
        // , debtsManagerReader
    );
  }
//endregion Core
}
