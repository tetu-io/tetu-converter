import {IBorrowManager, IBorrowManager__factory, IController, IERC20, IERC20__factory} from "../../../typechain";
import {ILendingPlatformFabric} from "./ILendingPlatformFabric";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {HundredFinanceHelper} from "../../../scripts/integration/helpers/HundredFinanceHelper";
import {AdaptersHelper} from "../helpers/AdaptersHelper";
import {generateAssetPairs} from "../utils/AssetPairUtils";

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
                MaticAddresses.hUSDT,
                MaticAddresses.hWBTC,
                MaticAddresses.hFRAX,
                MaticAddresses.hLINK,
            ]
        );

        const bm: IBorrowManager = IBorrowManager__factory.connect(await controller.borrowManager(), deployer);
        const assets: string[] = [
            MaticAddresses.DAI
            , MaticAddresses.WMATIC
            , MaticAddresses.USDC
            , MaticAddresses.WETH
            , MaticAddresses.USDT
            , MaticAddresses.WBTC
        ];
      const assetPairs = generateAssetPairs(assets);
      await bm.addAssetPairs(platformAdapter.address
        , assetPairs.map(x => x.smallerAddress)
        , assetPairs.map(x => x.biggerAddress)
      );

        return [
            IERC20__factory.connect(comptroller.address, deployer)
        ]
    }
}