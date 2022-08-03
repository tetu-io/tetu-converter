import {IBorrowManager, IBorrowManager__factory, IController} from "../../../typechain";
import {ILendingPlatformFabric} from "../SetupTetuConverterApp";
import {AaveHelper} from "../../../scripts/integration/helpers/AaveHelper";
import {AdaptersHelper} from "../AdaptersHelper";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";

export class Aave3PlatformFabric implements ILendingPlatformFabric {
    async createAndRegisterPools(deployer: SignerWithAddress, controller: IController) : Promise<void> {
        const aavePool = await AaveHelper.getAavePool(deployer);

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
        await bm.addPool(aavePlatformAdapter.pool(), assets);
    }
}