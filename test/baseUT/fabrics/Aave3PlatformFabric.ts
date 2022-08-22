import {IBorrowManager, IBorrowManager__factory, IController, IERC20, IERC20__factory} from "../../../typechain";
import {Aave3Helper} from "../../../scripts/integration/helpers/Aave3Helper";
import {AdaptersHelper} from "../helpers/AdaptersHelper";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {ILendingPlatformFabric} from "./ILendingPlatformFabric";

export class Aave3PlatformFabric implements ILendingPlatformFabric {
  async createAndRegisterPools(deployer: SignerWithAddress, controller: IController) : Promise<IERC20[]> {
    const aavePool = await Aave3Helper.getAavePool(deployer);

    const templateAdapterNormal = await AdaptersHelper.createAave3PoolAdapter(deployer);
    const templateAdapterEMode = await AdaptersHelper.createAave3PoolAdapterEMode(deployer);

    const aavePlatformAdapter = await AdaptersHelper.createAave3PlatformAdapter(
      deployer
      , controller.address
      , aavePool.address
      , templateAdapterNormal.address
      , templateAdapterEMode.address
    );

    const bm = IBorrowManager__factory.connect(await controller.borrowManager(), deployer);
    const assets: string[] = [
      MaticAddresses.DAI
      , MaticAddresses.USDC
      , MaticAddresses.USDT
      , MaticAddresses.EURS
      , MaticAddresses.jEUR
      , MaticAddresses.BALANCER
      , MaticAddresses.WBTS
      , MaticAddresses.WETH
      , MaticAddresses.WMATIC
      , MaticAddresses.SUSHI
      , MaticAddresses.CRV
      , MaticAddresses.agEUR
    ];
    await bm.addPool(aavePlatformAdapter.address, assets);

    return [
      IERC20__factory.connect(aavePool.address, deployer)
    ]
  }
}