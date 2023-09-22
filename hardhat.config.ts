import {config as dotEnvConfig} from "dotenv";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-web3";
import "@nomiclabs/hardhat-solhint";
// import '@openzeppelin/hardhat-upgrades';
import "@typechain/hardhat";
// import "hardhat-docgen";
import "hardhat-contract-sizer";
import "hardhat-gas-reporter";
import "hardhat-tracer";
// import "hardhat-etherscan-abi";
import "solidity-coverage"
import "hardhat-abi-exporter"
import {task} from "hardhat/config";
import {deployContract} from "./scripts/utils/DeployContract";
import "hardhat-change-network";
import { EnvSetup } from './scripts/utils/EnvSetup';

task("deploy1", "Deploy contract", async function (args, hre, runSuper) {
  const [signer] = await hre.ethers.getSigners();
// tslint:disable-next-line:ban-ts-ignore
  // @ts-ignore
  const name = args.name;
  await deployContract(hre, signer, name)
}).addPositionalParam("name", "Name of the smart contract to deploy");

export default {
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
      chainId: EnvSetup.getEnv().hardhatChainId,
      timeout: 99999999,
      blockGasLimit: 0x1fffffffffffff,
      gas: EnvSetup.getEnv().hardhatChainId === 1 ? 19_000_000 :
        EnvSetup.getEnv().hardhatChainId === 137 ? 19_000_000 :
          9_000_000,
      forking: EnvSetup.getEnv().hardhatChainId !== 31337 ? {
        url:
          EnvSetup.getEnv().hardhatChainId === 1 ? EnvSetup.getEnv().ethRpcUrl :
            EnvSetup.getEnv().hardhatChainId === 137 ? EnvSetup.getEnv().maticRpcUrl :
              EnvSetup.getEnv().hardhatChainId === 8453 ? EnvSetup.getEnv().baseRpcUrl :
              undefined,
        blockNumber:
          EnvSetup.getEnv().hardhatChainId === 1 ? EnvSetup.getEnv().ethForkBlock !== 0 ? EnvSetup.getEnv().ethForkBlock : undefined :
            EnvSetup.getEnv().hardhatChainId === 137 ? EnvSetup.getEnv().maticForkBlock !== 0 ? EnvSetup.getEnv().maticForkBlock : undefined :
              EnvSetup.getEnv().hardhatChainId === 8453 ? EnvSetup.getEnv().baseForkBlock !== 0 ? EnvSetup.getEnv().baseForkBlock : undefined :
              undefined,
      } : undefined,
      accounts: {
        mnemonic: 'test test test test test test test test test test test junk',
        path: 'm/44\'/60\'/0\'/0',
        accountsBalance: '100000000000000000000000000000',
      },
      loggingEnabled: EnvSetup.getEnv().hardhatLogsEnabled
    },
    matic: {
      url: EnvSetup.getEnv().maticRpcUrl || '',
      chainId: 137,
      accounts: [EnvSetup.getEnv().privateKey],
    },
    eth: {
      url: EnvSetup.getEnv().ethRpcUrl || '',
      chainId: 1,
      accounts: [EnvSetup.getEnv().privateKey],
    },
    sepolia: {
      url: EnvSetup.getEnv().sepoliaRpcUrl || '',
      chainId: 11155111,
      // gas: 50_000_000_000,
      accounts: [EnvSetup.getEnv().privateKey],
    },
    base: {
      url: EnvSetup.getEnv().baseRpcUrl || '',
      chainId: 8453,
      accounts: [EnvSetup.getEnv().privateKey],
    },
  },
  etherscan: {
    //  https://hardhat.org/plugins/nomiclabs-hardhat-etherscan.html#multiple-api-keys-and-alternative-block-explorers
    apiKey: {
      mainnet: EnvSetup.getEnv().networkScanKey,
      goerli: EnvSetup.getEnv().networkScanKey,
      sepolia: EnvSetup.getEnv().networkScanKey,
      polygon: EnvSetup.getEnv().networkScanKeyMatic || EnvSetup.getEnv().networkScanKey,
      base: EnvSetup.getEnv().networkScanKeyBase || EnvSetup.getEnv().networkScanKey,
    },
  },
  verify: {
    etherscan: {
      apiKey: EnvSetup.getEnv().networkScanKey
    }
  },
  solidity: {
    compilers: [
      {
        version: '0.8.17',
        settings: {
          optimizer: {
            enabled: true,
            runs: 150,
          },
        },
      },
    ],
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
  mocha: {
    timeout: 9999999999,
  },
  contractSizer: {
    alphaSort: false,
    runOnCompile: false,
    disambiguatePaths: false,
  },
  gasReporter: {
    enabled: false,
    currency: 'USD',
    gasPrice: 21,
  },
  typechain: {
    outDir: 'typechain',
  },
  abiExporter: {
    path: './artifacts/abi',
    runOnCompile: false,
    spacing: 2,
    pretty: true,
  }
};
