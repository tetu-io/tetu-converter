/**
 * Help to initialize and setup Borrow Manager and related classes
 */
import {
    Controller,
    CTokenMock,
    IController,
    LendingPlatformMock,
    MockERC20, PoolAdapterMock,
    PoolMock,
    PriceOracleMock
} from "../../typechain";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BigNumber} from "ethers";
import {ethers} from "hardhat";

/** Helper to create mock contracts */
export class MocksHelper {
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

    public static async createPoolAdapterMock(
        signer: SignerWithAddress,
        collateralFactorValue: BigNumber
    ) : Promise<PoolAdapterMock> {
        return (await DeployUtils.deployContract(signer
            , "PoolAdapterMock"
            , collateralFactorValue
        )) as PoolAdapterMock;
    }

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

}