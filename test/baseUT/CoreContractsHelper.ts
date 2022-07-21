import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
    BorrowManager,
    Controller, DebtMonitor,
    IController, LendingPlatformMock,
    MockERC20, PoolAdapterMock,
    PoolMock,
    PriceOracleMock
} from "../../typechain";
import {BigNumber} from "ethers";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";
import {MocksHelper} from "./MocksHelper";
import {IPoolInfo} from "./BorrowManagerHelper";

export class CoreContractsHelper {
    static async createControllerWithPrices(
        deployer: SignerWithAddress,
        underlines?: MockERC20[],
        prices?: BigNumber[]
    ) : Promise<Controller>{
        const controller = (await DeployUtils.deployContract(deployer, "Controller")) as Controller;
        const priceOracle = (await DeployUtils.deployContract(deployer, "PriceOracleMock"
            , underlines ? underlines.map(x => x.address) : []
            , prices || []
        )) as PriceOracleMock;
        await controller.initialize(
            [
                await controller.priceOracleKey()
                , await controller.governanceKey()
            ], [
                priceOracle.address
                , deployer.address
            ]
        );
        return controller;
    }

    public static async createDebtMonitor(
        signer: SignerWithAddress,
        controller: IController,
    ): Promise<DebtMonitor> {
        return (await DeployUtils.deployContract(
            signer,
            "DebtMonitor",
            controller.address
        )) as DebtMonitor;
    }

    /** Create BorrowManager with mock as adapter */
    public static async createBorrowManager (
        signer: SignerWithAddress,
        controller: IController,
    ) : Promise<BorrowManager> {
        return (await DeployUtils.deployContract(
            signer,
            "BorrowManager",
            controller.address
        )) as BorrowManager;
    }

    /**
     * Generate N pools with same set of underlines.
     * Create new BorrowManager and add each pool as a separate platform
     */
    public static async addPool(
        signer: SignerWithAddress,
        bm: BorrowManager,
        pool: PoolMock,
        poolsInfo: IPoolInfo,
        collateralFactors: number[],
        underlines: MockERC20[],
        collateralFactorForTemplatePoolAdapter: BigNumber = BigNumber.from(1)
    ) : Promise <{
        platformAdapter: LendingPlatformMock,
        templatePoolAdapter: PoolAdapterMock
    }>{
        const borrowRates = await Promise.all(underlines.map(
            async (token, index) => getBigNumberFrom(
                poolsInfo.borrowRateInTokens[index],
                await underlines[index].decimals()
            )
        ));
        const availableLiquidities = await Promise.all(underlines.map(
            async (token, index) => getBigNumberFrom(
                poolsInfo.availableLiquidityInTokens[index],
                await underlines[index].decimals()
            )
        ));

        const platformAdapter = await MocksHelper.createPlatformAdapterMock(
            signer,
            pool,
            underlines.map(x => x.address),
            borrowRates,
            collateralFactors,
            availableLiquidities
        );

        const templatePoolAdapter = await MocksHelper.createPoolAdapterMock(
            signer,
            collateralFactorForTemplatePoolAdapter
        );

        await bm.addPool(pool.address
            , platformAdapter.address
            , templatePoolAdapter.address
            , underlines.map(x => x.address)
        );

        return {platformAdapter, templatePoolAdapter};
    }
}