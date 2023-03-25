import {ethers, network} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Logger} from "tslog";
import logSettings from "../../log_settings";
import {ContractFactory, utils} from "ethers";
import {Libraries} from "hardhat-deploy/dist/types";
import {config as dotEnvConfig} from "dotenv";
import {Misc} from "./Misc";
import {VerifyUtils} from "./VerifyUtils";
import {formatUnits} from "ethers/lib/utils";

const log: Logger<unknown> = new Logger(logSettings);

const libraries = new Map<string, string>([
  ['', ''],
]);
// tslint:disable-next-line:no-var-requires
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

    const gasPrice = await ethers.provider.getGasPrice();
    log.info("Gas price: " + formatUnits(gasPrice, 9))
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
      console.log("Wait before verification");
      await Misc.wait(20); // 10
      console.log("Start verification");
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
}
