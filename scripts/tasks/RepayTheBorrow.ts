import {ethers, network} from "hardhat";
import {RepayTheBorrowImpl} from "./RepayTheBorrowImpl";

/**
 * Close borrow of the strategy forcibly
 *
 * Set required network in .env, i.e.
 *      APP_HARDHAT_CHAIN_ID=137
 * and run one of the following commands to run the script on stand-alone hardhat:
 *      npx hardhat run scripts/tasks/RepayTheBorrow.ts
 *      npx hardhat run --network localhost scripts/tasks/RepayTheBorrow.ts
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

  const tetuConverterAddress = "0x081735DEa3D1256881B7cb31cd37c4f7C3E95152";
  const strategyAddress = "0x807a528818113a6f65b7667a59a4CaaAc719fc12";
  const poolAdapterAddress = "0xa20F9638C027cD40549C918972062690f6D095bD";

  // const signer = localHardhatIsInUse
  //   ? await DeployerUtils.startImpersonate("TODO governance")
  //   : (await ethers.getSigners())[0];
  const signer = (await ethers.getSigners())[0];
  console.log("signer", signer.address);

  await RepayTheBorrowImpl.callRepayTheBorrow(
    signer,
    tetuConverterAddress,
    strategyAddress,
    poolAdapterAddress
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });