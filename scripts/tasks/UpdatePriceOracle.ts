import {ethers, network} from "hardhat";
import {ConverterController__factory, IERC20Metadata__factory, ITetuConverter__factory} from "../../typechain";
import {RunHelper} from "../utils/RunHelper";
import {CoreContractsHelper} from "../../test/baseUT/app/CoreContractsHelper";
import {ZkevmAddresses} from "../addresses/ZkevmAddresses";
import {TokenUtils} from "../utils/TokenUtils";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {Misc} from "../utils/Misc";

/**
 * Add given strategy to whitelist
 *
 * Set required network in .env, i.e.
 *      APP_HARDHAT_CHAIN_ID=137
 * and run one of the following commands to run the script on stand-alone hardhat:
 *      npx hardhat run scripts/tasks/UpdatePriceOracle.ts
 *      npx hardhat run --network localhost scripts/tasks/UpdatePriceOracle.ts
 */
async function main() {
  const net = await ethers.provider.getNetwork();
  console.log(net, `network name="${network.name}"`);

  const signer = (await ethers.getSigners())[0];
  console.log("signer", signer.address);

  const CONVERTER_CONTROLLER = "0xF992a90B4F2D59B65548bF9766a02ee8170E7F07";
  const priceOracle = await CoreContractsHelper.createPriceOracleKeomZkevm(signer, ZkevmAddresses.KEOM_PRICE_ORACLE);
  console.log("Price oracle", priceOracle.address);

  const converterController = ConverterController__factory.connect(CONVERTER_CONTROLLER, signer);
  await RunHelper.runAndWait2(converterController.populateTransaction.setPriceOracle(priceOracle.address));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });