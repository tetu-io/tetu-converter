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
  const strategyAddress = "0x792Bcc2f14FdCB9FAf7E12223a564e7459eA4201";
  const poolAdapterAddress = "0x67874287b175eAe2e1bc51E1fEf505C6d2fFad84";
  const borrowManagerAddress = "0xB8D18aBEA83eaF336aEe55E58490f785d629baAE";

  // const signer = localHardhatIsInUse
  //   ? await DeployerUtils.startImpersonate("TODO governance")
  //   : (await ethers.getSigners())[0];
  const signer = (await ethers.getSigners())[0];
  console.log("signer", signer.address);

  await RepayTheBorrowImpl.callRepayTheBorrow(
    signer,
    tetuConverterAddress,
    strategyAddress,
    poolAdapterAddress,
    borrowManagerAddress
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });