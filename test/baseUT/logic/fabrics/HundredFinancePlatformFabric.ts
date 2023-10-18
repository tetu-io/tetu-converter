import {IBorrowManager, IBorrowManager__factory, IConverterController, IERC20, IERC20__factory} from "../../../../typechain";
import {ILendingPlatformFabric, ILendingPlatformPoolInfo} from "./ILendingPlatformFabric";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {HundredFinanceHelper} from "../../../../scripts/integration/hundred-finance/HundredFinanceHelper";
import {generateAssetPairs} from "../../utils/AssetPairUtils";
import {AdaptersHelper} from "../../app/AdaptersHelper";

export class HundredFinancePlatformFabric implements ILendingPlatformFabric {
    async createAndRegisterPools(deployer: SignerWithAddress, controller: IConverterController) : Promise<ILendingPlatformPoolInfo> {
        const comptroller = await HundredFinanceHelper.getComptroller(deployer);

        const converter = await AdaptersHelper.createHundredFinancePoolAdapter(deployer);

        const platformAdapter = await AdaptersHelper.createHundredFinancePlatformAdapter(
            deployer,
            controller.address,
            comptroller.address,
            converter.address,
            [
                MaticAddresses.hDAI,
                MaticAddresses.hMATIC,
                MaticAddresses.hUSDC,
                MaticAddresses.hETH,
                MaticAddresses.hUSDT,
                MaticAddresses.hWBTC,
                MaticAddresses.hFRAX,
                MaticAddresses.hLINK,
            ]
        );

        const bm: IBorrowManager = IBorrowManager__factory.connect(await controller.borrowManager(), deployer);
        const assets: string[] = [
            MaticAddresses.DAI,
            MaticAddresses.WMATIC,
            MaticAddresses.USDC,
            MaticAddresses.WETH,
            MaticAddresses.USDT,
            MaticAddresses.WBTC
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
}
