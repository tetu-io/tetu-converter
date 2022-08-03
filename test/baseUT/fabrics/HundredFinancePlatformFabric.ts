import {IBorrowManager, IBorrowManager__factory, IController, IERC20__factory} from "../../../typechain";
import {ILendingPlatformFabric} from "../TetuConverterApp";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {HundredFinanceHelper} from "../../../scripts/integration/helpers/HundredFinanceHelper";
import {AdaptersHelper} from "../AdaptersHelper";

export class HundredFinancePlatformFabric implements ILendingPlatformFabric {
    async createAndRegisterPools(deployer: SignerWithAddress, controller: IController) : Promise<IERC20[]> {
        const comptroller = await HundredFinanceHelper.getComptroller(deployer);

        const converter = await AdaptersHelper.createHundredFinancePoolAdapter(deployer);

        const platformAdapter = await AdaptersHelper.createHundredFinancePlatformAdapter(
            deployer
            , controller.address
            , comptroller.address
            , converter.address
            , [
                MaticAddresses.hDAI,
                MaticAddresses.hMATIC,
                MaticAddresses.hUSDC,
                MaticAddresses.hETH,
                MaticAddresses.hFRAX,
                MaticAddresses.hLINK,
                MaticAddresses.hUSDT,
                MaticAddresses.hWBTC
            ]
            , MaticAddresses.HUNDRED_FINANCE_ORACLE
        );

        const bm = IBorrowManager__factory.connect(await controller.borrowManager(), deployer);
        const assets: string[] = [
            MaticAddresses.DAI
            , MaticAddresses.WMATIC
            , MaticAddresses.USDC
            , MaticAddresses.WETH
            , MaticAddresses.USDT
            , MaticAddresses.WBTS
        ];
        await bm.addPool(platformAdapter.comptroller(), assets);

        return [
            IERC20__factory.connect(comptroller.address, deployer)
        ]
    }
}