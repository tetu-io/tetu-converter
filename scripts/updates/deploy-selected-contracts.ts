import {ethers, network} from "hardhat";
import {DeployUtils} from "../utils/DeployUtils";
import {writeFileSyncRestoreFolder} from "../../test/baseUT/utils/FileUtils";

/**
 * Deploy selected contracts.
 *
 * Run one of the following commands to run the script:
 *      npx hardhat run scripts/updates/deploy-selected-contracts.ts
 *      npx hardhat run --network localhost scripts/updates/deploy-selected-contracts.ts
 */
async function main() {
  const destPathTxt = "tmp/deployed.txt";
  const contractsToUpdate = [
    // "TetuConverter",
    "BorrowManager",
    "ConverterController",
    "DebtMonitor",
  ];

  const net = await ethers.provider.getNetwork();
  console.log(net, `network name="${network.name}"`);

  const signer =  (await ethers.getSigners())[0];

  for (const contractName of contractsToUpdate) {
    const newImplementation = await DeployUtils.deployContract(signer, contractName);
    console.log(contractName, newImplementation.address);
    writeFileSyncRestoreFolder(destPathTxt, `${contractName}: ${newImplementation.address}\n`, { encoding: 'utf8', flag: 'a' });
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });