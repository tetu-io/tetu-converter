import {
  DeploySolutionUtils
} from "./DeploySolutionUtils";
import {ethers, network} from "hardhat";
import {DeployerUtils} from "../utils/DeployerUtils";
import {DeployUtils} from "../utils/DeployUtils";
import {writeFileSyncRestoreFolder} from "../../test/baseUT/utils/FileUtils";

/**
 * Deploy updated keeper.
 *
 * Run one of the following commands to run the script:
 *      npx hardhat run scripts/updates/deploy-tetu-converter.ts
 *      npx hardhat run --network localhost scripts/updates/deploy-tetu-converter.ts
 */
async function main() {
  const destPathTxt = "tmp/deployed.txt";

  const net = await ethers.provider.getNetwork();
  console.log(net, `network name="${network.name}"`);

  const signer =  (await ethers.getSigners())[0];

  const tetuConverter = await DeployUtils.deployContract(signer, "TetuConverter");
  console.log("TetuConverter", tetuConverter.address);

  writeFileSyncRestoreFolder(destPathTxt, `TetuConverter: ${tetuConverter.address}\n`, { encoding: 'utf8', flag: 'a' });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });