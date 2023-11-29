import {ethers, network} from "hardhat";
import {BorrowManager__factory, ConverterController__factory} from "../../typechain";
import {RunHelper} from "../utils/RunHelper";
import {BaseAddresses} from "../addresses/BaseAddresses";
import {BaseDeploySolutionUtils} from "../chains/base/deploy/BaseDeploySolutionUtils";
import {Misc} from "../utils/Misc";
import {txParams2} from "../utils/DeployHelpers";

/**
 * Add given strategy to whitelist
 *
 * Set required network in .env, i.e.
 *      APP_HARDHAT_CHAIN_ID=137
 * and run one of the following commands to run the script on stand-alone hardhat:
 *      npx hardhat run scripts/tasks/SetHealthFactors.ts
 *      npx hardhat run --network localhost scripts/tasks/SetHealthFactors.ts
 */
async function main() {
  const net = await ethers.provider.getNetwork();
  console.log(net, `network name="${network.name}"`);

  const localHardhatIsInUse = network.name === "localhost" || network.name === "hardhat";
  // if (localHardhatIsInUse) {
  //   // reset local hardhat
  //   await network.provider.request({
  //     method: "hardhat_reset",
  //     params: [],
  //   });
  // }

  const signer = await Misc.impersonate("0xF1dCce3a6c321176C62b71c091E3165CC9C3816E")
  // const signer = (await ethers.getSigners())[0];

  const controller = "0x1AC16b6aBeEE14487DE6CF946d05A0dE5169a917"; // base, v.1.2.1
  const borrowManager = await ConverterController__factory.connect(controller, signer).borrowManager();
  console.log("borrowManager", borrowManager);

  const targetHealthFactorsAssets = [
    BaseAddresses.USDC,
    BaseAddresses.USDbC,
    BaseAddresses.DAI,
    BaseAddresses.WETH,
  ];
  const targetHealthFactorsValues = [
    115, // MaticAddresses.USDC,
    115, // MaticAddresses.USDbC,
    115, // MaticAddresses.DAI,
    200, // MaticAddresses.WETH,
  ];

  const bm = BorrowManager__factory.connect(borrowManager, signer);

  console.log("show health factors before");
  for (const asset of targetHealthFactorsAssets) {
    console.log(await bm.targetHealthFactorsForAssets(asset));
  }

  console.log("setTargetHealthFactors");
  // set target health factors
  const tp = await txParams2();
  await RunHelper.runAndWait(
    () =>  bm.setTargetHealthFactors(
      targetHealthFactorsAssets,
      targetHealthFactorsValues,
      {...tp, gasLimit: 8_000_000}
    )
  );

  console.log("show health factors after");
  for (const asset of targetHealthFactorsAssets) {
    console.log(await bm.targetHealthFactorsForAssets(asset));
  }

}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });