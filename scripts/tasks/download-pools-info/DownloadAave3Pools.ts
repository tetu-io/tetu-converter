import {ethers} from "hardhat";
import {DownloadAave3Pools} from "../../integration/aave3/DownloadAave3Pools";
import {BaseAddresses} from "../../addresses/BaseAddresses";

/**
 * Download detailed info for all available AAVE pools
 *     npx hardhat run scripts/tasks/download-pools-info/DownloadAave3Pools.ts
 *     npx hardhat run --network localhost scripts/tasks/download-pools-info/DownloadAave3Pools.ts
 */
async function main() {
  // const aavePoolAddress = MaticAddresses.AAVE_V3_POOL;
  const aavePoolAddress = BaseAddresses.AAVE_V3_POOL;
  const chainTitle = (await ethers.provider.getNetwork()).name;
  const signer = (await ethers.getSigners())[0];

  await DownloadAave3Pools.downloadAave3PoolsToCsv(signer, aavePoolAddress, `./tmp/${chainTitle}-aave3_reserves.csv`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });