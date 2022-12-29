import {IBorrowManager__factory, IController, IERC20, IERC20__factory} from "../../../typechain";
import {ILendingPlatformFabric} from "./ILendingPlatformFabric";
import {AdaptersHelper} from "../helpers/AdaptersHelper";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {AaveTwoHelper} from "../../../scripts/integration/helpers/AaveTwoHelper";
import {generateAssetPairs} from "../utils/AssetPairUtils";

export class AaveTwoPlatformFabric implements ILendingPlatformFabric {
  async createAndRegisterPools(deployer: SignerWithAddress, controller: IController) : Promise<IERC20[]> {
    const aavePool = await AaveTwoHelper.getAavePool(deployer);
    const templateAdapterNormal = await AdaptersHelper.createAaveTwoPoolAdapter(deployer);
    const aavePlatformAdapter = await AdaptersHelper.createAaveTwoPlatformAdapter(
      deployer,
      controller.address,
      aavePool.address,
      templateAdapterNormal.address
    );

    const bm = IBorrowManager__factory.connect(await controller.borrowManager(), deployer);
    const assets: string[] = [
      MaticAddresses.DAI
      , MaticAddresses.USDC
      , MaticAddresses.USDT
      , MaticAddresses.BALANCER
      , MaticAddresses.WBTC
      , MaticAddresses.WETH
      , MaticAddresses.WMATIC
      , MaticAddresses.SUSHI
      , MaticAddresses.CRV
      , MaticAddresses.CHAIN_LINK
      , MaticAddresses.AavegotchiGHST
      , MaticAddresses.DefiPulseToken
    ];
    const assetPairs = generateAssetPairs(assets);
    await bm.addAssetPairs(aavePlatformAdapter.address
      , assetPairs.map(x => x.smallerAddress)
      , assetPairs.map(x => x.biggerAddress)
    );

    return [
      IERC20__factory.connect(aavePool.address, deployer)
    ]
  }
}