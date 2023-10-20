import {
  BaseDeploySolutionUtils
} from "./BaseDeploySolutionUtils";
import {ethers, network} from "hardhat";
import {DeployerUtils} from "../../../utils/DeployerUtils";

/**
 * Deploy TetuConverter application to blockchain.
 * 1) Deploy all core contracts
 * 2) Deploy all Platform adapters and pool adapters
 * 3) Set up controller and borrow manager by default settings
 *
 * Set required network in .env, i.e.
 *      APP_HARDHAT_CHAIN_ID=137
 * and run one of the following commands to run the script on stand-alone hardhat:
 *      npx hardhat run scripts/chains/base/deploy/DeploySolution.ts
 *      npx hardhat run --network localhost scripts/chains/base/deploy/DeploySolution.ts
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

  const signer = localHardhatIsInUse
    ? await DeployerUtils.startImpersonate(
      process?.env.APP_PRIVATE_GOVERNANCE_ACCOUNT_FOR_HARDHAT || (await ethers.getSigners())[0].address)
    : (await ethers.getSigners())[0];

  const proxyUpdater = signer.address; // todo tetu-contracts-v2 controller

  console.log("signer", signer.address);

  await BaseDeploySolutionUtils.runMain(signer, proxyUpdater,
    // already deployed if necessary
    {
    }
  );

  // // let's try to find a way to borrow DAI for USDC
  // const tetuConverter = ITetuConverter__factory.connect(deployCoreResults.tetuConverter, signer);
  // const plan = await tetuConverter.findConversionStrategy(
  //   MaticAddresses.DAI,
  //   parseUnits("1"),
  //   MaticAddresses.USDC,
  //   1000,
  //   0
  // );
  // console.log(plan);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });