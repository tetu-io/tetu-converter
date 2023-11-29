import {ethers, network} from "hardhat";
import {DeployUtils} from "../utils/DeployUtils";
import {writeFileSyncRestoreFolder} from "../../test/baseUT/utils/FileUtils";
import {MaticAddresses} from "../addresses/MaticAddresses";
import {
  AaveTwoPlatformAdapter,
  AaveTwoPoolAdapter
} from "../../typechain";

/**
 * Deploy selected contracts.
 *
 * Run one of the following commands to run the script:
 *      npx hardhat run scripts/updates/deploy-aaveTwo.ts
 *      npx hardhat run --network localhost scripts/updates/deploy-aaveTwo.ts
 */
async function main() {
  const destPathTxt = "tmp/deployed.txt";

  const net = await ethers.provider.getNetwork();
  console.log(net, `network name="${network.name}"`);

  const signer =  (await ethers.getSigners())[0];

  const converterController = "0x2df21e2a115fcB3d850Fbc67237571bBfB566e99";
  const borrowManager = "0xC5690F7063eb60D474Bcdb38b60EbF4C3a8Ece3C";
  const poolAdapterNormal = await DeployUtils.deployContract(signer, "AaveTwoPoolAdapter") as AaveTwoPoolAdapter;
  const platformAdapter = await DeployUtils.deployContract(
    signer,
    "AaveTwoPlatformAdapter",
    converterController,
    borrowManager,
    MaticAddresses.AAVE_TWO_POOL,
    poolAdapterNormal.address,
  ) as AaveTwoPlatformAdapter;

  writeFileSyncRestoreFolder(destPathTxt, `poolAdapterNormal: ${poolAdapterNormal.address}\n`, { encoding: 'utf8', flag: 'a' });
  writeFileSyncRestoreFolder(destPathTxt, `platformAdapter: ${platformAdapter.address}\n`, { encoding: 'utf8', flag: 'a' });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });