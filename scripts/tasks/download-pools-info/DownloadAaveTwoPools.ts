import {ethers, network} from "hardhat";
import {DownloadAaveTwoPools} from "../../integration/aaveTwo/DownloadAaveTwoPools";
import {MaticAddresses} from "../../addresses/MaticAddresses";

/**
 * Download detailed info for all available AAVE pools
 *    npx hardhat run scripts/tasks/download-pools-info/DownloadAaveTwoPools.ts
 */
async function main() {
  const signer = (await ethers.getSigners())[0];
  await DownloadAaveTwoPools.downloadAaveTwoPoolsToCsv(signer, MaticAddresses.AAVE_TWO_POOL, `./tmp/aave2_reserves.csv`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });