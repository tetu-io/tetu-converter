import {DownloadAave3Pools} from "../../../../scripts/integration/aave3/DownloadAave3Pools";
import {BaseAddresses} from "../../../../scripts/addresses/BaseAddresses";
import {ethers, network} from "hardhat";
import {BASE_NETWORK_ID, HardhatUtils, POLYGON_NETWORK_ID} from "../../../../scripts/utils/HardhatUtils";
import {Misc} from "../../../../scripts/utils/Misc";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";

describe("study base network", () => {
  it("should download", async () => {
    await HardhatUtils.setupBeforeTest(BASE_NETWORK_ID);

    const p = ethers.provider;
    const aavePoolAddress = BaseAddresses.AAVE_V3_POOL;

    const chainTitle = Misc.getChainName();
    const chainId = Misc.getChainId()
    const chainTitle2 = (await ethers.provider.getNetwork()).name;
    const chainTitle3 = HardhatUtils.getNetworkName(chainId);
    console.log(chainTitle, chainId, chainTitle2, chainTitle3);

    const signer = (await ethers.getSigners())[0];

    await DownloadAave3Pools.downloadAave3PoolsToCsv(signer, aavePoolAddress, `./tmp/${chainTitle3}-aave3_reserves.csv`)
  });
})