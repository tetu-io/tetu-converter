import {ILendingPlatformFabric} from "./ILendingPlatformFabric";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  CTokenMock,
  IBorrowManager__factory,
  IController,
  IERC20,
  IERC20__factory,
  PriceOracleMock
} from "../../../typechain";
import {MocksHelper} from "../helpers/MocksHelper";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {BalanceUtils} from "../utils/BalanceUtils";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {generateAssetPairs} from "../utils/AssetPairUtils";

export class MockPlatformFabric implements ILendingPlatformFabric {
  public underlyings: string[];
  public borrowRates: BigNumber[];
  public collateralFactors: number[];
  public liquidityNumbers: number[];
  public cTokens: CTokenMock[];
  public holders: string[];
  public prices: BigNumber[];

  constructor (
    underlyings: string[]
    , borrowRates: BigNumber[]
    , collateralFactors: number[]
    , liquidity: number[]
    , holders: string[]
    , cTokens: CTokenMock[]
    , prices: BigNumber[]
  ) {
    this.underlyings = underlyings;
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
      , this.underlyings || []
      , this.prices || []
    )) as PriceOracleMock;

    const liquidity = await Promise.all(
      this.liquidityNumbers.map( async (x, index) => {
        return getBigNumberFrom(x, await this.cTokens[index].decimals())
      })
    );
    for (let i = 0; i < this.holders.length; ++i) {
      await BalanceUtils.getAmountFromHolder(this.underlyings[i]
        , this.holders[i]
        , pool.address
        , this.liquidityNumbers[i]
      );
    }

    const platformAdapter = await MocksHelper.createPlatformAdapterMock(
      deployer
      , pool
      , controller.address
      , converter.address
      , this.underlyings
      , this.borrowRates
      , this.collateralFactors
      , liquidity
      , this.cTokens
      , priceOracle.address
    );

    const bm = IBorrowManager__factory.connect(await controller.borrowManager(), deployer);
    const assetPairs = generateAssetPairs(this.underlyings);
    await bm.addAssetPairs(platformAdapter.address
      , assetPairs.map(x => x.smallerAddress)
      , assetPairs.map(x => x.biggerAddress)
    );

    console.log("Mock pool was added to BM", platformAdapter.address);

    return [
      IERC20__factory.connect(pool.address, deployer)
    ]
  }
}