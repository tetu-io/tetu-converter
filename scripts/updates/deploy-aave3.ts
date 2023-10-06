import {
  DeploySolutionUtils
} from "./DeploySolutionUtils";
import {ethers, network} from "hardhat";
import {DeployerUtils} from "../utils/DeployerUtils";
import {DeployUtils} from "../utils/DeployUtils";
import {writeFileSyncRestoreFolder} from "../../test/baseUT/utils/FileUtils";
import {MaticAddresses} from "../addresses/MaticAddresses";
import {Aave3PlatformAdapter, Aave3PoolAdapter, Aave3PoolAdapterEMode} from "../../typechain";

/**
 * Deploy selected contracts.
 *
 * Run one of the following commands to run the script:
 *      npx hardhat run scripts/updates/deploy-aave3.ts
 *      npx hardhat run --network localhost scripts/updates/deploy-aave3.ts
 */
async function main() {
  const destPathTxt = "tmp/deployed.txt";

  const net = await ethers.provider.getNetwork();
  console.log(net, `network name="${network.name}"`);

  const signer =  (await ethers.getSigners())[0];

  const converterController = "0x2df21e2a115fcB3d850Fbc67237571bBfB566e99";
  const borrowManager = "0xC5690F7063eb60D474Bcdb38b60EbF4C3a8Ece3C";
  const poolAdapterNormal = await DeployUtils.deployContract(signer, "Aave3PoolAdapter") as Aave3PoolAdapter;
  const poolAdapterEMode = await DeployUtils.deployContract(signer, "Aave3PoolAdapterEMode") as Aave3PoolAdapterEMode;
  const platformAdapter = await DeployUtils.deployContract(
    signer,
    "Aave3PlatformAdapter",
    converterController,
    borrowManager,
    MaticAddresses.AAVE_V3_POOL,
    poolAdapterNormal.address,
    poolAdapterEMode.address
  ) as Aave3PlatformAdapter;

  writeFileSyncRestoreFolder(destPathTxt, `poolAdapterNormal: ${poolAdapterNormal.address}\n`, { encoding: 'utf8', flag: 'a' });
  writeFileSyncRestoreFolder(destPathTxt, `poolAdapterEMode: ${poolAdapterEMode.address}\n`, { encoding: 'utf8', flag: 'a' });
  writeFileSyncRestoreFolder(destPathTxt, `platformAdapter: ${platformAdapter.address}\n`, { encoding: 'utf8', flag: 'a' });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });