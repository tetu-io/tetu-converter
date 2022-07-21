/**
 * Help to initialize and setup Borrow Manager and related classes
 */
import {
    BorrowManagerMock,
    Controller,
    CTokenMock,
    IController, IDebtMonitor, IPriceOracle,
    LendingPlatformMock,
    MockERC20, PoolAdapterMock, PoolAdapterStab,
    PoolMock,
    PriceOracleMock
} from "../../typechain";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BigNumber} from "ethers";
import {ethers} from "hardhat";

/** Helper to create mock contracts */
export class MocksHelper {
//region Adapters
    /** Create template pool adapter */
    public static async createPoolAdapterMock(signer: SignerWithAddress) : Promise<PoolAdapterMock> {
        return (await DeployUtils.deployContract(signer, "PoolAdapterMock")) as PoolAdapterMock;
    }

    /** Set up pool adapter created through minimal-proxy pattern */
    public static async setupPoolAdapterMock(
        m: PoolAdapterMock
        , cTokenMock: CTokenMock
        , priceOracle: IPriceOracle
        , debtMonitor: IDebtMonitor
        , collateralFactor18: BigNumber
        , borrowTokens: MockERC20[]
        , borrowRatesPerBlock18: BigNumber[]
    ) {
        await m.setUpMock(
            cTokenMock.address
            , priceOracle.address
            , debtMonitor.address
            , collateralFactor18
            , borrowTokens.map(x => x.address)
            , borrowRatesPerBlock18
        );
    }

    /** Create platform adapter that supports a single pool with set of the given underlines */
    public static async createPlatformAdapterMock(
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

    /** Simple mock - all params are set through constructor */
    public static async createPoolAdapterStab(
        signer: SignerWithAddress,
        collateralFactorValue: BigNumber
    ) : Promise<PoolAdapterStab> {
        return (await DeployUtils.deployContract(signer
            , "PoolAdapterStab"
            , collateralFactorValue
        )) as PoolAdapterStab;
    }
//endregion Adapters

//region Tokens
    public static async createTokens(decimals: number[]) : Promise<MockERC20[]> {
        const dest: MockERC20[] = [];

        for (let i = 0; i < decimals.length; ++i) {
            const d = decimals[i];
            const fabric = await ethers.getContractFactory('MockERC20');
            const token = await fabric.deploy(`MockToken-${i}-${d}`, `MockToken-${i}-${d}`, d);
            dest.push(token);
        }

        return dest;
    }

    public static async createCTokensMocks(
        signer: SignerWithAddress,
        decimals: number[],
        underlines: string[]
    ) : Promise<CTokenMock[]> {
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
//endregion Tokens

//region Pools
    public static async createPoolMock(
        signer: SignerWithAddress,
        cTokens: CTokenMock[]
    ) : Promise<PoolMock> {
        const dest = await DeployUtils.deployContract(
            signer
            , "PoolMock"
            , cTokens.map(x => x.address)
        ) as PoolMock;

        return dest;
    }
//endregion Pools

//region Core contracts
    public static async createBorrowManagerMock(
        signer: SignerWithAddress,
        poolAdapters: string[],
        pools: string[],
        users: string[],
        collateralUnderlines: string[]
    ) : Promise<BorrowManagerMock> {
        return await DeployUtils.deployContract(
            signer
            , "BorrowManagerMock"
            , poolAdapters
            , pools
            , users
            , collateralUnderlines
        ) as BorrowManagerMock;
    }
//endregion Core contracts
}