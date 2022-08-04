import {IBorrowManager, IBorrowManager__factory, IController, IERC20, IERC20__factory} from "../../../typechain";
import {ILendingPlatformFabric} from "../TetuConverterApp";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {AdaptersHelper} from "../AdaptersHelper";
import {DForceHelper} from "../../../scripts/integration/helpers/DForceHelper";

export class DForcePlatformFabric implements ILendingPlatformFabric {
    async createAndRegisterPools(deployer: SignerWithAddress, controller: IController) : Promise<IERC20[]> {
        const comptroller = await DForceHelper.getController(deployer);

        const converter = await AdaptersHelper.createDForcePoolAdapter(deployer);

        const platformAdapter = await AdaptersHelper.createDForcePlatformAdapter(
            deployer
            , controller.address
            , comptroller.address
            , converter.address
            , [
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
            , MaticAddresses.HUNDRED_FINANCE_ORACLE
        );

        const bm: IBorrowManager = IBorrowManager__factory.connect(await controller.borrowManager(), deployer);
        const assets: string[] = [
            MaticAddresses.DAI
            , MaticAddresses.WMATIC
            , MaticAddresses.USDC
            , MaticAddresses.WETH
            , MaticAddresses.USDT
            , MaticAddresses.WBTS
            , MaticAddresses.dForce_USD
        ];
        await bm.addPool(platformAdapter.address, assets);

        return [
            IERC20__factory.connect(comptroller.address, deployer)
        ]
    }
}