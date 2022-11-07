import {
  DeploySolutionUtils
} from "./DeploySolutionUtils";
import {IBorrowManager__factory, ITetuConverter__factory} from "../../typechain";
import {ethers, network} from "hardhat";
import {DeployerUtils} from "../utils/DeployerUtils";
import {MaticAddresses} from "../addresses/MaticAddresses";
import {parseUnits} from "ethers/lib/utils";
import {RunHelper} from "../utils/RunHelper";

/**
 * Deploy TetuConverter application to blockchain.
 * 1) Deploy all core contracts
 * 2) Deploy all Platform adapters and pool adapters
 * 3) Set up controller and borrow manager by default settings
 *
 * Set required network in .env, i.e.
 *      APP_HARDHAT_CHAIN_ID=137
 * and run one of the following commands to run the script on stand-alone hardhat:
 *      npx hardhat run scripts/deploy/DeploySolution.ts
 *      npx hardhat run --network localhost scripts/deploy/DeploySolution.ts
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

  // // temp
  // const hundredFinancePairs = {
  //   leftAssets: [
  //     '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
  //     '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
  //     '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
  //     '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
  //     '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
  //     '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
  //     '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
  //     '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
  //     '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
  //     '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
  //     '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
  //     '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
  //     '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
  //     '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
  //     '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619'
  //   ],
  //   rightAssets: [
  //     '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
  //     '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
  //     '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
  //     '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
  //     '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6',
  //     '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
  //     '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
  //     '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
  //     '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6',
  //     '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
  //     '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
  //     '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6',
  //     '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
  //     '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6',
  //     '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6'
  //   ]
  // }
  //
  // console.log(hundredFinancePairs);
  // const borrowManager = IBorrowManager__factory.connect("0xFeF97155dCd95b92b45160a73E9969fC54E991ac", signer);
  // await RunHelper.runAndWait(
  //   () => borrowManager.addAssetPairs(
  //     "0xa2846c834B9D32250e2B62447b0Ad0b9930f7B6C",
  //     hundredFinancePairs.leftAssets,
  //     hundredFinancePairs.rightAssets,
  //     {gasLimit: 8_000_000}
  //   )
  // );
  const deployCoreResults = await DeploySolutionUtils.runMain(signer);

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