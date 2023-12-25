import {ethers, network} from "hardhat";
import {DeployUtils} from "../utils/DeployUtils";
import {writeFileSyncRestoreFolder} from "../../test/baseUT/utils/FileUtils";
import {Bookkeeper__factory, ConverterController__factory, ProxyControlled} from "../../typechain";
import {RunHelper} from "../utils/RunHelper";

/**
 * Deploy selected contracts.
 *
 * Run one of the following commands to run the script:
 *      npx hardhat run scripts/updates/deploy-any-action.ts
 *      npx hardhat run --network localhost scripts/updates/deploy-any-action.ts
 */
async function main() {
  const net = await ethers.provider.getNetwork();
  console.log(net, `network name="${network.name}"`);

  const signer =  (await ethers.getSigners())[0];

  const proxy = Bookkeeper__factory.connect("0x588cE8be7ac5202cD7C7fD10Be65E33D26dA2534", signer);
  await RunHelper.runAndWait(
    () => proxy.init("0x1AC16b6aBeEE14487DE6CF946d05A0dE5169a917")
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });