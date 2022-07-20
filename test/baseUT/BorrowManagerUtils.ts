import {ethers} from "hardhat";
import {BigNumber} from "ethers";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
    BorrowManager,
    Controller,
    CTokenMock,
    LendingPlatformMock,
    MockERC20,
    PoolMock,
    PriceOracleMock
} from "../../typechain";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";


export interface IPoolInfo {
    /** The length of array should be equal to the count of underlines */
    borrowRateInTokens: number[],
    /** The length of array should be equal to the count of underlines */
    availableLiquidityInTokens: number[]
}

export class BorrowManagerUtils {
//region Fabrics
    public static async generateAdapter(
        signer: SignerWithAddress
        , pool: PoolMock
        , underlines: string[]
        , borrowRates: BigNumber[]
        , collateralFactors: number[]
        , liquidity: BigNumber[]
    ) : Promise<LendingPlatformMock> {
        // we cannot pass 0.8 to mul, we will have https://links.ethers.org/v5-errors-NUMERIC_FAULT-underflow
        // so:  0.8 => 80 and reduce decimals 18 => 16
        const cfs = collateralFactors.map(x => (BigNumber.from(10).pow(16)).mul(x * 100));
        return (await DeployUtils.deployContract(signer
            , "LendingPlatformMock"
            , underlines.map(x => pool.address)
            , underlines
            , cfs
            , borrowRates
            , liquidity
        )) as LendingPlatformMock;
    }

    public static async generateAssets(decimals: number[]) : Promise<MockERC20[]> {
        const dest: MockERC20[] = [];

        for (let i = 0; i < decimals.length; ++i) {
            const d = decimals[i];
            const fabric = await ethers.getContractFactory('MockERC20');
            const token = await fabric.deploy(`MockToken-${i}-${d}`, `MockToken-${i}-${d}`, d);
            dest.push(token);
        }

        return dest;
    }

    public static async generateCTokens(signer: SignerWithAddress, decimals: number[], underlines: string[]) : Promise<CTokenMock[]> {
        const dest: CTokenMock[] = [];

        for (let i = 0; i < decimals.length; ++i) {
            const d = decimals[i];
            const token = await DeployUtils.deployContract(
                signer
                , "CTokenMock"
                , `cToken-${i}-${d}`
                , `cToken-${i}-${d}`
                , d
                , underlines[i]
            ) as CTokenMock;
            dest.push(token);
        }

        return dest;
    }

    public static async generatePool(signer: SignerWithAddress, cTokens: CTokenMock[]) : Promise<PoolMock> {
        const dest = await DeployUtils.deployContract(
            signer
            , "PoolMock"
            , cTokens.map(x => x.address)
        ) as PoolMock;

        return dest;
    }

    /** Create BorrowManager with mock as adapter */
    public static async createBorrowManager (
        signer: SignerWithAddress,
        underlines: MockERC20[],
        prices: BigNumber[]
    ) : Promise<BorrowManager> {
        const controller = (await DeployUtils.deployContract(signer, "Controller")) as Controller;
        const priceOracle = (await DeployUtils.deployContract(signer, "PriceOracleMock"
            , underlines.map(x => x.address)
            , prices
        )) as PriceOracleMock;
        await controller.initialize([await controller.priceOracleKey()], [priceOracle.address]);

        const bm = (await DeployUtils.deployContract(
            signer,
            "BorrowManager",
            controller.address
        )) as BorrowManager;
        return bm;
    }
//endregion Fabrics

//region Initialize Borrow manager
/**
 * Generate N pools with same set of underlines.
 * Create new BorrowManager and add each pool as a separate platform
 */
public static async initializeBorrowManager(
    signer: SignerWithAddress,
    poolsInfo: IPoolInfo[],
    collateralFactors: number[],
    pricesUSD: number[],
    underlineDecimals: number[],
    cTokenDecimals: number[]
) : Promise<{
    poolAssets: MockERC20[],
    pools: string[],
    bm: BorrowManager
}> {
    const underlines = await BorrowManagerUtils.generateAssets(underlineDecimals);
    const bm = await BorrowManagerUtils.createBorrowManager(
        signer,
        underlines,
        pricesUSD.map(x => BigNumber.from(10).pow(16).mul(x * 100))
    );
    const pools: string[] = [];

    for (let i = 0; i < poolsInfo.length; ++i) {
        const cTokens = await BorrowManagerUtils.generateCTokens(signer, cTokenDecimals, underlines.map(x => x.address));
        const pool = await BorrowManagerUtils.generatePool(signer, cTokens);
        console.log("underlines", underlines.map(x => x.address));
        console.log("cTokens", cTokens.map(x => x.address));
        console.log("pool", pool.address);

        const borrowRateInTokens = 1;
        const availableLiquidityInTokens = 10_000;

        const borrowRates = underlines.map(
            (token, index) => getBigNumberFrom(poolsInfo[i].borrowRateInTokens[index], underlineDecimals[index])
        );
        const availableLiquidities = underlines.map(
            (token, index) => getBigNumberFrom(poolsInfo[i].availableLiquidityInTokens[index], underlineDecimals[index])
        );

        const platformAdapter = await BorrowManagerUtils.generateAdapter(
            signer,
            pool,
            underlines.map(x => x.address),
            borrowRates,
            collateralFactors,
            availableLiquidities
        );

        const templatePoolAdapter = ethers.Wallet.createRandom().address; //!TODO

        await bm.addPool(pool.address
            , platformAdapter.address
            , templatePoolAdapter
            , underlines.map(x => x.address)
        );

        pools.push(pool.address);
    }

    return {poolAssets: underlines, pools, bm};
}
//endregion Initialize Borrow manager
}