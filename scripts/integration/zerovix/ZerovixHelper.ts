import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  IERC20Metadata__factory,
  IZerovixComptroller,
  IZerovixComptroller__factory, IZerovixInterestRateModel, IZerovixInterestRateModel__factory,
  IZerovixPriceOracle,
  IZerovixPriceOracle__factory,
  IZerovixToken, IZerovixToken__factory,
} from "../../../typechain";
import {BigNumber} from "ethers";
import {CommonUtils} from "../../../test/baseUT/utils/CommonUtils";

//region Constants


//endregion Constants

//region Data types
export interface IZerovixInterestRateModelData {
  address: string;
  name: string;
  borrowRate18: BigNumber;
  supplyRate18: BigNumber;
  timestampsPerYear: BigNumber;
}

export interface IZerovixMarketData {
  comptroller: string;
  name: string;
  symbol: string;
  decimals: number;
  ctoken: string;
  underlying: string;
  borrowRatePerTimestamp: BigNumber;
  supplyRatePerTimestamp: BigNumber;
  accrualBlockTimestamp: BigNumber;
  exchangeRateStored: BigNumber;
  /** cash balance of this cToken in the underlying asset */
  cash: BigNumber;
  /** Total amount of outstanding borrows of the underlying in this market */
  totalBorrows: BigNumber;
  /** Total amount of reserves of the underlying held in this market */
  totalReserves: BigNumber;
  /** Total number of tokens in circulation */
  totalSupply: BigNumber;
  /** Fraction of interest currently set aside for reserves */
  reserveFactorMantissa: BigNumber;
  /** isListed represents whether the comptroller recognizes this cToken */
  isListed: boolean;
  /** collateralFactorMantissa, scaled by 1e18, is multiplied by a supply balance to determine how much value can be borrowed */
  collateralFactorMantissa: BigNumber;
  closeFactorMantissa: BigNumber;
  /** Model which tells what the current interest rate should be */
  interestRateModel: string;
  borrowCap: BigNumber;
  price: BigNumber;
  underlyingDecimals: number;
}

//endregion Data types

export class ZerovixHelper {
//region Access
  public static getComptroller(signer: SignerWithAddress, comptroller: string) : IZerovixComptroller {
    return IZerovixComptroller__factory.connect(comptroller, signer);
  }

  public static async getPriceOracle(signer: SignerWithAddress, comptroller: string) : IZerovixPriceOracle {
    return IZerovixPriceOracle__factory.connect(
      await IZerovixComptroller__factory.connect(comptroller, signer).oracle(),
      signer
    );
  }
//endregion Access

//region Read data
  public static async getInterestRateModel(
    irm: IZerovixInterestRateModel,
    cToken: IZerovixToken,
  ) : Promise<IZerovixInterestRateModelData> {
    const dest: IZerovixInterestRateModelData = {
      name: "Zerovix interest rate model",
      timestampsPerYear: await irm.timestampsPerYear(),
      borrowRate18: await irm.getBorrowRate(
        await cToken.getCash(),
        await cToken.totalBorrows(),
        await cToken.totalReserves()
      ),
      supplyRate18: await irm.getSupplyRate(
        await cToken.getCash(),
        await cToken.totalBorrows(),
        await cToken.totalReserves(),
        await cToken.reserveFactorMantissa()
      ),
      address: await irm.address
    }

    return dest;
  }

