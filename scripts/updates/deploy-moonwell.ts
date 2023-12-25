import {ethers, network} from "hardhat";
import {DeployUtils} from "../utils/DeployUtils";
import {writeFileSyncRestoreFolder} from "../../test/baseUT/utils/FileUtils";
import {MaticAddresses} from "../addresses/MaticAddresses";
import {
  AaveTwoPlatformAdapter,
  AaveTwoPoolAdapter, MoonwellPlatformAdapter, MoonwellPoolAdapter
} from "../../typechain";
import {BaseAddresses} from "../addresses/BaseAddresses";
import {AdaptersHelper} from "../../test/baseUT/app/AdaptersHelper";

/**
 * Deploy selected contracts.
 *
 * Run one of the following commands to run the script:
 *      npx hardhat run scripts/updates/deploy-moonwell.ts
 *      npx hardhat run --network localhost scripts/updates/deploy-moonwell.ts
 */
async function main() {
  const destPathTxt = "tmp/deployed.txt";

  const net = await ethers.provider.getNetwork();
  console.log(net, `network name="${network.name}"`);

  const signer =  (await ethers.getSigners())[0];

  const converterController = "0x1AC16b6aBeEE14487DE6CF946d05A0dE5169a917";
  const poolAdapterNormal = "0x9A1B3B13a771387d57648C1ba73bF4a3EF9d6D3a"; //(await DeployUtils.deployContract(signer, "MoonwellPoolAdapter") as MoonwellPoolAdapter).address;
  const platformAdapter = await AdaptersHelper.createMoonwellPlatformAdapter(
    signer,
    converterController,
    BaseAddresses.MOONWELL_COMPTROLLER,
    poolAdapterNormal,
    [
      BaseAddresses.MOONWELL_USDC,
      BaseAddresses.MOONWELL_USDBC,
      BaseAddresses.MOONWELL_DAI,
      BaseAddresses.MOONWELL_WETH,
    ]
  ) as MoonwellPlatformAdapter;

  writeFileSyncRestoreFolder(destPathTxt, `Moonwell.poolAdapterNormal: ${poolAdapterNormal}\n`, { encoding: 'utf8', flag: 'a' });
  writeFileSyncRestoreFolder(destPathTxt, `Moonwell.platformAdapter: ${platformAdapter.address}\n`, { encoding: 'utf8', flag: 'a' });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });