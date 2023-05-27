import {ethers, network} from "hardhat";
import {DeployerUtils} from "../utils/DeployerUtils";
import {ConverterController__factory, IConverterController__factory} from "../../typechain";
import {RunHelper} from "../utils/RunHelper";

/**
 * Change governance
 *
 * Set required network in .env, i.e.
 *      APP_HARDHAT_CHAIN_ID=137
 * and run one of the following commands to run the script on stand-alone hardhat:
 *      npx hardhat run scripts/tasks/ChangeGovernance.ts
 *      npx hardhat run --network localhost scripts/tasks/ChangeGovernance.ts
 */
async function main() {
  const net = await ethers.provider.getNetwork();
  console.log(net, `network name="${network.name}"`);

  // const localHardhatIsInUse = network.name === "localhost" || network.name === "hardhat";
  // if (localHardhatIsInUse) {
  //   // reset local hardhat
  //   await network.provider.request({
  //     method: "hardhat_reset",
  //     params: [],
  //   });
  // }

  const controller = "0x2df21e2a115fcB3d850Fbc67237571bBfB566e99"; // v.1.1.14
  const newGovernance = "0xcc16d636dD05b52FF1D8B9CE09B09BC62b11412B";


  // const signer = localHardhatIsInUse
  //   ? await DeployerUtils.startImpersonate("TODO governance")
  //   : (await ethers.getSigners())[0];
  const signer = (await ethers.getSigners())[0];

  console.log("signer", signer.address);

  console.log("governance before", await ConverterController__factory.connect(controller, signer).governance());
  console.log("pendingGovernance before", await ConverterController__factory.connect(controller, signer).pendingGovernance());

  await RunHelper.runAndWait(
    () => ConverterController__factory.connect(controller, signer).setGovernance(newGovernance)
  );

  console.log("governance after", await ConverterController__factory.connect(controller, signer).governance());
  console.log("pendingGovernance after", await ConverterController__factory.connect(controller, signer).pendingGovernance());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });