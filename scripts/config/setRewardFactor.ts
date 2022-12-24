import {ethers, network} from "hardhat";
import {DeployerUtils} from "../utils/DeployerUtils";
import {BorrowManager__factory, IBorrowManager__factory} from "../../typechain";
import {RunHelper} from "../utils/RunHelper";

/**
 * Set rewards factor to 0
 *
 *     npx hardhat run scripts/config/setRewardFactor.ts
 *      npx hardhat run --network localhost scripts/config/setRewardFactor.ts
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

  console.log("signer", signer.address);

  const borrowManagerAddress = "0xFeF97155dCd95b92b45160a73E9969fC54E991ac";
  const borrowManager = BorrowManager__factory.connect(borrowManagerAddress, signer);

  const before = await borrowManager.rewardsFactor();
  await RunHelper.runAndWait(
    () => borrowManager.setRewardsFactor(0)
  );

  const after = await borrowManager.rewardsFactor();

  console.log(`Rewards factor before=${before} after=${after}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });