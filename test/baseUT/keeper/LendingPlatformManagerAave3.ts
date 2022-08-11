import {ILendingPlatformManager, PairAPRs} from "./ILendingPlatformManager";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
    Aave3PoolAdapter,
    Aave3PriceOracleMock,
    Aave3PriceOracleMock__factory, Borrower,
    IAaveAddressesProvider__factory,
    IAavePool, IAavePool__factory, IAavePoolConigurator__factory, IERC20__factory, ITetuConverter
} from "../../../typechain";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {Aave3Helper} from "../../../scripts/integration/helpers/Aave3Helper";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {ITokenWithHolder} from "../helpers/TokenDataTypes";
import {Misc} from "../../../scripts/utils/Misc";

export class LendingPlatformManagerAave3 implements ILendingPlatformManager {
    poolAdapter: Aave3PoolAdapter;
    borrower: Borrower;
    tc: ITetuConverter;
    /** We can use ITetuConverter to make max allowed borrow,
     *  but we should use different pool adapter (not the one under the test)
     *  so we need different collateral asset.
     * */
    collateralHolder: ITokenWithHolder;
    borrowHolder: ITokenWithHolder;
    constructor(
        pa: Aave3PoolAdapter
        , borrower: Borrower
        , tc: ITetuConverter
        , collateralHolder: ITokenWithHolder
        , borrowHolder: ITokenWithHolder
    ) {
        this.poolAdapter = pa;
        this.borrower = borrower;
        this.tc = tc;
        this.collateralHolder = collateralHolder;
        this.borrowHolder = borrowHolder;
    }
//region Substitute mocks into the AAVE3-protocol
    async setupPriceOracleMock(
        deployer: SignerWithAddress,
        aave3pool: IAavePool
    ) {
        // get access to AAVE price oracle
        const aaveOracle = await Aave3Helper.getAavePriceOracle(deployer);

        // get admin address
        const aavePoolAdmin = await DeployerUtils.startImpersonate(MaticAddresses.AAVE_V3_POOL_ADMIN);

        // deploy mock
        const mock = (await DeployUtils.deployContract(deployer
            , "Aave3PriceOracleMock"
            , await aaveOracle.ADDRESSES_PROVIDER()
            , await aaveOracle.BASE_CURRENCY()
            , await aaveOracle.BASE_CURRENCY_UNIT()
            , await aaveOracle.getFallbackOracle()
        )) as Aave3PriceOracleMock;

        // copy current prices from real price oracle to the mock
        const aavePool = await Aave3Helper.getAavePool(deployer);
        const reserves = await aavePool.getReservesList();
        const prices = await aaveOracle.getAssetsPrices(reserves);
        await mock.setPrices(reserves, prices);

        // install the mock to the protocol
        const aaveAddressProviderAsAdmin = IAaveAddressesProvider__factory.connect(
            await aavePool.ADDRESSES_PROVIDER()
            , aavePoolAdmin
        );
        await aaveAddressProviderAsAdmin.setPriceOracle(mock.address);
    }
//endregion Substitute mocks into the AAVE3-protocol

//region ILendingPlatformManager
    /** Increase or decrease a price of the asset on the given number of times */
    async changeAssetPrice(signer: SignerWithAddress, asset: string, inc: boolean, times: number) {
        const oracle = Aave3PriceOracleMock__factory.connect(await this.poolAdapter.priceOracle(), signer);
        const currentPrice = await oracle.getAssetPrice(asset);

        await oracle.setPrices(
            [
                asset
            ], [
                inc ? currentPrice.mul(times) : currentPrice.div(times)
            ]
        );
    }

    /** Change collateral factor of the asset on new value, decimals 2 */
    async changeCollateralFactor(signer: SignerWithAddress, newValue2: number) {
        const collateralAsset = (await this.poolAdapter.getConfig()).outCollateralAsset;

        // get admin address
        const aavePoolAdmin = await DeployerUtils.startImpersonate(MaticAddresses.AAVE_V3_POOL_ADMIN);
        const aavePool = await Aave3Helper.getAavePool(signer);
        const aaveAddressProvider = IAaveAddressesProvider__factory.connect(
            await aavePool.ADDRESSES_PROVIDER()
            , signer
        );

        const poolConfiguratorAsAdmin = IAavePoolConigurator__factory.connect(
            await aaveAddressProvider.getPoolConfigurator()
            , aavePoolAdmin
        );
        const ltvConfig = await Aave3Helper.getReserveLtvConfig(aavePool, collateralAsset);
        await aavePool.getReserveData(collateralAsset);
        await poolConfiguratorAsAdmin.configureReserveAsCollateral(collateralAsset,
            // LTV must be less than liquidationThreshold
            newValue2 - (ltvConfig.liquidationThreshold.toNumber() - ltvConfig.ltv.toNumber())
            , newValue2
            , ltvConfig.liquidationBonus
        );
    }

    /** Borrow max possible amount (and significantly increase the borrow rate) */
    async makeMaxBorrow(signer: SignerWithAddress): Promise<PairAPRs> {
        const before = await this.poolAdapter.getAPR18();

        const borrowAsset = this.borrowHolder.address;
        const collateralAsset = this.collateralHolder.address;

        // let's try to make borrow for all collateral amount that the holder have
        const collateralAmount = await IERC20__factory.connect(collateralAsset, signer)
            .balanceOf(this.collateralHolder.holder);

        // Let's borrow max possible amount for provided collateral
        await IERC20__factory.connect(collateralAsset
            , await DeployerUtils.startImpersonate(this.collateralHolder.address)
        ).transfer(this.borrower.address, collateralAmount);
        await this.borrower.makeBorrowUC1_1(
            collateralAsset
            , collateralAmount
            , borrowAsset
            , this.collateralHolder.address //put borrowed amount on the balance of borrow-holder
        );

        const after = await this.poolAdapter.getAPR18();
        return {before, after};
    }
    /** Return previously borrowed amount back (reverse to makeMaxBorrow) */
    async releaseMaxBorrow(signer: SignerWithAddress): Promise<PairAPRs> {
        const before = await this.poolAdapter.getAPR18();

        const borrowAssetAsHolder = await IERC20__factory.connect(this.borrowHolder.address
            , await DeployerUtils.startImpersonate(this.borrowHolder.address)
        );
        // Let's put all borrow-asset on balance of borrower
        await borrowAssetAsHolder.transfer(this.borrower.address
            , await borrowAssetAsHolder.balanceOf(borrowAssetAsHolder.address)
        );
        await this.borrower.makeRepayUC1_2(
            this.collateralHolder.address
            , borrowAssetAsHolder.address
            , this.collateralHolder.address
        );
        const after = await this.poolAdapter.getAPR18();
        return {before, after};
    }
//endregion ILendingPlatformManager
}