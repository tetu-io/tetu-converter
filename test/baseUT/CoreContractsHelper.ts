import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
    BorrowManager, BorrowManager__factory,
    Controller, DebtMonitor,
    IController, LendingPlatformMock,
    MockERC20, PoolAdapterMock,
    PoolStub,
    PriceOracleMock, TetuConverter
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

    public static async createTetuConverter(
        signer: SignerWithAddress,
        controller: Controller,
    ): Promise<TetuConverter> {
        return (await DeployUtils.deployContract(
            signer,
            "TetuConverter",
            controller.address
        )) as TetuConverter;
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
     * Generate single platform adapter (with attached pool).
     * Create new BorrowManager and add the pool there
     */
    public static async addPool(
        signer: SignerWithAddress,
        controller: IController,
        pool: PoolStub,
        poolsInfo: IPoolInfo,
        collateralFactors: number[],
        underlines: MockERC20[],
        cTokens: MockERC20[],
        templateAdapterPoolOptional?: string
    ) : Promise <{
        platformAdapter: LendingPlatformMock,
        templatePoolAdapter: string
    }>{
        const borrowRates = await Promise.all(underlines.map(
            async (token, index) => {
                const br = poolsInfo.borrowRateInTokens[index];
                return typeof br === "object"
                    ? br
                    : getBigNumberFrom(
                        poolsInfo.borrowRateInTokens[index],
                        await underlines[index].decimals()
                    );
            }
        ));
        const availableLiquidity = await Promise.all(underlines.map(
            async (token, index) => getBigNumberFrom(
                poolsInfo.availableLiquidityInTokens[index],
                await underlines[index].decimals()
            )
        ));

        const templatePoolAdapter = templateAdapterPoolOptional
            || (await MocksHelper.createPoolAdapterStub(signer, getBigNumberFrom(1))).address;

        const platformAdapter = await MocksHelper.createPlatformAdapterMock(
            signer,
            pool,
            controller.address,
            templatePoolAdapter,
            underlines.map(x => x.address),
            borrowRates,
            collateralFactors,
            availableLiquidity,
            cTokens
        );

        const bm = BorrowManager__factory.connect(await controller.borrowManager(), signer);

        await bm.addPool(platformAdapter.address, underlines.map(x => x.address));

        return {platformAdapter, templatePoolAdapter};
    }
}