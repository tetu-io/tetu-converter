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

  const controller = "0x1af41663f309A38Ef097086C6772732Bea912d69"; // "0x63f007c13969352B35d2f2B099F2F0E1d860276a";
  const strategies = [
    "0x3f7684264d2Bf954C44d7B339dB5871c3E00Cd46", // "0x98Ac07aA456B9C2A50BBba9606d80fEaeaEB3843",
    "0x01907Db606B3b66b5A57d9a2386C95124BEada6f", // "0xA14Dea6E48B3187c5e637C88b84d5Dfc701edeB7"
    "0x87afc4441583dC32578DC9873d3073241fED9f78"
  ]; //"0xAe9842896507ba6D926E38BD1E560c3874B9a80c"; // "0x807a528818113a6f65b7667a59a4CaaAc719fc12";

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