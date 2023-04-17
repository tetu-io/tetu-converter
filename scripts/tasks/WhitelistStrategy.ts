import {ethers, network} from "hardhat";
import {DeployerUtils} from "../utils/DeployerUtils";
import {ConverterController__factory, IConverterController__factory} from "../../typechain";
import {RunHelper} from "../utils/RunHelper";

/**
 * Add given strategy to whitelist
 *
 * Set required network in .env, i.e.
 *      APP_HARDHAT_CHAIN_ID=137
 * and run one of the following commands to run the script on stand-alone hardhat:
 *      npx hardhat run scripts/tasks/WhitelistStrategy.ts
 *      npx hardhat run --network localhost scripts/tasks/WhitelistStrategy.ts
 */
async function main() {
  const net = await ethers.provider.getNetwork();
  console.log(net, `network name="${network.name}"`);

  const localHardhatIsInUse = network.name === "localhost" || network.name === "hardhat";
  if (localHardhatIsInUse) {
    // reset local hardhat
    await network.provider.request({
      method: "hardhat_reset",
      params: [],
    });
  }

  const controller = "0x4c2FC0b0D5086f91e80128B498Fb14Eb989740D0";
  const strategy = "0xAe9842896507ba6D926E38BD1E560c3874B9a80c"; // "0x807a528818113a6f65b7667a59a4CaaAc719fc12";

  // const signer = localHardhatIsInUse
  //   ? await DeployerUtils.startImpersonate("TODO governance")
  //   : (await ethers.getSigners())[0];
  const signer = (await ethers.getSigners())[0];

  console.log("signer", signer.address);

  console.log("before", await ConverterController__factory.connect(controller, signer).whitelist(strategy));

  await RunHelper.runAndWait(
    () => ConverterController__factory.connect(controller, signer).setWhitelistValues([strategy], true)
  );

  console.log("after", await IConverterController__factory.connect(controller, signer).isWhitelisted(strategy));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });