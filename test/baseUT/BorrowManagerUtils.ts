import {ethers} from "hardhat";
import {BigNumber} from "ethers";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BorrowManager, CTokenMock, LendingPlatformMock, MockERC20, PoolMock, PriceOracleMock} from "../../typechain";

export class BorrowManagerUtils {
    public static async generateDecorator(
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

    /** Create BorrowManager with mock as decorator */
    public static async createBorrowManager (
        signer: SignerWithAddress,
        underlines: MockERC20[],
        prices: BigNumber[]
    ) : Promise<BorrowManager> {
        const platformTitle = "market";
        const priceOracle = (await DeployUtils.deployContract(signer
            , "PriceOracleMock"
            , underlines.map(x => x.address)
            , prices
        )) as PriceOracleMock;

        const bm = (await DeployUtils.deployContract(
            signer,
            "BorrowManager",
            priceOracle.address
        )) as BorrowManager;
        return bm;
    }
}