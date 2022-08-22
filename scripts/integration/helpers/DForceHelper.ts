import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  IDForceController,
  IDForceController__factory,
  IDForceCToken, IDForceCToken__factory,
  IDForceInterestRateModel__factory,
  IDForcePriceOracle,
  IDForcePriceOracle__factory, IERC20Extended__factory

} from "../../../typechain";
import {BigNumber, Signer} from "ethers";
import {Aave3Helper} from "./Aave3Helper";
import {MaticAddresses} from "../../addresses/MaticAddresses";

//region Data types
interface IHfData {
  controller: string;
  name: string;
  symbol: string;
  decimals: number;
  ctoken: string;
  underlying: string;
  /** The supply interest rate per block, scaled by 1e18 */
  borrowRatePerBlock: BigNumber;
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
  reserveRatio: BigNumber;
  /*
   *  Multiplier representing the most one can borrow the asset.
   *  For instance, 0.5 to allow borrowing this asset 50% * collateral value * collateralFactor.
   *  When calculating equity, 0.5 with 100 borrow balance will produce 200 borrow value
   *  Must be between (0, 1], and stored as a mantissa.
   */
  borrowFactorMantissa: BigNumber;
  /*
   *  Multiplier representing the most one can borrow against their collateral in this market.
   *  For instance, 0.9 to allow borrowing 90% of collateral value.
   *  Must be in [0, 0.9], and stored as a mantissa.
   */
  collateralFactorMantissa: BigNumber;
  closeFactorMantissa: BigNumber;
  mintPaused: boolean;
  redeemPaused: boolean;
  borrowPaused: boolean;
  /** Model which tells what the current interest rate should be */
  interestRateModel: string;
  /*
   *  The borrow capacity of the asset, will be checked in beforeBorrow()
   *  -1 means there is no limit on the capacity
   *  0 means the asset can not be borrowed any more
   */
  borrowCapacity: BigNumber;
  /*
   *  The supply capacity of the asset, will be checked in beforeMint()
   *  -1 means there is no limit on the capacity
   *  0 means the asset can not be supplied any more
   */
  supplyCapacity: BigNumber;
  price: BigNumber;
  underlineDecimals: number;

  blocksPerYear: BigNumber;
}

//endregion Data types

export class DForceHelper {
//region Access
  public static getController(signer: SignerWithAddress) : IDForceController {
    return IDForceController__factory.connect(MaticAddresses.DFORCE_CONTROLLER, signer);
  }

  public static async getPriceOracle(
    controller: IDForceController
    , signer: SignerWithAddress
  ) : Promise<IDForcePriceOracle> {
    return IDForcePriceOracle__factory.connect(await controller.priceOracle(), signer);
  }
//endregion Access

//region Read data
  public static async getCTokenData(
    signer: SignerWithAddress,
    controller: IDForceController,
    cToken: IDForceCToken,

  ) : Promise<IHfData> {
    const m = await controller.markets(cToken.address);
    const priceOracle = await DForceHelper.getPriceOracle(controller, signer);
    const irm = IDForceInterestRateModel__factory.connect(await cToken.interestRateModel(), signer);


    console.log(cToken.address);
    console.log(await cToken.underlying());
    console.log(await cToken.name());

    return {
      controller: await cToken.controller(),
      ctoken: cToken.address,
      underlying: cToken.address == MaticAddresses.dForce_iMATIC
        ? "" //iMatic doesn't support CErc20Storage and doesn't have underlying property
        : await cToken.underlying(),
      name: await cToken.name(),
      symbol: await cToken.symbol(),
      decimals: await cToken.decimals(),
      borrowRatePerBlock: await cToken.borrowRatePerBlock(),
      exchangeRateStored: await cToken.exchangeRateStored(),
      cash: await cToken.getCash(),
      reserveRatio: await cToken.reserveRatio(),
      totalBorrows: await cToken.totalBorrows(),
      totalReserves: await cToken.totalReserves(),
      totalSupply: await cToken.totalSupply(),
      borrowFactorMantissa: m.borrowFactorMantissa,
      collateralFactorMantissa: m.collateralFactorMantissa,
      closeFactorMantissa: await controller.closeFactorMantissa(),
      interestRateModel: await cToken.interestRateModel(),
      borrowCapacity: m.borrowCapacity,
      supplyCapacity: m.supplyCapacity,
      borrowPaused: m.borrowPaused,
      mintPaused: m.mintPaused,
      redeemPaused: m.redeemPaused,
      price: await priceOracle.getUnderlyingPrice(cToken.address),
      underlineDecimals: await IERC20Extended__factory.connect(
        cToken.address == MaticAddresses.dForce_iMATIC
          ? MaticAddresses.WMATIC
          : await cToken.underlying()
        , signer
      ).decimals(),
      blocksPerYear: await irm.blocksPerYear()
    }
  }
//endregion Read data

//region Get data for script
  public static async getData(
    signer: SignerWithAddress,
    controller: IDForceController
  ) : Promise<string[]> {
    const markets = await controller.getAlliTokens();
    const dest: string[] = [];
    dest.push([
      "name",
      "controller",
      "symbol", "decimals", "ctoken", "underline",
      "borrowRatePerBlock", "exchangeRateStored",
      "cash", "reserveFactorMantissa",
      "totalBorrows", "totalReserves", "totalSupply",
      "borrowFactorMantissa", "collateralFactorMantissa", "closeFactorMantissa",
      "interestRateModel",
      "borrowCapacity", "supplyCapacity",
      "redeemPaused", "mintPaused", "borrowPaused",
      "price",
      "underlineDecimals",
      "blocksPerYear"
    ].join(","));

    for (const market of markets) {
      console.log(`Market ${market}`);

      const cToken = IDForceCToken__factory.connect(market, signer);
      const rd = await DForceHelper.getCTokenData(signer, controller, cToken);

      const line = [
        rd.name,
        rd.controller,
        rd.symbol, rd.decimals, rd.ctoken, rd.underlying,
        rd.borrowRatePerBlock, rd.exchangeRateStored,
        rd.cash, rd.reserveRatio,
        rd.totalBorrows, rd.totalReserves, rd.totalSupply,
        rd.borrowFactorMantissa, rd.collateralFactorMantissa, rd.closeFactorMantissa,
        rd.interestRateModel,
        rd.borrowCapacity, rd.supplyCapacity,
        rd.redeemPaused, rd.mintPaused, rd.borrowPaused,
        rd.price,
        rd.underlineDecimals,
        rd.blocksPerYear
      ];

      dest.push(line.map(x => Aave3Helper.toString(x)).join(","));
    }

    return dest;
  }
//endregion Get data for script
}