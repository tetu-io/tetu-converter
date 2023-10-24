import {ethers, network} from "hardhat";
import {BorrowManager__factory, ConverterController__factory} from "../../typechain";
import {RunHelper} from "../utils/RunHelper";
import {BaseAddresses} from "../addresses/BaseAddresses";
import {BaseDeploySolutionUtils} from "../chains/base/deploy/BaseDeploySolutionUtils";
import {Misc} from "../utils/Misc";
import {txParams2} from "../utils/DeployHelpers";

//region Platform adapters
async function createPlatformAdapterMoonwell(
  deployer: SignerWithAddress,
  controller: string,
  comptroller: string,
  cTokensActive: string[],
) : Promise<IPlatformAdapterResult> {
  const converterNormal = await AdaptersHelper.createMoonwellPoolAdapter(deployer);
  const platformAdapter = await AdaptersHelper.createMoonwellPlatformAdapter(
    deployer,
    controller,
    comptroller,
    converterNormal.address,
    cTokensActive,
  );

  return {
    lendingPlatformTitle: "Moonwell",
    converters: [converterNormal.address],
    platformAdapterAddress: platformAdapter.address,
    cTokensActive,
  }
}
//endregion Platform adapters

/**
 * Add given strategy to whitelist
 *
 * Set required network in .env, i.e.
 *      APP_HARDHAT_CHAIN_ID=137
 * and run one of the following commands to run the script on stand-alone hardhat:
 *      npx hardhat run scripts/tasks/ReplacePlatformAdapter.ts
 *      npx hardhat run --network localhost scripts/tasks/ReplacePlatformAdapter.ts
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
    // (await ethers.getSigners())[0];


  const controller = "0x1AC16b6aBeEE14487DE6CF946d05A0dE5169a917"; // base, v.1.2.1
  const borrowManager = await ConverterController__factory.connect(controller, signer).borrowManager();
  console.log("borrowManager", borrowManager);

  const moonwellComptroller = BaseAddresses.MOONWELL_COMPTROLLER;
  const moonwellCTokens = [
    BaseAddresses.MOONWELL_USDC,
    BaseAddresses.MOONWELL_USDBC,
    BaseAddresses.MOONWELL_DAI,
    BaseAddresses.MOONWELL_WETH,
  ];
  const moonwellPairs = BaseDeploySolutionUtils.generateAssetPairs([
    BaseAddresses.USDC,
    BaseAddresses.USDbC,
    BaseAddresses.DAI,
    BaseAddresses.WETH,
  ]);

  const bm = BorrowManager__factory.connect(borrowManager, signer);
  console.log("Show registered adapters");
  const platformAdaptersLength = (await bm.platformAdaptersLength()).toNumber();
  console.log("platformAdaptersLength", platformAdaptersLength);
  for (let i = 0; i < platformAdaptersLength; ++i) {
    const address = await bm.platformAdaptersAt(i);
    console.log("address", address);
  }

  console.log("Unregister registered adapters");
  await RunHelper.runAndWait(
    () => BorrowManager__factory.connect(borrowManager, signer).removeAssetPairs(
      "0x263830dC01d74c31483d3cFC04c9E4E5741eC7D7",
      moonwellPairs.leftAssets,
      moonwellPairs.rightAssets
    )
  );

  console.log("Deploy new platform adapter and pool adapter");
  const platformAdapterMoonwell = await BaseDeploySolutionUtils.createPlatformAdapterMoonwell(
    signer,
    controller,
    moonwellComptroller,
    moonwellCTokens,
  );

  console.log("Register new adapters");
  const tp = await txParams2();
  await RunHelper.runAndWait(
    () => borrowManager.addAssetPairs(
      platformAdapter,
      assetPairs.leftAssets,
      assetPairs.rightAssets,
      {...tp, gasLimit: GAS_DEPLOY_LIMIT}
    )
  );

  console.log("Show registered adapters");
  const platformAdaptersLength2 = (await bm.platformAdaptersLength()).toNumber();
  console.log("platformAdaptersLength", platformAdaptersLength2);
  for (let i = 0; i < platformAdaptersLength2; ++i) {
    const address = await bm.platformAdaptersAt(i);
    console.log("address", address);
  }

}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });