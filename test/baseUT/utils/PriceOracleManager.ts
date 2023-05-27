import {
  Aave3AggregatorInterfaceMock, IAavePriceOracle,
  IPriceOracle,
} from '../../../typechain';
import {BigNumber} from "ethers";

/**
 * Allow to modify prices in TetuConvertor's (=== AAVE3) price oracle
 */
export interface IPriceOracleManager {
  priceOracleAave3: IAavePriceOracle;
  priceOracleInTetuConverter: IPriceOracle;

  /**
   *
   * @param token
   * @param price Important issue: AAVE3 requires decimals 8
   */
  setPrice(token: string, price: BigNumber): Promise<void>;
  resetPrice(token: string): Promise<void>;
  decPrice(token: string, percent: number): Promise<void>;
  incPrice(token: string, percent: number): Promise<void>;
  sourceInfo(token: string): IAssetSourceInfo;
  getPrice(token: string): Promise<BigNumber>;
}

export interface IAssetSourceInfo {
  aggregator: Aave3AggregatorInterfaceMock;
  priceOriginal: BigNumber;
}

/**
 * Allow to modify prices in TetuConvertor's (=== AAVE3) price oracle
 */
export class PriceOracleManager implements IPriceOracleManager {
  public readonly sources: Map<string, IAssetSourceInfo>;
  public priceOracleAave3: IAavePriceOracle;
  public priceOracleInTetuConverter: IPriceOracle;

  constructor(
    priceOracleAave3: IAavePriceOracle,
    priceOracleInTetuConverter: IPriceOracle,
    sources: Map<string, IAssetSourceInfo>
  ) {
    this.priceOracleAave3 = priceOracleAave3;
    this.priceOracleInTetuConverter = priceOracleInTetuConverter;
    this.sources = sources;
  }

  private getSourceInfo(token: string) : IAssetSourceInfo {
    const source = this.sources.get(token);
    if (! source) {
      throw new Error(`PriceOracleManager doesn't have source for ${token}`);
    }
    return source;
  }

  public getPrice(token: string): Promise<BigNumber> {
    const source = this.getSourceInfo(token);
    return source.aggregator.price();
  }

  /**
   *
   * @param token
   * @param newPrice
   *    AAVE 3 requires decimals 8
   */
  public async setPrice(token: string, newPrice: BigNumber): Promise<void> {
    const source = this.getSourceInfo(token);
    await source.aggregator.setPrice(newPrice);
  }

  public async resetPrice(token: string): Promise<void> {
    const source = this.getSourceInfo(token);
    await source.aggregator.setPrice(source.priceOriginal);
  }

  public async decPrice(token: string, percent: number): Promise<void> {
    const source = this.getSourceInfo(token);
    const price = await source.aggregator.price();
    const newPrice = price.mul(100 - percent).div(100);
    await source.aggregator.setPrice(newPrice);
  }

  public async incPrice(token: string, percent: number): Promise<void> {
    const source = this.getSourceInfo(token);
    const price = await source.aggregator.price();
    const newPrice = price.mul(100 + percent).div(100);
    await source.aggregator.setPrice(newPrice);
  }

  public sourceInfo(token: string): IAssetSourceInfo {
    return this.getSourceInfo(token);
  }
}
