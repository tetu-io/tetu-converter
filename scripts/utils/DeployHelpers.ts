import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { providers } from 'ethers';
import { formatUnits, parseUnits } from 'ethers/lib/utils';
import { ethers } from 'hardhat';

// tslint:disable-next-line:no-var-requires
const hreLocal = require('hardhat');

export async function txParams(hre: HardhatRuntimeEnvironment, provider: providers.Provider) {

  const gasPrice = (await provider.getGasPrice()).toNumber();
  console.log('Gas price:', formatUnits(gasPrice, 9));
  if (hre.network.name === 'hardhat') {
    return {
      maxPriorityFeePerGas: parseUnits('1', 9),
      maxFeePerGas: (gasPrice * 1.5).toFixed(0),
    };
  } else if (hre.network.config.chainId === 137) {
    return {
      maxPriorityFeePerGas: parseUnits('50', 9),
      maxFeePerGas: (gasPrice * 3).toFixed(0),
    };
  } else if (hre.network.config.chainId === 1) {
    return {
      maxPriorityFeePerGas: parseUnits('1', 9),
      maxFeePerGas: (gasPrice * 1.5).toFixed(0),
    };
  }
  return {
    gasPrice: (gasPrice * 1.1).toFixed(0),
  };
}

export async function txParams2() {
  return txParams(hreLocal, ethers.provider);
}

export async function getDeployedContractByName(name: string): Promise<string> {
  const { deployments } = hreLocal;
  const contract = await deployments.get(name);
  if (!contract) {
    throw new Error(`Contract ${name} not deployed`);
  }
  return contract.address;
}