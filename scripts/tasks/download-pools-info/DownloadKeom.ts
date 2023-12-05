import {KeomHelper} from "../../integration/keom/KeomHelper";
import {ethers, network} from "hardhat";
import {writeFileSync} from "fs";
import {HardhatUtils, POLYGON_NETWORK_ID, ZKEVM_NETWORK_ID} from "../../utils/HardhatUtils";
import {ZkevmAddresses} from "../../addresses/ZkevmAddresses";
import {MaticAddresses} from "../../addresses/MaticAddresses";

/**
 * Download detailed info for all available Hundred-finance pool(s) and tokens
 *      npx hardhat run scripts/tasks/download-pools-info/DownloadKeom.ts
 */
async function main() {
  // const chainId = ZKEVM_NETWORK_ID;
  // const nativeToken = ZkevmAddresses.KEOM_MATIC;
  // const comptrollerAddress = ZkevmAddresses.KEOM_COMPTROLLER;

  const chainId = POLYGON_NETWORK_ID;
  const nativeToken = MaticAddresses.KEOM_MATIC;
  const comptrollerAddress = MaticAddresses.KEOM_COMPTROLLER;

  await HardhatUtils.setupBeforeTest(chainId, -1);

  const signer = (await ethers.getSigners())[0];
  console.log("download zerovix info");

  const net = await ethers.provider.getNetwork();
  console.log(net, network.name);

  const comptroller = KeomHelper.getComptroller(signer, comptrollerAddress);

  const lines = await KeomHelper.getData(signer, comptroller, nativeToken);
  writeFileSync(`./tmp/keom_reserves_${chainId}.csv`, lines.join("\n"), 'utf8');
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });