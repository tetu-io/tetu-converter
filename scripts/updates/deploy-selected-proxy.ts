import {ethers, network} from "hardhat";
import {DeployUtils} from "../utils/DeployUtils";
import {writeFileSyncRestoreFolder} from "../../test/baseUT/utils/FileUtils";
import {Bookkeeper__factory, ConverterController__factory, ProxyControlled} from "../../typechain";
import {RunHelper} from "../utils/RunHelper";

/**
 * Deploy selected contracts.
 *
 * Run one of the following commands to run the script:
 *      npx hardhat run scripts/updates/deploy-selected-proxy.ts
 *      npx hardhat run --network localhost scripts/updates/deploy-selected-proxy.ts
 */
async function main() {
  const destPathTxt = "tmp/deployed.txt";
  const contractName = "Bookkeeper";

  const net = await ethers.provider.getNetwork();
  console.log(net, `network name="${network.name}"`);

  const signer =  (await ethers.getSigners())[0];

  const proxy = await DeployUtils.deployProxy(signer, contractName);
  console.log(`${contractName}`, proxy);

  const bookkeeper = Bookkeeper__factory.connect(proxy, signer);
  await RunHelper.runAndWait(
    () => bookkeeper.init("0x2df21e2a115fcB3d850Fbc67237571bBfB566e99")
  )

  writeFileSyncRestoreFolder(destPathTxt, `${contractName}: ${proxy}\n`, { encoding: 'utf8', flag: 'a' });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });