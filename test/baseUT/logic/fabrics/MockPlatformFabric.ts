import {ILendingPlatformFabric, ILendingPlatformPoolInfo} from "./ILendingPlatformFabric";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  CTokenMock,
  IBorrowManager__factory,
  IConverterController,
  IERC20__factory,
  PriceOracleMock
} from "../../../../typechain";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../../scripts/utils/NumberUtils";
import {BalanceUtils} from "../../utils/BalanceUtils";
import {DeployUtils} from "../../../../scripts/utils/DeployUtils";
import {generateAssetPairs} from "../../utils/AssetPairUtils";
import {MocksHelper} from "../../app/MocksHelper";

export class MockPlatformFabric implements ILendingPlatformFabric {
  public assets: string[];
  public borrowRates: BigNumber[];
  public collateralFactors: number[];
  public liquidityNumbers: number[];
  public cTokens: CTokenMock[];
  public holders: string[];
  public prices: BigNumber[];

  constructor (
    underlyings: string[],
    borrowRates: BigNumber[],
    collateralFactors: number[],
    liquidity: number[],
    holders: string[],
    cTokens: CTokenMock[],
    prices: BigNumber[],
  ) {
    this.assets = underlyings;
    this.borrowRates = borrowRates;
    this.collateralFactors = collateralFactors;
    this.liquidityNumbers = liquidity;
    this.cTokens = cTokens;
    this.holders = holders;
    this.prices = prices;
  }
  async createAndRegisterPools(deployer: SignerWithAddress, controller: IConverterController) : Promise<ILendingPlatformPoolInfo> {
    const pool = await MocksHelper.createPoolStub(deployer);
    const converter = await MocksHelper.createPoolAdapterMock(deployer);
    const priceOracle = (await DeployUtils.deployContract(deployer, "PriceOracleMock",
      this.assets || [],
      this.prices || [],
    )) as PriceOracleMock;

    const liquidity = await Promise.all(
      this.liquidityNumbers.map(async (x, index) => {
        return getBigNumberFrom(x, await this.cTokens[index].decimals())
      })
    );
    for (let i = 0; i < this.holders.length; ++i) {
      await BalanceUtils.getAmountFromHolder(this.assets[i],
        this.holders[i],
        pool.address,
        this.liquidityNumbers[i],
      );
    }

    const platformAdapter = await MocksHelper.createPlatformAdapterMock(
      deployer,
      pool.address,
      controller.address,
      priceOracle.address,
      [converter.address],
      this.assets,
      this.cTokens.map(x => x.address),
      liquidity,
      this.borrowRates,
      this.collateralFactors,
    );

    const bm = IBorrowManager__factory.connect(await controller.borrowManager(), deployer);
    const assetPairs = generateAssetPairs(this.assets);
    await bm.addAssetPairs(platformAdapter.address,
      assetPairs.map(x => x.smallerAddress),
      assetPairs.map(x => x.biggerAddress),
    );

    console.log("Mock pool was added to BM", platformAdapter.address);

    return {
      pool: IERC20__factory.connect(pool.address, deployer),
      platformAdapter: platformAdapter.address
    }
  }
}
