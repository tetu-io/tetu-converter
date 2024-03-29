import {IBorrowManager, IBorrowManager__factory, IConverterController, IERC20__factory} from "../../../../typechain";
import {Aave3Helper} from "../../../../scripts/integration/aave3/Aave3Helper";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {ILendingPlatformFabric, ILendingPlatformPoolInfo} from "./ILendingPlatformFabric";
import {generateAssetPairs} from "../../utils/AssetPairUtils";
import {AdaptersHelper} from "../../app/AdaptersHelper";

export class Aave3PlatformFabric implements ILendingPlatformFabric {
  async createAndRegisterPools(deployer: SignerWithAddress, controller: IConverterController) : Promise<ILendingPlatformPoolInfo> {
    const aavePool = await Aave3Helper.getAavePool(deployer, MaticAddresses.AAVE_V3_POOL);

    const templateAdapterNormal = await AdaptersHelper.createAave3PoolAdapter(deployer);
    const templateAdapterEMode = await AdaptersHelper.createAave3PoolAdapterEMode(deployer);

    const aavePlatformAdapter = await AdaptersHelper.createAave3PlatformAdapter(
      deployer,
      controller.address,
      aavePool.address,
      templateAdapterNormal.address,
      templateAdapterEMode.address
    );

    const bm = IBorrowManager__factory.connect(await controller.borrowManager(), deployer);
    const assets: string[] = [
      MaticAddresses.DAI,
      MaticAddresses.USDC,
      MaticAddresses.USDT,
      MaticAddresses.EURS,
      MaticAddresses.jEUR,
      MaticAddresses.BALANCER,
      MaticAddresses.WBTC,
      MaticAddresses.WETH,
      MaticAddresses.WMATIC,
      MaticAddresses.SUSHI,
      MaticAddresses.CRV,
      MaticAddresses.agEUR,
    ];
    const assetPairs = generateAssetPairs(assets);
    await bm.addAssetPairs(aavePlatformAdapter.address,
      assetPairs.map(x => x.smallerAddress),
      assetPairs.map(x => x.biggerAddress),
    );

    return {
      pool: IERC20__factory.connect(aavePool.address, deployer),
      platformAdapter: aavePlatformAdapter.address
    }
  }

  static async unregisterPlatformAdapter(borrowManagerAsGov: IBorrowManager, platformAdapter: string) {
    const assets: string[] = [
      MaticAddresses.DAI,
      MaticAddresses.USDC,
      MaticAddresses.USDT,
      MaticAddresses.EURS,
      MaticAddresses.jEUR,
      MaticAddresses.BALANCER,
      MaticAddresses.WBTC,
      MaticAddresses.WETH,
      MaticAddresses.WMATIC,
      MaticAddresses.SUSHI,
      MaticAddresses.CRV,
      MaticAddresses.agEUR,
    ];
    const assetPairs = generateAssetPairs(assets);
    await borrowManagerAsGov.removeAssetPairs(platformAdapter,
      assetPairs.map(x => x.smallerAddress),
      assetPairs.map(x => x.biggerAddress),
    );
  }
}
