import {ILendingPlatformFabric} from "../TetuConverterApp";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
    CTokenMock,
    IBorrowManager__factory,
    IController,
    IERC20,
    IERC20__factory,
    PriceOracleMock
} from "../../../typechain";
import {MocksHelper} from "../MocksHelper";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {BalanceUtils} from "../BalanceUtils";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";

export class MockPlatformFabric implements ILendingPlatformFabric {
    public underlines: string[];
    public borrowRates: BigNumber[];
    public collateralFactors: number[];
    public liquidityNumbers: number[];
    public cTokens: CTokenMock[];
    public holders: string[];
    public prices: BigNumber[];

    constructor (
        underlines: string[]
        , borrowRates: BigNumber[]
        , collateralFactors: number[]
        , liquidity: number[]
        , holders: string[]
        , cTokens: CTokenMock[]
        , prices: BigNumber[]
    ) {
        this.underlines = underlines;
        this.borrowRates = borrowRates;
        this.collateralFactors = collateralFactors;
        this.liquidityNumbers = liquidity;
        this.cTokens = cTokens;
        this.holders = holders;
        this.prices = prices;
    }
    async createAndRegisterPools(deployer: SignerWithAddress, controller: IController) : Promise<IERC20[]> {
        const pool = await MocksHelper.createPoolStub(deployer);
        const converter = await MocksHelper.createPoolAdapterMock(deployer);
        const priceOracle = (await DeployUtils.deployContract(deployer, "PriceOracleMock"
            , this.underlines || []
            , this.prices || []
        )) as PriceOracleMock;

        const liquidity = await Promise.all(
            this.liquidityNumbers.map( async (x, index) => {
                return getBigNumberFrom(x, await this.cTokens[index].decimals())
            })
        );
        for (let i = 0; i < this.holders.length; ++i) {
            await BalanceUtils.getAmountFromHolder(this.underlines[i]
                , this.holders[i]
                , pool.address
                , this.liquidityNumbers[i]
            );
        }

        const aavePlatformAdapter = await MocksHelper.createPlatformAdapterMock(
            deployer
            , pool
            , controller.address
            , converter.address
            , this.underlines
            , this.borrowRates
            , this.collateralFactors
            , liquidity
            , this.cTokens
            , priceOracle.address
        );



        const bm = IBorrowManager__factory.connect(await controller.borrowManager(), deployer);
        await bm.addPool(aavePlatformAdapter.address, this.underlines);

        return [
            IERC20__factory.connect(pool.address, deployer)
        ]
    }
}