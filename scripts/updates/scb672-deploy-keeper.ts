import {ethers, network} from "hardhat";
import {DeployUtils} from "../utils/DeployUtils";
import {writeFileSyncRestoreFolder} from "../../test/baseUT/utils/FileUtils";

/**
 * Deploy updated keeper.
 *
 * Run one of the following commands to run the script:
 *      npx hardhat run scripts/updates/scb672-deploy-keeper.ts
 *      npx hardhat run --network localhost scripts/updates/scb672-deploy-keeper.ts
 */
async function main() {
  const destPathTxt = "tmp/deployed.txt";

  const net = await ethers.provider.getNetwork();
  console.log(net, `network name="${network.name}"`);

  const signer =  (await ethers.getSigners())[0];

  const keeper = await DeployUtils.deployContract(signer, "Keeper");
  console.log("Keeper", keeper.address);

  writeFileSyncRestoreFolder(destPathTxt, `Keeper: ${keeper.address}\n`, { encoding: 'utf8', flag: 'a' });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });