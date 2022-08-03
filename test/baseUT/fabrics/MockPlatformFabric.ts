import {ILendingPlatformFabric} from "../SetupTetuConverterApp";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {CTokenMock, IBorrowManager__factory, IController} from "../../../typechain";
import {MocksHelper} from "../MocksHelper";
import {BigNumber} from "ethers";

export class MockPlatformFabric implements ILendingPlatformFabric {
    public underlines: string[];
    public borrowRates: BigNumber[];
    public collateralFactors2: number[];
    public liquidity: BigNumber[];
    public cTokens: CTokenMock[];

    constructor (
        underlines: string[]
        , borrowRates: BigNumber[]
        , collateralFactors2: number[]
        , liquidity: BigNumber[]
        , cTokens: CTokenMock[]
    ) {
        this.underlines = underlines;
        this.borrowRates = borrowRates;
        this.collateralFactors2 = collateralFactors2;
        this.liquidity = liquidity;
        this.cTokens = cTokens;
    }
    async createAndRegisterPools(deployer: SignerWithAddress, controller: IController) : Promise<void> {
        const pool = await MocksHelper.createPoolStub(deployer);
        const converter = await MocksHelper.createPoolAdapterMock(deployer);

        const aavePlatformAdapter = await MocksHelper.createPlatformAdapterMock(
            deployer
            , pool
            , controller.address
            , converter.address
            , this.underlines
            , this.borrowRates
            , this.collateralFactors2
            , this.liquidity
            , this.cTokens
        );

        const bm = IBorrowManager__factory.connect(await controller.borrowManager(), deployer);
        await bm.addPool(aavePlatformAdapter.pool(), this.underlines);
    }
}