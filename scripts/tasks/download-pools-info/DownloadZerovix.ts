import {ZerovixHelper} from "../../integration/zerovix/ZerovixHelper";
import {ethers, network} from "hardhat";
import {writeFileSync} from "fs";
import {HardhatUtils, POLYGON_NETWORK_ID, ZKEVM_NETWORK_ID} from "../../utils/HardhatUtils";
import {ZkevmAddresses} from "../../addresses/ZkevmAddresses";
import {MaticAddresses} from "../../addresses/MaticAddresses";

/**
 * Download detailed info for all available Hundred-finance pool(s) and tokens
 *      npx hardhat run scripts/tasks/download-pools-info/DownloadZerovix.ts
 */
async function main() {
  const chainId = ZKEVM_NETWORK_ID;
  const nativeToken = ZkevmAddresses.oNative;
  const comptrollerAddress = ZkevmAddresses.ZEROVIX_COMPTROLLER;

  // const chainId = POLYGON_NETWORK_ID;
  // const nativeToken = MaticAddresses.oMatic;
  // const comptrollerAddress = MaticAddresses.ZEROVIX_COMPTROLLER;

  await HardhatUtils.setupBeforeTest(chainId);

  const signer = (await ethers.getSigners())[0];
  console.log("download zerovix info");

  const net = await ethers.provider.getNetwork();
  console.log(net, network.name);

  const comptroller = ZerovixHelper.getComptroller(signer, comptrollerAddress);

  const lines = await ZerovixHelper.getData(signer, comptroller, nativeToken);
  writeFileSync(`./tmp/zerovix_reserves_${chainId}.csv`, lines.join("\n"), 'utf8');
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });