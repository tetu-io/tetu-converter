import {
  DForcePlatformAdapter,
  IBorrowManager,
  IBorrowManager__factory,
  IConverterController,
  IDForceController,
  IERC20__factory
} from "../../../typechain";
import {ILendingPlatformFabric, ILendingPlatformPoolInfo} from "./ILendingPlatformFabric";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {AdaptersHelper} from "../helpers/AdaptersHelper";
import {DForceHelper} from "../../../scripts/chains/polygon/integration/helpers/DForceHelper";
import {generateAssetPairs} from "../utils/AssetPairUtils";

export class DForcePlatformFabric implements ILendingPlatformFabric {
    async createAndRegisterPools(deployer: SignerWithAddress, controller: IConverterController) : Promise<ILendingPlatformPoolInfo> {
        const {comptroller, platformAdapter} = await DForcePlatformFabric.createPlatformAdapter(
          deployer,
          controller.address
        );
        await DForceHelper.getController(deployer);

        const bm: IBorrowManager = IBorrowManager__factory.connect(await controller.borrowManager(), deployer);
        const assets: string[] = [
            MaticAddresses.DAI,
            MaticAddresses.WMATIC,
            MaticAddresses.USDC,
            MaticAddresses.WETH,
            MaticAddresses.USDT,
            MaticAddresses.WBTC,
            MaticAddresses.dForce_USD
        ];
        const assetPairs = generateAssetPairs(assets);
        await bm.addAssetPairs(
          platformAdapter.address,
          assetPairs.map(x => x.smallerAddress),
          assetPairs.map(x => x.biggerAddress)
        );

        return {
          pool: IERC20__factory.connect(comptroller.address, deployer),
          platformAdapter: platformAdapter.address
        }
    }

    static async createPlatformAdapter(
      deployer: SignerWithAddress,
      controller: string
    ) : Promise<{
      comptroller: IDForceController,
      platformAdapter: DForcePlatformAdapter
    }> {
      const comptroller = await DForceHelper.getController(deployer);

      const converter = await AdaptersHelper.createDForcePoolAdapter(deployer);

      const platformAdapter = await AdaptersHelper.createDForcePlatformAdapter(
        deployer,
        controller,
        comptroller.address,
        converter.address,
        [
          MaticAddresses.dForce_iUSDC,
          MaticAddresses.dForce_iUSDT,
          MaticAddresses.dForce_iUSX,
          MaticAddresses.dForce_iDAI,
          MaticAddresses.dForce_iWETH,
          MaticAddresses.dForce_iWBTC,
          MaticAddresses.dForce_iEUX,
          MaticAddresses.dForce_iAAVE,
          MaticAddresses.dForce_iCRV,
          MaticAddresses.dForce_iDF,
          MaticAddresses.dForce_iMATIC,
        ]
      );

      return {comptroller, platformAdapter};
  }
}
