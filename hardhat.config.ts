import {config as dotEnvConfig} from "dotenv";
import "@nomiclabs/hardhat-waffle";
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
//import "hardhat-etherscan-abi";
import "solidity-coverage"
import "hardhat-abi-exporter"

dotEnvConfig();

// tslint:disable-next-line:no-var-requires
const argv = require('yargs/yargs')()
    .env('APP')
    .options({
      hardhatChainId: {
        type: "number",
        default: 31337
      },
      maticRpcUrl: {
        type: "string",
        default: ''
      },
      mumbaiRpcUrl: {
        type: "string",
        default: ''
      },
      ethRpcUrl: {
        type: "string",
        default: ''
      },
      ftmRpcUrl: {
        type: "string",
        default: ''
      },
			fujiRpcUrl: {
      	type: "string",
	      default: 'https://api.avax-test.network/ext/bc/C/rpc'
  	  },
      networkScanKey: {
        type: "string",
        default: ''
      },
    	networkScanKeyRinkeby: {
      	type: "string",
    	},
      privateKey: {
        type: "string",
        default: "b55c9fcc2c60993e5c539f37ffd27d2058e7f77014823b461323db5eba817518" // random account
      },
      maticForkBlock: {
        type: "number",
      },
      mumbaiForkBlock: {
        type: "number",
      },
      ftmForkBlock: {
        type: "number",
      },
      rinkebyForkBlock: {
        type: "number",
      },
			networkScanKeyAvalanche: {
        type: "string",
			}
    }).argv;

export default {
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
      chainId: !!argv.hardhatChainId ? argv.hardhatChainId : undefined,
      timeout: 99999 * 2,
      gas: argv.hardhatChainId === 137 ? 19_000_000 :
          argv.hardhatChainId === 80001 ? 19_000_000 :
              undefined,
      forking: argv.hardhatChainId !== 31337 && argv.hardhatChainId !== 1337  ? {
        url:
          argv.hardhatChainId === 1 ? argv.ethRpcUrl :
            argv.hardhatChainId === 137 ? argv.maticRpcUrl :
              argv.hardhatChainId === 250 ? argv.ftmRpcUrl :
                undefined,
        blockNumber:
          argv.hardhatChainId === 1 ? argv.ethForkBlock !== 0 ? argv.ethForkBlock : undefined :
            argv.hardhatChainId === 137 ? argv.maticForkBlock !== 0 ? argv.maticForkBlock : undefined :
              argv.hardhatChainId === 250 ? argv.ftmForkBlock !== 0 ? argv.ftmForkBlock : undefined :
                undefined
      } : undefined,
      accounts: {
        mnemonic: "test test test test test test test test test test test junk",
        path: "m/44'/60'/0'/0",
        accountsBalance: "100000000000000000000000000000"
      }
    },
    matic: {
      url: argv.maticRpcUrl || '',
      timeout: 99999,
      chainId: 137,
      // gas: 19_000_000,
      // gasPrice: 100_000_000_000,
      gasMultiplier: 1.3,
      accounts: [argv.privateKey],
    },
    mumbai: {
      url: argv.mumbaiRpcUrl || '',
      chainId: 80001,
      timeout: 99999,
      // gasPrice: 100_000_000_000,
      accounts: [argv.privateKey],
    },
    ftm: {
      url: argv.ftmRpcUrl || '',
      chainId: 250,
      timeout: 99999,
      accounts: [argv.privateKey],
    },
    rinkeby: {
      url: argv.rinkebyRpcUrl || '',
      timeout: 99999,
      chainId: 4,
      accounts: [argv.privateKey],
    },
    fuji: { // Avalanche FUJI C-Chain, see https://docs.avax.network/dapps/launch-your-ethereum-dapp
      url: argv.fujiRpcUrl || '',
      //timeout: 99999,
      chainId: 43113,
      accounts: [argv.privateKey],
    },
    localhost: {
      timeout: 99999,
    },
  },
  etherscan: {
    apiKey: {
      mainnet: argv.networkScanKey,
      polygon: argv.networkScanKeyMatic || argv.networkScanKey,
      rinkeby: argv.networkScanKeyRinkeby || argv.networkScanKey,
			avalancheFujiTestnet: argv.networkScanKeyFuji || argv.networkScanKey
    },

  },
  solidity: {
    compilers: [
      {
        version: "0.8.4",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          }
        }
      },
    ]
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  mocha: {
    timeout: 9999999999
  },
	contractSizer: {
    alphaSort: true,
    disambiguatePaths: false,
    runOnCompile: false,
    strict: true,
		only: [
		]
	},
  gasReporter: {
    enabled: false,
    currency: 'USD',
    gasPrice: 21,
		outputFile: "./gasreport.txt",
		noColors: true
  },
  typechain: {
    outDir: "typechain",
  },
  abiExporter: {
    path: './artifacts/abi',
    runOnCompile: false,
    spacing: 2,
    pretty: false,
  },
};