  public static async getOTokenData(
    signer: SignerWithAddress,
    comptroller: IZerovixComptroller,
    cToken: IZerovixToken,
    nativeToken: string
  ) : Promise<IZerovixMarketData> {
    const m = await comptroller.markets(cToken.address);
    const irm = IZerovixInterestRateModel__factory.connect(await cToken.interestRateModel(), signer);
    const priceOracle = IZerovixPriceOracle__factory.connect(await comptroller.oracle(), signer);

    return {
      comptroller: await cToken.comptroller(),
      ctoken: cToken.address,
      underlying: cToken.address.toLowerCase() === nativeToken.toLowerCase()
        ? "" // hMATIC doesn't support CErc20Storage and doesn't have underlying property
        : await cToken.underlying(),
      name: await cToken.name(),
      symbol: await cToken.symbol(),
      decimals: await cToken.decimals(),
      borrowRatePerTimestamp: await cToken.borrowRatePerTimestamp(),
      supplyRatePerTimestamp: await cToken.supplyRatePerTimestamp(),
      accrualBlockTimestamp: await cToken.accrualBlockTimestamp(),
      exchangeRateStored: await cToken.exchangeRateStored(),
      cash: await cToken.getCash(),
      reserveFactorMantissa: await cToken.reserveFactorMantissa(),
      totalBorrows: await cToken.totalBorrows(),
      totalReserves: await cToken.totalReserves(),
      totalSupply: await cToken.totalSupply(),
      isListed: m.isListed,
      collateralFactorMantissa: m.collateralFactorMantissa,
      closeFactorMantissa: await comptroller.closeFactorMantissa(),
      interestRateModel: await cToken.interestRateModel(),
      borrowCap: await comptroller.borrowCaps(cToken.address),
      price: await priceOracle.getUnderlyingPrice(cToken.address),
      underlyingDecimals: await IERC20Metadata__factory.connect(
        cToken.address.toLowerCase() === nativeToken.toLowerCase()
          ? nativeToken
          : await cToken.underlying()
        , signer
      ).decimals(),
    }
  }
//endregion Read data

//region Get data for script
  public static async getData(
    signer: SignerWithAddress,
    comptroller: IZerovixComptroller,
    nativeToken: string
  ) : Promise<string[]> {
    const markets = await comptroller.getAllMarkets();
    const dest: string[] = [];
    dest.push([
      "name",
      "comptroller",
      "symbol", "decimals", "ctoken", "underlying",
      "borrowRatePerTimestamp",
      "supplyRatePerTimestamp",
      "accrualBlockTimestamp",
      "exchangeRateStored",
      "cash", "reserveFactorMantissa",
      "totalBorrows", "totalReserves", "totalSupply",
      "isListed", "collateralFactorMantissa",
      "closeFactorMantissa",
      "interestRateModel", "borrowCap",
      "borrowRate18", "supplyRate18", "baseRatePerTimestamp", "irmName",
      "price", "underlyingDecimals",
    ].join(","));

    const getInterestRateModel = ZerovixHelper.memoize(
      async token => ZerovixHelper.getInterestRateModel(
        IZerovixInterestRateModel__factory.connect(await token.interestRateModel(), signer),
        token
      )
    );

    for (const market of markets) {
      console.log(`Market ${market}`);

      const cToken = IZerovixToken__factory.connect(market, signer);
      const rd = await ZerovixHelper.getOTokenData(signer, comptroller, cToken, nativeToken);
      const irm = await getInterestRateModel(cToken);

      const line = [
        rd.name,
        rd.comptroller,
        rd.symbol, rd.decimals, rd.ctoken, rd.underlying,
        rd.borrowRatePerTimestamp,  rd.supplyRatePerTimestamp, rd.accrualBlockTimestamp,
        rd.exchangeRateStored,
        rd.cash, rd.reserveFactorMantissa,
        rd.totalBorrows, rd.totalReserves, rd.totalSupply,
        rd.isListed, rd.collateralFactorMantissa,
        rd.closeFactorMantissa,
        rd.interestRateModel, rd.borrowCap,
        irm.borrowRate18, irm.supplyRate18, irm.timestampsPerYear, irm.name,
        rd.price, rd.underlyingDecimals,
      ];

      dest.push(line.map(x => CommonUtils.toString(x)).join(","));
    }

    return dest;
  }
//endregion Get data for script

//region Utils
  // eslint-disable-next-line no-unused-vars
  public static memoize<T>(fn: (token: IZerovixToken) => Promise<T>) : (token: IZerovixToken) => Promise<T> {
    const cache = new Map<string, T>();
    return async (token: IZerovixToken) => {
      const irmAddress = await token.interestRateModel();
      let ret = cache.get(irmAddress);
      if (!ret) {
        ret = await fn(token);
        cache.set(irmAddress, ret);
      }
      return ret;
    }
  }
//endregion Utils
}