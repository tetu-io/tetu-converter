import {ethers, network} from "hardhat";
import {ConverterController__factory} from "../../typechain";
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

  const controller = "0x2df21e2a115fcB3d850Fbc67237571bBfB566e99"; // v.1.1.14
  const strategies = [
    "0x05C7D307632a36D31D7eECbE4cC5Aa46D15fA752",
    "0x29ce0ca8d0A625Ebe1d0A2F94a2aC9Cc0f9948F1",
    "0xa99478F79A82663f8A7f5D8DD4aD4A46e22Ea540"
  ];

  // const signer = localHardhatIsInUse
  //   ? await DeployerUtils.startImpersonate("TODO governance")
  //   : (await ethers.getSigners())[0];
  const signer = (await ethers.getSigners())[0];

  console.log("signer", signer.address);

  for (const strategy of strategies) {
    console.log("before", await ConverterController__factory.connect(controller, signer).whitelist(strategy));
  }

  await RunHelper.runAndWait(
    () => ConverterController__factory.connect(controller, signer).setWhitelistValues(strategies, true)
  );

  for (const strategy of strategies) {
    console.log("after", await ConverterController__factory.connect(controller, signer).whitelist(strategy));
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });