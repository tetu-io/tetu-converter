import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Logger} from "tslog";
import logSettings from "../../log_settings";
import {ContractFactory, providers, utils} from "ethers";
import {Libraries} from "hardhat-deploy/dist/types";
import {formatUnits} from "ethers/lib/utils";
import {RunHelper} from "./RunHelper";
import {ProxyControlled} from "../../typechain";
import {txParams} from "./DeployHelpers";

const log: Logger<unknown> = new Logger(logSettings);

const libraries = new Map<string, string>([
  ['Compound3AprLibFacade', 'Compound3AprLib'],
  ['TetuConverter', 'TetuConverterLogicLib'],
]);
// tslint:disable-next-line:no-var-requires
const hre = require("hardhat");

export const WAIT_BLOCKS_BETWEEN_DEPLOY = 5;

export class DeployUtils {
  static async deployContract<T extends ContractFactory>(
    signer: SignerWithAddress,
    name: string,
    // tslint:disable-next-line:no-any
    ...args: any[]
  ) {
    return deployContract(hre, signer, name, ...args);
  }

  public static async deployProxy(signer: SignerWithAddress, contract: string) {
    const logic = await DeployUtils.deployContract(signer, contract);
    const proxy = await DeployUtils.deployContract(signer, 'ProxyControlled') as ProxyControlled;
    await RunHelper.runAndWait2(proxy.populateTransaction.initProxy(logic.address));
    return proxy.address;
  }
}

export async function deployContract<T extends ContractFactory>(
  // tslint:disable-next-line
  hre: any,
  signer: SignerWithAddress,
  name: string,
  // tslint:disable-next-line:no-any
  ...args: any[]
) {
  if (hre.network.name !== 'hardhat') {
    await hre.run("compile")
  }

  const ethers = hre.ethers;
  log.info(`Deploying ${name}`);
  log.info("Account balance: " + utils.formatUnits(await signer.getBalance(), 18));

  const gasPrice = await ethers.provider.getGasPrice();
  log.info("Gas price: " + formatUnits(gasPrice, 9));
  const lib: string | undefined = libraries.get(name);
  let _factory;
  if (lib) {
    log.info('DEPLOY LIBRARY', lib, 'for', name);
    const libAddress = (await deployContract(hre, signer, lib)).address;
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
  let gas = 5_000_000;
  if (hre.network.name === 'hardhat') {
    gas = 999_999_999;
  } else if (hre.network.name === 'mumbai') {
    gas = 5_000_000;
  }

  const instance = await _factory.deploy(...args, {
    // large gas limit is required for npm run coverage
    // see https://github.com/NomicFoundation/hardhat/issues/3121
    gasLimit: hre.network.name === 'hardhat' ? 29_000_000 : undefined,
    ...(await txParams(hre, signer.provider as providers.Provider))
  });

  // const instance = await _factory.deploy(...args);
  log.info('Deploy tx:', instance.deployTransaction.hash);
  await instance.deployed();

  const receipt = await ethers.provider.getTransactionReceipt(instance.deployTransaction.hash);
  console.log('DEPLOYED: ', name, receipt.contractAddress);

  if (hre.network.name !== 'hardhat') {
    await wait(hre, WAIT_BLOCKS_BETWEEN_DEPLOY);
    if (args.length === 0) {
      await verify(hre, receipt.contractAddress);
    } else {
      await verifyWithArgs(hre, receipt.contractAddress, args);
    }
  }
  return _factory.attach(receipt.contractAddress);
}

// tslint:disable-next-line:no-any
async function wait(hre: any, blocks: number) {
  if (hre.network.name === 'hardhat') {
    return;
  }
  const start = hre.ethers.provider.blockNumber;
  while (true) {
    log.info('wait 10sec');
    await delay(10000);
    if (hre.ethers.provider.blockNumber >= start + blocks) {
      break;
    }
  }
}

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// tslint:disable-next-line:no-any
async function verify(hre: any, address: string) {
  try {
    await hre.run("verify:verify", {
      address
    })
  } catch (e) {
    log.info('error verify ' + e);
  }
}

// tslint:disable-next-line:no-any
async function verifyWithArgs(hre: any, address: string, args: any[]) {
  try {
    await hre.run("verify:verify", {
      address, constructorArguments: args
    })
  } catch (e) {
    log.info('error verify ' + e);
  }
}
