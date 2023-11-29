import { config as dotEnvConfig } from 'dotenv';

dotEnvConfig();

export class EnvSetup {

  // tslint:disable-next-line:no-any
  public static getEnv(): any {
    // tslint:disable-next-line:no-var-requires
    return require('yargs/yargs')()
      .env('TETU')
      .options({
        hardhatChainId: {
          type: 'number',
          default: 137,
        },
        privateKey: {
          type: 'string',
          default: '85bb5fa78d5c4ed1fde856e9d0d1fe19973d7a79ce9ed6c0358ee06a4550504e', // random account
        },
        hardhatLogsEnabled: {
          type: 'boolean',
          default: false,
        },
        localSolc: {
          type: 'boolean',
          default: false,
        },
        disableBacktesting: {
          type: 'boolean',
          default: true,
        },

        /////// RPC

        ethRpcUrl: {
          type: 'string',
        },
        maticRpcUrl: {
          type: 'string',
        },
        baseRpcUrl: {
          type: 'string',
        },

        /////// BLOCKS

        maticForkBlock: {
          type: 'number',
          default: 49968469, // 49480727, // 42618407,
        },
        baseForkBlock: {
          type: 'number',
          default: 6625978, // 6100252, // 5939287, // 5725340,
        },

        /////// NETWORK EXPLORERS

        networkScanKey: {
          type: 'string',
        },
        networkScanKeyMatic: {
          type: 'string',
        },
        networkScanKeyBase: {
          type: 'string',
        },

        /////// TETU CONVERTER
        disableGasLimitControl: {
            type: 'number',
        }

      }).argv;
  }

}
