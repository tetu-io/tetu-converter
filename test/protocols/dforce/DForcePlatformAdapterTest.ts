import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {
  IERC20Metadata__factory,
  IDForceController,
  IDForceCToken,
  IDForceCToken__factory,
  DForcePlatformAdapter__factory,
  DForceAprLibFacade,
  BorrowManager__factory,
  DForcePlatformAdapter,
  ConverterController,
  IDForceController__factory,
} from "../../../typechain";
import {expect} from "chai";
import {AdaptersHelper} from "../../baseUT/helpers/AdaptersHelper";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {BigNumber} from "ethers";
import {IPlatformActor, PredictBrUsesCase} from "../../baseUT/uses-cases/PredictBrUsesCase";
import {DForceHelper, IDForceMarketData} from "../../../scripts/integration/helpers/DForceHelper";
import {areAlmostEqual} from "../../baseUT/utils/CommonUtils";
import {TokenDataTypes} from "../../baseUT/types/TokenDataTypes";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {SupplyBorrowUsingDForce} from "../../baseUT/uses-cases/dforce/SupplyBorrowUsingDForce";
import {DForcePlatformFabric} from "../../baseUT/fabrics/DForcePlatformFabric";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {AprDForce, getDForceStateInfo} from "../../baseUT/apr/aprDForce";
import {Misc} from "../../../scripts/utils/Misc";
import {AprUtils} from "../../baseUT/utils/aprUtils";
import {convertUnits} from "../../baseUT/apr/aprUtils";
import {TetuConverterApp} from "../../baseUT/helpers/TetuConverterApp";
import {IConversionPlan} from "../../baseUT/apr/aprDataTypes";
import {DForceChangePriceUtils} from "../../baseUT/protocols/dforce/DForceChangePriceUtils";
import {defaultAbiCoder, formatUnits, parseUnits} from "ethers/lib/utils";
import {controlGasLimitsEx, HardhatUtils, POLYGON_NETWORK_ID} from "../../../scripts/utils/HardhatUtils";
import {GAS_LIMIT, GAS_LIMIT_DFORCE_GET_CONVERSION_PLAN} from "../../baseUT/GasLimit";
import {AppConstants} from "../../baseUT/AppConstants";

describe("DForcePlatformAdapterTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;

//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
  });

  after(async function () {
    await TimeUtils.rollback(snapshot);
  });

  beforeEach(async function () {
    snapshotForEach = await TimeUtils.snapshot();
  });

  afterEach(async function () {
    await TimeUtils.rollback(snapshotForEach);
  });
//endregion before, after

//region IPlatformActor impl
  class DForcePlatformActor implements IPlatformActor {
    collateralCToken: IDForceCToken;
    borrowCToken: IDForceCToken;
    comptroller: IDForceController;
    constructor(
      collateralCToken: IDForceCToken,
      borrowCToken: IDForceCToken,
      comptroller: IDForceController
    ) {
      this.borrowCToken = borrowCToken;
      this.collateralCToken = collateralCToken;
      this.comptroller = comptroller;
    }
    async getAvailableLiquidity() : Promise<BigNumber> {
      const cashBefore = await this.borrowCToken.getCash();
      const borrowBefore = await this.borrowCToken.totalBorrows();
      const reserveBefore = await this.borrowCToken.totalReserves();
      console.log(`Reserve data before: cash=${cashBefore.toString()} borrow=${borrowBefore.toString()} reserve=${reserveBefore.toString()}`);
      return cashBefore;
    }
    async getCurrentBR(): Promise<BigNumber> {
      const br = await this.borrowCToken.borrowRatePerBlock();
      console.log(`BR=${br}`);
      return br;
    }
    async supplyCollateral(collateralAmount: BigNumber): Promise<void> {
      const collateralAsset = await this.collateralCToken.underlying();
      await IERC20Metadata__factory.connect(collateralAsset, deployer)
        .approve(this.collateralCToken.address, collateralAmount);
      console.log(`Supply collateral ${collateralAsset} amount ${collateralAmount}`);
      await this.comptroller.enterMarkets([this.collateralCToken.address, this.borrowCToken.address]);
      await this.collateralCToken.mint(deployer.address, collateralAmount);

    }
    async borrow(borrowAmount: BigNumber): Promise<void> {
      await this.borrowCToken.borrow(borrowAmount);
      console.log(`Borrow ${borrowAmount}`);
    }
  }
//endregion IPlatformActor impl

//region Test predict-br impl
  async function makePredictBrTest(
    collateralAsset: string,
    collateralCToken: string,
    borrowAsset: string,
    borrowCToken: string,
    collateralHolders: string[],
    part10000: number
  ) : Promise<{br: BigNumber, brPredicted: BigNumber}> {
    const collateralToken = IDForceCToken__factory.connect(collateralCToken, deployer);
    const borrowToken = IDForceCToken__factory.connect(borrowCToken, deployer);
    const comptroller = await DForceHelper.getController(deployer);

    return PredictBrUsesCase.makeTest(
      deployer,
      new DForcePlatformActor(collateralToken, borrowToken, comptroller),
      "dforce",
      collateralAsset,
      borrowAsset,
      collateralHolders,
      part10000
    );
  }
//endregion Test predict-br impl

//region Get conversion plan test impl
  interface IGetConversionPlanBadPaths {
    zeroCollateralAsset?: boolean;
    zeroBorrowAsset?: boolean;
    zeroCountBlocks?: boolean;
    zeroCollateralAmount?: boolean;
    incorrectHealthFactor2?: number;
    setMinBorrowCapacity?: boolean;
    setMinSupplyCapacity?: boolean;
    setZeroBorrowCapacity?: boolean;
    setZeroSupplyCapacity?: boolean;
    setCollateralMintPaused?: boolean;
    setBorrowPaused?: boolean;
    setRedeemPaused?: boolean;
    setBorrowCapacityUnlimited?: boolean;
    setBorrowCapacityExceeded?: boolean;
    setMinBorrowCapacityDelta?: BigNumber;
    setSupplyCapacityUnlimited?: boolean;
    frozen?: boolean;
  }

  interface IPreparePlanResults {
    plan: IConversionPlan;
    healthFactor2: number;
    priceCollateral: BigNumber;
    priceBorrow: BigNumber;
    priceCollateral36: BigNumber;
    priceBorrow36: BigNumber;
    comptroller: IDForceController;
    countBlocks: number;
    borrowAssetDecimals: number;
    collateralAssetDecimals: number;
    collateralAssetData: IDForceMarketData;
    borrowAssetData: IDForceMarketData;
    cTokenBorrow: IDForceCToken;
    cTokenCollateral: IDForceCToken;
  }

  async function preparePlan(
    controller: ConverterController,
    collateralAsset: string,
    collateralAmount: BigNumber,
    borrowAsset: string,
    collateralCToken: string,
    borrowCToken: string,
    badPathsParams?: IGetConversionPlanBadPaths,
    entryData?: string
  ) : Promise<IPreparePlanResults> {
    const countBlocks = 10;
    const healthFactor2 = 400;

    const comptroller = await DForceHelper.getController(deployer);
    const dForcePlatformAdapter = await AdaptersHelper.createDForcePlatformAdapter(
      deployer,
      controller.address,
      comptroller.address,
      ethers.Wallet.createRandom().address,
      [collateralCToken, borrowCToken],
    );
    const priceOracle = await DForceHelper.getPriceOracle(comptroller, deployer);
    const cTokenBorrow = IDForceCToken__factory.connect(borrowCToken, deployer);
    const cTokenCollateral = IDForceCToken__factory.connect(collateralCToken, deployer);

    const borrowAssetDecimals = await (IERC20Metadata__factory.connect(borrowAsset, deployer)).decimals();
    const collateralAssetDecimals = await (IERC20Metadata__factory.connect(collateralAsset, deployer)).decimals();

    // getUnderlyingPrice returns price/1e(36-underlineDecimals)
    const priceBorrow = await priceOracle.getUnderlyingPrice(borrowCToken);
    const priceCollateral = await priceOracle.getUnderlyingPrice(collateralCToken);
    console.log("priceBorrow", priceBorrow);
    console.log("priceCollateral", priceCollateral);

    const priceBorrow36 = priceBorrow.mul(getBigNumberFrom(1, borrowAssetDecimals));
    const priceCollateral36 = priceCollateral.mul(getBigNumberFrom(1, collateralAssetDecimals));
    console.log("priceBorrow18", priceBorrow36);
    console.log("priceCollateral18", priceCollateral36);

    const collateralAssetData = await DForceHelper.getCTokenData(deployer, comptroller, cTokenCollateral);
    console.log("collateralAssetData", collateralAssetData);
    const borrowAssetData = await DForceHelper.getCTokenData(deployer, comptroller, cTokenBorrow);
    console.log("borrowAssetData", borrowAssetData);

    if (badPathsParams?.setMinSupplyCapacity) {
      await DForceChangePriceUtils.setSupplyCapacity(deployer, collateralCToken, collateralAssetData.totalSupply);
    }
    if (badPathsParams?.setZeroSupplyCapacity) {
      await DForceChangePriceUtils.setSupplyCapacity(deployer, collateralCToken, BigNumber.from(0));
    }
    if (badPathsParams?.setMinBorrowCapacity) {
      await DForceChangePriceUtils.setBorrowCapacity(deployer, borrowCToken, borrowAssetData.totalBorrows);
    }
    if (badPathsParams?.setZeroBorrowCapacity) {
      await DForceChangePriceUtils.setBorrowCapacity(deployer, borrowCToken, BigNumber.from(0));
    }
    if (badPathsParams?.setCollateralMintPaused) {
      await DForceChangePriceUtils.setMintPaused(deployer, collateralCToken);
    }
    if (badPathsParams?.setBorrowPaused) {
      await DForceChangePriceUtils.setBorrowPaused(deployer, borrowCToken);
    }
    if (badPathsParams?.setRedeemPaused) {
      await DForceChangePriceUtils.setRedeemPaused(deployer, borrowCToken);
    }
    if (badPathsParams?.setBorrowCapacityUnlimited) {
      await DForceChangePriceUtils.setBorrowCapacity(
        deployer,
        borrowCToken,
        Misc.MAX_UINT
      );
    }
    if (badPathsParams?.setBorrowCapacityExceeded) {
      await DForceChangePriceUtils.setBorrowCapacity(
        deployer,
        borrowCToken,
        borrowAssetData.totalBorrows.div(2)
      );
    }
    if (badPathsParams?.setMinBorrowCapacityDelta) {
      await DForceChangePriceUtils.setBorrowCapacity(
        deployer,
        borrowCToken,
        borrowAssetData.totalBorrows.add(badPathsParams?.setMinBorrowCapacityDelta)
      );
    }
    if (badPathsParams?.setSupplyCapacityUnlimited) {
      await DForceChangePriceUtils.setSupplyCapacity(
        deployer,
        collateralCToken,
        Misc.MAX_UINT
      );
    }
    if (badPathsParams?.frozen) {
      await dForcePlatformAdapter.setFrozen(true);
    }

    const plan = await dForcePlatformAdapter.getConversionPlan(
      {
        collateralAsset: badPathsParams?.zeroCollateralAsset ? Misc.ZERO_ADDRESS : collateralAsset,
        amountIn: badPathsParams?.zeroCollateralAmount ? 0 : collateralAmount,
        borrowAsset: badPathsParams?.zeroBorrowAsset ? Misc.ZERO_ADDRESS : borrowAsset,
        countBlocks: badPathsParams?.zeroCountBlocks ? 0 : countBlocks,
        entryData: entryData|| "0x",
        user: Misc.ZERO_ADDRESS
      },
      badPathsParams?.incorrectHealthFactor2 || healthFactor2,
      {gasLimit: GAS_LIMIT},
    );

    return {
      plan,
      countBlocks,
      borrowAssetDecimals,
      comptroller,
      collateralAssetDecimals,
      priceCollateral36,
      priceBorrow36,
      borrowAssetData,
      collateralAssetData,
      healthFactor2,
      priceCollateral,
      priceBorrow,
      cTokenBorrow,
      cTokenCollateral
    }
  }

  /**
   * Ensure, that getConversionPlan returns same APR
   * as directly calculated one using DForceAprLibFacade
   */
  async function makeTestComparePlanWithDirectCalculations(
    controller: ConverterController,
    collateralAsset: string,
    collateralAmount: BigNumber,
    borrowAsset: string,
    collateralCToken: string,
    borrowCToken: string,
    badPathsParams?: IGetConversionPlanBadPaths
  ) : Promise<{sret: string, sexpected: string}> {
    const d = await preparePlan(
      controller,
      collateralAsset,
      collateralAmount,
      borrowAsset,
      collateralCToken,
      borrowCToken,
      badPathsParams
    );
    console.log("getConversionPlan", d.plan);

    let amountToBorrow = AprUtils.getBorrowAmount(
      collateralAmount,
      d.healthFactor2,
      d.plan.liquidationThreshold18,
      d.priceCollateral36,
      d.priceBorrow36,
      d.collateralAssetDecimals,
      d.borrowAssetDecimals
    );
    if (amountToBorrow.gt(d.plan.maxAmountToBorrow)) {
      amountToBorrow = d.plan.maxAmountToBorrow;
    }

    const amountCollateralInBorrowAsset36 =  convertUnits(collateralAmount,
      d.priceCollateral36,
      d.collateralAssetDecimals,
      d.priceBorrow36,
      36
    );
    console.log("collateralAmount", collateralAmount);
    console.log("priceCollateral", d.priceCollateral);
    console.log("priceBorrow", d.priceBorrow);
    console.log("collateralAssetDecimals", d.collateralAssetDecimals);

    // predict APR
    const libFacade = await DeployUtils.deployContract(deployer, "DForceAprLibFacade") as DForceAprLibFacade;
    const borrowRatePredicted = await AprDForce.getEstimatedBorrowRate(libFacade,
      d.cTokenBorrow,
      amountToBorrow
    );
    const supplyRatePredicted = await AprDForce.getEstimatedSupplyRate(libFacade,
      await getDForceStateInfo(d.comptroller, d.cTokenCollateral, d.cTokenBorrow, Misc.ZERO_ADDRESS),
      collateralAmount,
      await d.cTokenCollateral.interestRateModel()
    );
    const supplyIncomeInBorrowAsset36 = await libFacade.getSupplyIncomeInBorrowAsset36(
      supplyRatePredicted,
      d.countBlocks,
      parseUnits("1", d.collateralAssetDecimals),
      d.priceCollateral36,
      d.priceBorrow36,
      collateralAmount,
    );
    const borrowCost36 = await libFacade.getBorrowCost36(
      borrowRatePredicted,
      amountToBorrow,
      d.countBlocks,
      parseUnits("1", d.borrowAssetDecimals),
    );

    const sret = [
      d.plan.borrowCost36,
      d.plan.supplyIncomeInBorrowAsset36,
      d.plan.ltv18,
      d.plan.liquidationThreshold18,
      d.plan.maxAmountToBorrow,
      d.plan.maxAmountToSupply,
      d.plan.amountToBorrow,
      d.plan.collateralAmount,
      areAlmostEqual(d.plan.amountCollateralInBorrowAsset36, amountCollateralInBorrowAsset36)
    ].map(x => BalanceUtils.toString(x)) .join("\n");
    console.log("amountToBorrow", amountToBorrow);
    console.log("borrowAssetData.borrowRatePerBlock", d.borrowAssetData.borrowRatePerBlock);
    console.log("countBlocks", d.countBlocks);

    const MAX_INT = BigNumber.from(2).pow(256).sub(1);
    const totalSupply = d.collateralAssetData.totalSupply // see Controller.beforeMint
        .mul(
          d.collateralAssetData.exchangeRateStored
        ).div(Misc.WEI);

    const sexpected = [
      borrowCost36,
      supplyIncomeInBorrowAsset36,
      d.collateralAssetData.collateralFactorMantissa
        .mul(d.borrowAssetData.borrowFactorMantissa)
        .div(Misc.WEI),
      d.collateralAssetData.collateralFactorMantissa,
      d.borrowAssetData.cash,
      d.collateralAssetData.supplyCapacity.eq(MAX_INT)
        ? MAX_INT
        : totalSupply.gte(d.collateralAssetData.supplyCapacity)
          ? BigNumber.from(0)
          : d.collateralAssetData.supplyCapacity.sub(totalSupply),
      amountToBorrow,
      collateralAmount,
      true
    ].map(x => BalanceUtils.toString(x)) .join("\n");

    return {sret, sexpected};
  }
//endregion Get conversion plan test impl

//region Unit tests
  describe("constructor and converters()", () => {
    interface IContractsSet {
      controller: string;
      converter: string;
      comptroller: string;
    }
    interface ICreateContractsSetBadParams {
      zeroController?: boolean;
      zeroConverter?: boolean;
      zeroComptroller?: boolean;
    }
    async function initializePlatformAdapter(
      badPaths?: ICreateContractsSetBadParams
    ) : Promise<{data: IContractsSet, platformAdapter: DForcePlatformAdapter}> {
      const controller = await TetuConverterApp.createController(
        deployer,
        {tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
      );
      const templateAdapterNormalStub = ethers.Wallet.createRandom();

      const data: IContractsSet = {
        controller: badPaths?.zeroController ? Misc.ZERO_ADDRESS : controller.address,
        comptroller: badPaths?.zeroComptroller ? Misc.ZERO_ADDRESS : MaticAddresses.DFORCE_CONTROLLER,
        converter: badPaths?.zeroConverter ? Misc.ZERO_ADDRESS : templateAdapterNormalStub.address
      }
      const platformAdapter = await AdaptersHelper.createDForcePlatformAdapter(
        deployer,
        data.controller,
        data.comptroller,
        data.converter,
        [MaticAddresses.dForce_iDAI],
        await controller.borrowManager()
      );
      return {data, platformAdapter};
    }
    describe("Good paths", () => {
      it("should return expected values", async () => {
        const r = await initializePlatformAdapter();

        const ret = [
          await r.platformAdapter.controller(),
          await r.platformAdapter.comptroller(),
          await r.platformAdapter.converter(),
          (await r.platformAdapter.converters()).join(),
          await r.platformAdapter.activeAssets(MaticAddresses.DAI),
          await r.platformAdapter.activeAssets(MaticAddresses.USDC)
        ].join("\n");
        const expected = [
          r.data.controller,
          r.data.comptroller,
          r.data.converter,
          [r.data.converter].join(),
          MaticAddresses.dForce_iDAI,
          Misc.ZERO_ADDRESS
        ].join("\n");

        expect(ret).eq(expected);
      });
    });
    describe("Bad paths", () => {
      it("should revert if aave-pool is zero", async () => {
        await expect(
          initializePlatformAdapter({zeroComptroller: true})
        ).revertedWith("TC-1 zero address");
      });
      it("should revert if controller is zero", async () => {
        await expect(
          initializePlatformAdapter({zeroController: true})
        ).revertedWith("TC-1 zero address");
      });
      it("should revert if template normal is zero", async () => {
        await expect(
          initializePlatformAdapter({zeroConverter: true})
        ).revertedWith("TC-1 zero address");
      });
    });
  });

  describe("getConversionPlan", () => {
    let controller: ConverterController;
    let snapshotLocal: string;
    before(async function () {
      snapshotLocal = await TimeUtils.snapshot();
      controller = await TetuConverterApp.createController(
        deployer,
        {tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
      );
    });
    after(async function () {
      await TimeUtils.rollback(snapshotLocal);
    });
    describe("Good paths", () => {
      describe("DAI : usdc", () => {
        it("should return expected values", async () => {
          const collateralAsset = MaticAddresses.DAI;
          const borrowAsset = MaticAddresses.USDC;
          const collateralCToken = MaticAddresses.dForce_iDAI;
          const borrowCToken = MaticAddresses.dForce_iUSDC;

          const collateralAmount = getBigNumberFrom(1000, 18);
          const ret = await makeTestComparePlanWithDirectCalculations(
            controller,
            collateralAsset,
            collateralAmount,
            borrowAsset,
            collateralCToken,
            borrowCToken
          );
          console.log(ret);

          expect(ret.sret).eq(ret.sexpected);
        });
      });
      describe("USDC : USDT", () => {
        it("should return expected values", async () => {
          const collateralAsset = MaticAddresses.USDC;
          const collateralCToken = MaticAddresses.dForce_iUSDC;

          const borrowAsset = MaticAddresses.USDT;
          const borrowCToken = MaticAddresses.dForce_iUSDT;

          const collateralAmount = getBigNumberFrom(100, 6);
          const ret = await makeTestComparePlanWithDirectCalculations(
            controller,
            collateralAsset,
            collateralAmount,
            borrowAsset,
            collateralCToken,
            borrowCToken
          );
          console.log(ret);

          expect(ret.sret).eq(ret.sexpected);
        });
      });
      describe("WMATIC : USDC", () => {
        it("should return expected values", async () => {
          const collateralAsset = MaticAddresses.WMATIC;
          const collateralCToken = MaticAddresses.dForce_iMATIC;

          const borrowAsset = MaticAddresses.USDC;
          const borrowCToken = MaticAddresses.dForce_iUSDC;

          const collateralAmount = parseUnits("100", 18);
          const ret = await makeTestComparePlanWithDirectCalculations(
            controller,
            collateralAsset,
            collateralAmount,
            borrowAsset,
            collateralCToken,
            borrowCToken
          );
          console.log(ret);

          expect(ret.sret).eq(ret.sexpected);
        });
      });
      describe("Try to use huge collateral amount", () => {
        it("should return borrow amount equal to max available amount", async () => {
          const r = await preparePlan(
            controller,
            MaticAddresses.DAI,
            parseUnits("1", 28),
            MaticAddresses.WMATIC,
            MaticAddresses.dForce_iDAI,
            MaticAddresses.dForce_iMATIC,
          );
          expect(r.plan.amountToBorrow).eq(r.plan.maxAmountToBorrow);
        });
      });
      describe("Borrow capacity", () => {
        /**
         *      totalBorrows    <    borrowCap       <       totalBorrows + available cash
         */
        it("maxAmountToBorrow is equal to borrowCap - totalBorrows", async () => {
          const r = await preparePlan(
            controller,
            MaticAddresses.DAI,
            parseUnits("1", 18),
            MaticAddresses.WMATIC,
            MaticAddresses.dForce_iDAI,
            MaticAddresses.dForce_iMATIC,
            { setMinBorrowCapacityDelta: parseUnits("7", 18)  }
          );
          expect(r.plan.maxAmountToBorrow.eq(parseUnits("7", 18))).eq(true);
        });

        /**
         *      totalBorrows    <    borrowCap       <       totalBorrows + available cash
         */
        it("maxAmountToBorrow is equal to available cash if borrowCap is huge", async () => {
          const r = await preparePlan(
            controller,
            MaticAddresses.DAI,
            parseUnits("1", 18),
            MaticAddresses.WMATIC,
            MaticAddresses.dForce_iDAI,
            MaticAddresses.dForce_iMATIC,
            { setMinBorrowCapacityDelta: parseUnits("7", 48)  }
          );
          const availableCash = await IDForceCToken__factory.connect(r.cTokenBorrow.address, deployer).getCash();
          expect(r.plan.maxAmountToBorrow.eq(availableCash)).eq(true);
        });

        /**
         *      totalBorrows    <     totalBorrows + available cash
         */
        it("maxAmountToBorrow is equal to available cash if borrowCap is unlimited", async () => {
          const r = await preparePlan(
            controller,
            MaticAddresses.DAI,
            parseUnits("1", 18),
            MaticAddresses.WMATIC,
            MaticAddresses.dForce_iDAI,
            MaticAddresses.dForce_iMATIC,
            { setBorrowCapacityUnlimited: true }
          );
          const availableCash = await IDForceCToken__factory.connect(r.cTokenBorrow.address, deployer).getCash();
          expect(r.plan.maxAmountToBorrow.eq(availableCash)).eq(true);
        });

        /**
         *      borrowCap   <     totalBorrows    <   totalBorrows + available cash
         */
        it("maxAmountToBorrow is zero if borrow capacity is exceeded", async () => {
          const r = await preparePlan(
            controller,
            MaticAddresses.DAI,
            parseUnits("1", 18),
            MaticAddresses.WMATIC,
            MaticAddresses.dForce_iDAI,
            MaticAddresses.dForce_iMATIC,
            { setBorrowCapacityExceeded: true }
          );
          expect(r.plan.maxAmountToBorrow.eq(0)).eq(true);
        });
      });
      describe("Supply capacity", () => {
        it("should return expected values", async () => {
          const r = await preparePlan(
            controller,
            MaticAddresses.DAI,
            parseUnits("1", 18),
            MaticAddresses.WMATIC,
            MaticAddresses.dForce_iDAI,
            MaticAddresses.dForce_iMATIC,
            { setSupplyCapacityUnlimited: true}
          );
          expect(r.plan.maxAmountToSupply.eq(Misc.MAX_UINT)).eq(true);

        });
      });
      describe("Frozen", () => {
        it("should return no plan", async () => {
          const r = await preparePlan(
            controller,
            MaticAddresses.DAI,
            parseUnits("1", 18),
            MaticAddresses.WMATIC,
            MaticAddresses.dForce_iDAI,
            MaticAddresses.dForce_iMATIC,
            {
              frozen: true
            }
          );
          expect(r.plan.converter).eq(Misc.ZERO_ADDRESS);
        });
      });
      describe("EntryKinds", () => {
        describe("Use ENTRY_KIND_EXACT_COLLATERAL_IN_FOR_MAX_BORROW_OUT_0", () => {
          it("should return expected collateral and borrow amounts", async () => {
            const collateralAmount = parseUnits("1000", 18);

            const r = await preparePlan(
              controller,
              MaticAddresses.DAI,
              collateralAmount,
              MaticAddresses.WMATIC,
              MaticAddresses.dForce_iDAI,
              MaticAddresses.dForce_iMATIC,
              undefined,
              defaultAbiCoder.encode(["uint256"], [AppConstants.ENTRY_KIND_0])
            );

            const borrowAmount = AprUtils.getBorrowAmount(
              collateralAmount,
              r.healthFactor2,
              r.plan.liquidationThreshold18,
              r.priceCollateral,
              r.priceBorrow,
              r.collateralAssetDecimals,
              r.borrowAssetDecimals,
            );

            const amountCollateralInBorrowAsset36 =  convertUnits(r.plan.collateralAmount,
              r.priceCollateral,
              r.collateralAssetDecimals,
              r.priceBorrow,
              36
            );

            const ret = [
              r.plan.collateralAmount,
              areAlmostEqual(r.plan.amountToBorrow, borrowAmount),
              areAlmostEqual(r.plan.amountCollateralInBorrowAsset36, amountCollateralInBorrowAsset36)
            ].map(x => BalanceUtils.toString(x)).join("\n");
            const expected = [
              collateralAmount,
              true,
              true
            ].map(x => BalanceUtils.toString(x)).join("\n");

            expect(ret).eq(expected);
          });
        });
        describe("Use ENTRY_KIND_EXACT_PROPORTION_1", () => {
          it("should split source amount on the parts with almost same cost", async () => {
            const collateralAmount = parseUnits("1000", 18);

            const r = await preparePlan(
              controller,
              MaticAddresses.DAI,
              collateralAmount,
              MaticAddresses.WMATIC,
              MaticAddresses.dForce_iDAI,
              MaticAddresses.dForce_iMATIC,
              undefined,
              defaultAbiCoder.encode(
                ["uint256", "uint256", "uint256"],
                [AppConstants.ENTRY_KIND_1, 1, 1]
              )
            );

            const sourceAssetUSD = +formatUnits(
              collateralAmount.sub(r.plan.collateralAmount).mul(r.priceCollateral),
              r.collateralAssetDecimals
            );
            const targetAssetUSD = +formatUnits(
              r.plan.amountToBorrow.mul(r.priceBorrow),
              r.borrowAssetDecimals
            );

            const ret = [
              sourceAssetUSD === targetAssetUSD,
              r.plan.collateralAmount.lt(collateralAmount)
            ].join();
            const expected = [true, true].join();

            console.log("sourceAssetUSD", sourceAssetUSD);
            console.log("targetAssetUSD", targetAssetUSD);

            expect(ret).eq(expected);
          });
        });
        describe("Use ENTRY_KIND_EXACT_BORROW_OUT_FOR_MIN_COLLATERAL_IN_2", () => {
          it("should return expected collateral amount", async () => {
            // let's calculate borrow amount by known collateral amount
            const collateralAmount = parseUnits("10", 18);
            const d = await preparePlan(
              controller,
              MaticAddresses.DAI,
              collateralAmount,
              MaticAddresses.WMATIC,
              MaticAddresses.dForce_iDAI,
              MaticAddresses.dForce_iMATIC,
            );
            const borrowAmount = AprUtils.getBorrowAmount(
              collateralAmount,
              d.healthFactor2,
              d.plan.liquidationThreshold18,
              d.priceCollateral,
              d.priceBorrow,
              d.collateralAssetDecimals,
              d.borrowAssetDecimals
            );

            const r = await preparePlan(
              controller,
              MaticAddresses.DAI,
              borrowAmount,
              MaticAddresses.WMATIC,
              MaticAddresses.dForce_iDAI,
              MaticAddresses.dForce_iMATIC,
              undefined,
              defaultAbiCoder.encode(["uint256"], [AppConstants.ENTRY_KIND_2])
            );

            const ret = [
              r.plan.amountToBorrow,
              areAlmostEqual(r.plan.collateralAmount, collateralAmount)
            ].map(x => BalanceUtils.toString(x)).join("\n");

            const expected = [
              borrowAmount,
              true
            ].map(x => BalanceUtils.toString(x)).join("\n");
            console.log(d.plan);
            console.log(r.plan);

            expect(ret).eq(expected);
          });
        });
      });
      describe("Collateral and borrow amounts fit to limits", () => {
        describe("Allowed collateral exceeds available collateral", () => {
          it("should return expected borrow and collateral amounts", async () => {
            // let's get max available supply amount
            const sample = await preparePlan(
              controller,
              MaticAddresses.DAI,
              parseUnits("1", 18),
              MaticAddresses.WMATIC,
              MaticAddresses.dForce_iDAI,
              MaticAddresses.dForce_iMATIC,
              undefined,
              defaultAbiCoder.encode(["uint256"], [AppConstants.ENTRY_KIND_0])
            );

            // let's try to borrow amount using collateral that exceeds max supply amount
            const r = await preparePlan(
              controller,
              MaticAddresses.DAI,
              sample.plan.maxAmountToSupply.add(1000),
              MaticAddresses.WMATIC,
              MaticAddresses.dForce_iDAI,
              MaticAddresses.dForce_iMATIC,
              undefined,
              defaultAbiCoder.encode(["uint256"], [AppConstants.ENTRY_KIND_0])
            );
            console.log(r.plan);

            const expectedCollateralAmount = AprUtils.getCollateralAmount(
              r.plan.amountToBorrow,
              r.healthFactor2,
              r.plan.liquidationThreshold18,
              r.priceCollateral,
              r.priceBorrow,
              r.collateralAssetDecimals,
              r.borrowAssetDecimals
            );

            const ret = [
              r.plan.amountToBorrow,
              areAlmostEqual(r.plan.collateralAmount, expectedCollateralAmount)
            ].map(x => BalanceUtils.toString(x)).join("\n");
            const expected = [
              r.plan.maxAmountToBorrow,
              true
            ].map(x => BalanceUtils.toString(x)).join("\n");

            expect(ret).eq(expected);
          });
        });
        describe("Allowed borrow amounts exceeds available borrow amount", () => {
          it("should return expected borrow and collateral amounts", async () => {
            // let's get max available borrow amount
            const sample = await preparePlan(
              controller,
              MaticAddresses.DAI,
              parseUnits("1", 18),
              MaticAddresses.WMATIC,
              MaticAddresses.dForce_iDAI,
              MaticAddresses.dForce_iMATIC,
              undefined,
              defaultAbiCoder.encode(["uint256"], [AppConstants.ENTRY_KIND_0])
            );

            // let's try to borrow amount using collateral that exceeds max supply amount
            const r = await preparePlan(
              controller,
              MaticAddresses.DAI,
              sample.plan.maxAmountToBorrow.add(1000),
              MaticAddresses.WMATIC,
              MaticAddresses.dForce_iDAI,
              MaticAddresses.dForce_iMATIC,
              undefined,
              defaultAbiCoder.encode(["uint256"], [AppConstants.ENTRY_KIND_2])
            );
            console.log(r.plan);

            const expectedCollateralAmount = AprUtils.getCollateralAmount(
              sample.plan.maxAmountToBorrow,
              r.healthFactor2,
              r.plan.liquidationThreshold18,
              r.priceCollateral,
              r.priceBorrow,
              r.collateralAssetDecimals,
              r.borrowAssetDecimals,
            );

            const ret = [
              r.plan.amountToBorrow,
              areAlmostEqual(r.plan.collateralAmount, expectedCollateralAmount)
            ].map(x => BalanceUtils.toString(x)).join("\n");
            const expected = [
              r.plan.maxAmountToBorrow,
              true
            ].map(x => BalanceUtils.toString(x)).join("\n");

            expect(ret).eq(expected);
          });
        });
      });
    });
    describe("Bad paths", () => {
      async function tryGetConversionPlan(
        badPathsParams: IGetConversionPlanBadPaths,
        collateralAsset: string = MaticAddresses.DAI,
        borrowAsset: string = MaticAddresses.USDC,
        collateralCToken: string = MaticAddresses.dForce_iDAI,
        borrowCToken: string = MaticAddresses.dForce_iUSDC,
        collateralAmount: BigNumber = parseUnits("1000", 18)
      ) : Promise<IConversionPlan> {
        return (await preparePlan(
          controller,
          collateralAsset,
          collateralAmount,
          borrowAsset,
          collateralCToken,
          borrowCToken,
          badPathsParams
        )).plan;
      }
      describe("incorrect input params", () => {
        describe("collateral token is zero", () => {
          it("should revert", async () => {
            await expect(
              tryGetConversionPlan({ zeroCollateralAsset: true })
            ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
          });
        });
        describe("borrow token is zero", () => {
          it("should revert", async () =>{
            await expect(
              tryGetConversionPlan({ zeroBorrowAsset: true })
            ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
          });
        });
        describe("healthFactor2_ is less than min allowed", () => {
          it("should revert", async () =>{
            await expect(
              tryGetConversionPlan({ incorrectHealthFactor2: 100 })
            ).revertedWith("TC-3 wrong health factor"); // WRONG_HEALTH_FACTOR
          });
        });
        describe("countBlocks_ is zero", () => {
          it("should revert", async () => {
            await expect(
              tryGetConversionPlan({ zeroCountBlocks: true })
            ).revertedWith("TC-29 incorrect value"); // INCORRECT_VALUE
          });
        });
        describe("collateralAmount_ is zero", () => {
          it("should revert", async () => {
            await expect(
              tryGetConversionPlan({ zeroCollateralAmount: true })
            ).revertedWith("TC-29 incorrect value"); // INCORRECT_VALUE
          });
        });
      });

      describe("cToken is not registered", () => {
        it("should fail if collateral token is not registered", async () => {
          expect((await tryGetConversionPlan(
            {},
            MaticAddresses.agEUR
          )).converter).eq(Misc.ZERO_ADDRESS);
        });
        it("should fail if borrow token is not registered", async () => {
          expect((await tryGetConversionPlan(
            {},
            MaticAddresses.DAI,
            MaticAddresses.agEUR,
          )).converter).eq(Misc.ZERO_ADDRESS);
        });
      });

      describe("capacity", () => {
        it("should return expected maxAmountToBorrow if borrowCapacity is limited", async () => {
          const planBorrowCapacityNotLimited = await tryGetConversionPlan(
            {},
            MaticAddresses.DAI,
            MaticAddresses.USDC,
            MaticAddresses.dForce_iDAI,
            MaticAddresses.dForce_iUSDC,
            getBigNumberFrom(12345, 18)
          );
          const plan = await tryGetConversionPlan(
            {setMinBorrowCapacity: true},
            MaticAddresses.DAI,
            MaticAddresses.USDC,
            MaticAddresses.dForce_iDAI,
            MaticAddresses.dForce_iUSDC,
            getBigNumberFrom(12345, 18)
          );
          console.log("planBorrowCapacityNotLimited", planBorrowCapacityNotLimited);
          console.log("plan", plan);
          const ret = [
            plan.amountToBorrow.eq(plan.maxAmountToBorrow),
            plan.amountToBorrow.lt(planBorrowCapacityNotLimited.maxAmountToBorrow),
            planBorrowCapacityNotLimited.amountToBorrow.lt(planBorrowCapacityNotLimited.maxAmountToBorrow)
          ].join("\n");
          const expected = [true, true, true].join("\n");
          expect(ret).eq(expected);
        });
        it("should return expected maxAmountToSupply if supplyCapacity is limited", async () => {
          const plan = await tryGetConversionPlan(
            {setMinSupplyCapacity: true},
            MaticAddresses.DAI,
            MaticAddresses.USDC,
            MaticAddresses.dForce_iDAI,
            MaticAddresses.dForce_iUSDC,
            parseUnits("12345", 18)
          );
          console.log(plan);
          expect(plan.maxAmountToSupply.lt(parseUnits("12345"))).eq(true);
        });
        it("should return zero plan if supplyCapacity is zero", async () => {
          const plan = await tryGetConversionPlan(
            {setZeroSupplyCapacity: true},
            MaticAddresses.DAI,
            MaticAddresses.USDC,
            MaticAddresses.dForce_iDAI,
            MaticAddresses.dForce_iUSDC,
            parseUnits("12345", 18)
          );
          const market = await IDForceController__factory.connect(MaticAddresses.DFORCE_CONTROLLER, deployer).markets(MaticAddresses.dForce_iDAI);
          console.log("market", market);

          console.log(plan);
          expect(plan.converter).eq(Misc.ZERO_ADDRESS);
        });
        it("should return zero plan if borrowCapacity is zero", async () => {
          const plan = await tryGetConversionPlan(
            {setZeroBorrowCapacity: true},
            MaticAddresses.DAI,
            MaticAddresses.USDC,
            MaticAddresses.dForce_iDAI,
            MaticAddresses.dForce_iUSDC,
            parseUnits("12345", 18)
          );
          const market = await IDForceController__factory.connect(MaticAddresses.DFORCE_CONTROLLER, deployer).markets(MaticAddresses.dForce_iDAI);
          console.log("market", market);

          console.log(plan);
          expect(plan.converter).eq(Misc.ZERO_ADDRESS);
        });
      });

      describe("paused", () => {
        it("should fail if mintPaused is true for collateral", async () => {
          expect((await tryGetConversionPlan({setCollateralMintPaused: true})).converter).eq(Misc.ZERO_ADDRESS);
        });
        it("should fail if redeemPaused for borrow", async () => {
          expect((await tryGetConversionPlan({setRedeemPaused: true})).converter).eq(Misc.ZERO_ADDRESS);
        });
        it("should fail if borrowPaused for borrow", async () => {
          expect((await tryGetConversionPlan({setBorrowPaused: true})).converter).eq(Misc.ZERO_ADDRESS);
        });
      });

      describe("Use unsupported entry kind 999", () => {
        it("should return zero plan", async () => {
          const r = await preparePlan(
            controller,
            MaticAddresses.DAI,
            parseUnits("1", 18),
            MaticAddresses.WMATIC,
            MaticAddresses.dForce_iDAI,
            MaticAddresses.dForce_iMATIC,
            undefined,
            defaultAbiCoder.encode(["uint256"], [999]) // (!) unsupported entry kind
          );

          expect(r.plan.converter).eq(Misc.ZERO_ADDRESS);
          expect(r.plan.collateralAmount.eq(0)).eq(true);
          expect(r.plan.amountToBorrow.eq(0)).eq(true);
        });
      });

      describe("Result collateralAmount == 0, amountToBorrow != 0 (edge case, improve coverage)", () => {
        it("should return zero plan", async () => {
          const collateralAsset = MaticAddresses.DAI;
          const borrowAsset = MaticAddresses.USDC;
          const collateralCToken = MaticAddresses.dForce_iDAI;
          const borrowCToken = MaticAddresses.dForce_iUSDC;
          const collateralAmount = getBigNumberFrom(1000, 18);

          const r0 = await preparePlan(
            controller,
            collateralAsset,
            collateralAmount,
            borrowAsset,
            collateralCToken,
            borrowCToken,
            undefined,
            defaultAbiCoder.encode(["uint256"], [2])
          );

          // change prices: make priceCollateral very high, priceBorrow very low
          // as result, exactBorrowOutForMinCollateralIn will return amountToCollateralOut = 0,
          // and we should hit second condition in borrow-validation section:
          //    plan.amountToBorrow == 0 || plan.collateralAmount == 0
          const priceOracle = await DForceChangePriceUtils.setupPriceOracleMock(deployer, true);
          await priceOracle.setUnderlyingPrice(MaticAddresses.dForce_iDAI, parseUnits("1", 25));
          await priceOracle.setUnderlyingPrice(MaticAddresses.dForce_iUSDC, parseUnits("1", 2));

          const r1 = await preparePlan(
            controller,
            collateralAsset,
            collateralAmount,
            borrowAsset,
            collateralCToken,
            borrowCToken,
            undefined,
            defaultAbiCoder.encode(["uint256"], [2])
          );

          // first plan is successful
          expect(r0.plan.converter).not.eq(Misc.ZERO_ADDRESS);
          expect(r0.plan.collateralAmount.eq(0)).not.eq(true);
          expect(r0.plan.amountToBorrow.eq(0)).not.eq(true);

          // the plan created after changing the prices is not successful
          expect(r1.plan.converter).eq(Misc.ZERO_ADDRESS);
          expect(r1.plan.collateralAmount.eq(0)).eq(true);
          expect(r1.plan.amountToBorrow.eq(0)).eq(true);
        });
      });
    });
    describe("Check gas limit @skip-on-coverage", () => {
      it("should not exceed gas limits", async () => {
        const comptroller = await DForceHelper.getController(deployer);
        const dForcePlatformAdapter = await AdaptersHelper.createDForcePlatformAdapter(
          deployer,
          controller.address,
          comptroller.address,
          ethers.Wallet.createRandom().address,
          [MaticAddresses.dForce_iDAI, MaticAddresses.dForce_iUSDC],
        );

        const gasUsed = await dForcePlatformAdapter.estimateGas.getConversionPlan(
          {
            collateralAsset: MaticAddresses.DAI,
            amountIn: parseUnits("1", 18),
            borrowAsset: MaticAddresses.USDC,
            countBlocks: 1000,
            entryData: "0x",
            user: Misc.ZERO_ADDRESS
          },
          200,
          {gasLimit: GAS_LIMIT},
        );
        console.log("DForcePlatformAdapter.getConversionPlan.gas", gasUsed.toString());
        controlGasLimitsEx(gasUsed, GAS_LIMIT_DFORCE_GET_CONVERSION_PLAN, (u, t) => {
          expect(u).to.be.below(t);
        });
      });
    });
  });

  describe("getBorrowRateAfterBorrow", () => {
    describe("Good paths", () => {
      describe("small amount DAI => USDC", () => {
        it("Predicted borrow rate should be same to real rate after the borrow", async () => {
          const collateralAsset = MaticAddresses.DAI;
          const collateralCToken = MaticAddresses.dForce_iDAI;
          const borrowAsset = MaticAddresses.USDC;
          const borrowCToken = MaticAddresses.dForce_iUSDC;

          const collateralHolders = [
            MaticAddresses.HOLDER_DAI,
            MaticAddresses.HOLDER_DAI_2,
            MaticAddresses.HOLDER_DAI_3,
            MaticAddresses.HOLDER_DAI_4,
            MaticAddresses.HOLDER_DAI_5,
            MaticAddresses.HOLDER_DAI_6,
          ];
          const part10000 = 1;

          const r = await makePredictBrTest(
            collateralAsset,
            collateralCToken,
            borrowAsset,
            borrowCToken,
            collateralHolders,
            part10000,
          );

          const ret = areAlmostEqual(r.br, r.brPredicted, 4);
          expect(ret).eq(true);
        });
      });

      describe("Huge amount DAI => USDC", () => {
        it("Predicted borrow rate should be same to real rate after the borrow", async () => {
          const collateralAsset = MaticAddresses.DAI;
          const collateralCToken = MaticAddresses.dForce_iDAI;
          const borrowAsset = MaticAddresses.USDC;
          const borrowCToken = MaticAddresses.dForce_iUSDC;

          const collateralHolders = [
            MaticAddresses.HOLDER_DAI,
            MaticAddresses.HOLDER_DAI_2,
            MaticAddresses.HOLDER_DAI_3,
            MaticAddresses.HOLDER_DAI_4,
            MaticAddresses.HOLDER_DAI_5,
            MaticAddresses.HOLDER_DAI_6,
          ];
          const part10000 = 500;

          const r = await makePredictBrTest(
            collateralAsset,
            collateralCToken,
            borrowAsset,
            borrowCToken,
            collateralHolders,
            part10000,
          );

          const ret = areAlmostEqual(r.br, r.brPredicted, 4);
          expect(ret).eq(true);

        });
      });

      describe("Huge amount DAI => WBTC", () => {
        it("Predicted borrow rate should be same to real rate after the borrow", async () => {
          const collateralAsset = MaticAddresses.DAI;
          const collateralCToken = MaticAddresses.dForce_iDAI;
          const borrowAsset = MaticAddresses.WBTC;
          const borrowCToken = MaticAddresses.dForce_iWBTC;

          const collateralHolders = [
            MaticAddresses.HOLDER_DAI,
            MaticAddresses.HOLDER_DAI_2,
            MaticAddresses.HOLDER_DAI_3,
            MaticAddresses.HOLDER_DAI_4,
            MaticAddresses.HOLDER_DAI_5,
            MaticAddresses.HOLDER_DAI_6,
          ];
          const part10000 = 500;

          const r = await makePredictBrTest(
            collateralAsset,
            collateralCToken,
            borrowAsset,
            borrowCToken,
            collateralHolders,
            part10000,
          );

          const ret = areAlmostEqual(r.br, r.brPredicted, 3);
          expect(ret).eq(true);
        });
      });
    });
  });

  describe("getRewardAmounts", () => {
    describe("Good paths", () => {
      describe("Supply, wait, get rewards", () => {
        it("should return amount of rewards same to really received", async () => {
          const collateralAsset = MaticAddresses.DAI;
          const collateralHolder = MaticAddresses.HOLDER_DAI;
          const collateralCTokenAddress = MaticAddresses.dForce_iDAI;

          const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
          const collateralCToken = await TokenDataTypes.Build(deployer, collateralCTokenAddress);

          const collateralAmount = getBigNumberFrom(20_000, collateralToken.decimals);
          const periodInBlocks = 1_000;

          // use DForce-platform adapter to predict amount of rewards
          const controller = await TetuConverterApp.createController(
            deployer,
            {tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
          );
          const borrowManager = BorrowManager__factory.connect(await controller.borrowManager(), deployer);

          const fabric: DForcePlatformFabric = new DForcePlatformFabric();
          await fabric.createAndRegisterPools(deployer, controller);
          console.log("Count registered platform adapters", await borrowManager.platformAdaptersLength());

          const platformAdapter = DForcePlatformAdapter__factory.connect(
            await borrowManager.platformAdaptersAt(0),
            deployer
          );
          console.log("Platform adapter is created", platformAdapter.address);
          const user = await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address);
          console.log("user", user.address);

          // make supply, wait period, get actual amount of rewards
          const r = await SupplyBorrowUsingDForce.makeSupplyRewardsTestMinimumTransactions(
            deployer,
            user,
            collateralToken,
            collateralCToken,
            collateralHolder,
            collateralAmount,
            periodInBlocks,
          );

          const pst = DForceHelper.predictRewardsStatePointAfterSupply(r.supplyPoint);
          const ret = DForceHelper.getSupplyRewardsAmount(pst, r.blockUpdateDistributionState);

          const sret = [
            ret.rewardsAmount.toString()
          ].join("\n");
          const sexpected = [
            r.rewardsEarnedActual.toString()
          ].join("\n");

          expect(sret).eq(sexpected);
        });
      });
    });

  });

  describe("initializePoolAdapter", () => {
    let controller: ConverterController;
    let snapshotLocal: string;
    before(async function () {
      snapshotLocal = await TimeUtils.snapshot();
      controller = await TetuConverterApp.createController(
        deployer,
        {tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
      );
    });
    after(async function () {
      await TimeUtils.rollback(snapshotLocal);
    });
    interface IInitializePoolAdapterBadPaths {
      useWrongConverter?: boolean;
      wrongCallerOfInitializePoolAdapter?: boolean;
    }
    async function makeInitializePoolAdapterTest(
      badParams?: IInitializePoolAdapterBadPaths
    ) : Promise<{ret: string, expected: string}> {
      const user = ethers.Wallet.createRandom().address;
      const collateralAsset = MaticAddresses.DAI;
      const borrowAsset = MaticAddresses.USDC;

      const borrowManager = BorrowManager__factory.connect(await controller.borrowManager(), deployer);
      const converterNormal = await AdaptersHelper.createDForcePoolAdapter(deployer);

      const comptroller = await DForceHelper.getController(deployer);
      const platformAdapter = await AdaptersHelper.createDForcePlatformAdapter(
        deployer,
        controller.address,
        comptroller.address,
        converterNormal.address,
        [MaticAddresses.dForce_iDAI, MaticAddresses.dForce_iUSDC]
      );

      const poolAdapter = await AdaptersHelper.createDForcePoolAdapter(deployer)
      const platformAdapterAsBorrowManager = DForcePlatformAdapter__factory.connect(
        platformAdapter.address,
        badParams?.wrongCallerOfInitializePoolAdapter
          ? await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address)
          : await DeployerUtils.startImpersonate(borrowManager.address)
      );

      await platformAdapterAsBorrowManager.initializePoolAdapter(
        badParams?.useWrongConverter
          ? ethers.Wallet.createRandom().address
          : converterNormal.address,
        poolAdapter.address,
        user,
        collateralAsset,
        borrowAsset
      );

      const poolAdapterConfigAfter = await poolAdapter.getConfig();
      const ret = [
        poolAdapterConfigAfter.origin,
        poolAdapterConfigAfter.outUser,
        poolAdapterConfigAfter.outCollateralAsset.toLowerCase(),
        poolAdapterConfigAfter.outBorrowAsset.toLowerCase()
      ].join("\n");
      const expected = [
        converterNormal.address,
        user,
        collateralAsset.toLowerCase(),
        borrowAsset.toLowerCase()
      ].join("\n");
      return {ret, expected};
    }

    describe("Good paths", () => {
      it("initialized pool adapter should has expected values", async () => {
        const r = await makeInitializePoolAdapterTest();
        expect(r.ret).eq(r.expected);
      });
    });
    describe("Bad paths", () => {
      it("should revert if converter address is not registered", async () => {
        await expect(
          makeInitializePoolAdapterTest(
            {useWrongConverter: true}
          )
        ).revertedWith("TC-25 converter not found"); // CONVERTER_NOT_FOUND
      });
      it("should revert if it's called by not borrow-manager", async () => {
        await expect(
          makeInitializePoolAdapterTest(
            {wrongCallerOfInitializePoolAdapter: true}
          )
        ).revertedWith("TC-45 borrow manager only"); // BORROW_MANAGER_ONLY
      });
    });
  });

  describe("registerCTokens", () => {
    let controller: ConverterController;
    let snapshotLocal: string;
    before(async function () {
      snapshotLocal = await TimeUtils.snapshot();
      controller = await TetuConverterApp.createController(deployer);
    });
    after(async function () {
      await TimeUtils.rollback(snapshotLocal);
    });
    describe("Good paths", () => {
      it("should return expected values", async () => {
        const platformAdapter = await AdaptersHelper.createDForcePlatformAdapter(
          deployer,
          controller.address,
          DForceHelper.getController(deployer).address,
          ethers.Wallet.createRandom().address,
          [MaticAddresses.dForce_iUSDC, MaticAddresses.dForce_iWETH]
        );
        await platformAdapter.registerCTokens(
          [MaticAddresses.dForce_iCRV, MaticAddresses.dForce_iCRV, MaticAddresses.dForce_iWETH]
        );

        const ret = [
          await platformAdapter.activeAssets(MaticAddresses.USDC),
          await platformAdapter.activeAssets(MaticAddresses.WETH),
          await platformAdapter.activeAssets(MaticAddresses.CRV),
          await platformAdapter.activeAssets(MaticAddresses.USDT), // (!) not registered
        ].join();

        const expected = [
          MaticAddresses.dForce_iUSDC,
          MaticAddresses.dForce_iWETH,
          MaticAddresses.dForce_iCRV,
          Misc.ZERO_ADDRESS
        ].join();

        expect(ret).eq(expected);
      });
    });
    describe("Bad paths", () => {
      describe("Not governance", () => {
        it("should revert", async () => {
          const platformAdapter = await AdaptersHelper.createDForcePlatformAdapter(
            deployer,
            controller.address,
            DForceHelper.getController(deployer).address,
            ethers.Wallet.createRandom().address,
            [MaticAddresses.dForce_iUSDC, MaticAddresses.dForce_iWETH]
          );
          const platformAdapterAsNotGov = DForcePlatformAdapter__factory.connect(
            platformAdapter.address,
            await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address)
          );
          await expect(
            platformAdapterAsNotGov.registerCTokens(
              [MaticAddresses.dForce_iCRV, MaticAddresses.dForce_iCRV, MaticAddresses.dForce_iWETH]
            )
          ).revertedWith("TC-9 governance only"); // GOVERNANCE_ONLY
        });
      });
      describe("Try to add not CToken", () => {
        it("should revert", async () => {
          const platformAdapter = await AdaptersHelper.createDForcePlatformAdapter(
            deployer,
            controller.address,
            DForceHelper.getController(deployer).address,
            ethers.Wallet.createRandom().address,
            [MaticAddresses.dForce_iUSDC, MaticAddresses.dForce_iWETH]
          );
          await expect(
            platformAdapter.registerCTokens(
              [ethers.Wallet.createRandom().address] // (!)
            )
          ).revertedWithoutReason();
        });
      });
    });
  });

  describe("events", () => {
    it("should emit expected values", async () => {
      const user = ethers.Wallet.createRandom().address;
      const collateralAsset = MaticAddresses.DAI;
      const borrowAsset = MaticAddresses.USDC;

      const controller = await TetuConverterApp.createController(deployer);
      const converterNormal = await AdaptersHelper.createDForcePoolAdapter(deployer);
      const platformAdapter = await AdaptersHelper.createDForcePlatformAdapter(
        deployer,
        controller.address,
        MaticAddresses.DFORCE_CONTROLLER,
        converterNormal.address,
        [MaticAddresses.dForce_iDAI, MaticAddresses.dForce_iUSDC]
      );

      const poolAdapter = await AdaptersHelper.createDForcePoolAdapter(deployer);
      const platformAdapterAsBorrowManager = DForcePlatformAdapter__factory.connect(
        platformAdapter.address,
        await DeployerUtils.startImpersonate(await controller.borrowManager())
      );

      function stringsEqualCaseInsensitive(s1: string, s2: string): boolean {
        return s1.toUpperCase() === s2.toUpperCase();
      }
      await expect(
        platformAdapterAsBorrowManager.initializePoolAdapter(
          converterNormal.address,
          poolAdapter.address,
          user,
          collateralAsset,
          borrowAsset
        )
      ).to.emit(platformAdapter, "OnPoolAdapterInitialized").withArgs(
        (s: string) => stringsEqualCaseInsensitive(s, converterNormal.address),
        (s: string) => stringsEqualCaseInsensitive(s, poolAdapter.address),
        (s: string) => stringsEqualCaseInsensitive(s, user),
        (s: string) => stringsEqualCaseInsensitive(s, collateralAsset),
        (s: string) => stringsEqualCaseInsensitive(s, borrowAsset)
      );
    });
  });

  describe("setFrozen", () => {
    describe("Good paths", () => {
      it("should assign expected value to frozen", async () => {
        const controller = await TetuConverterApp.createController(deployer,
          {tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
        );

        const comptroller = await DForceHelper.getController(deployer);
        const dForcePlatformAdapter = await AdaptersHelper.createDForcePlatformAdapter(
          deployer,
          controller.address,
          comptroller.address,
          ethers.Wallet.createRandom().address,
          [MaticAddresses.dForce_iDAI, MaticAddresses.dForce_iUSDC],
        );

        const before = await dForcePlatformAdapter.frozen();
        await dForcePlatformAdapter.setFrozen(true);
        const middle = await dForcePlatformAdapter.frozen();
        await dForcePlatformAdapter.setFrozen(false);
        const after = await dForcePlatformAdapter.frozen();

        const ret = [before, middle, after].join();
        const expected = [false, true, false].join();

        expect(ret).eq(expected);
      });
    });
    describe("Bad paths", () => {
      it("should assign expected value to frozen", async () => {
        const comptroller = await DForceHelper.getController(deployer);
        const dForcePlatformAdapter = await AdaptersHelper.createDForcePlatformAdapter(
          deployer,
          (await TetuConverterApp.createController(deployer)).address,
          comptroller.address,
          ethers.Wallet.createRandom().address,
          [MaticAddresses.dForce_iDAI, MaticAddresses.dForce_iUSDC],
        );

        await expect(
          dForcePlatformAdapter.connect(await Misc.impersonate(ethers.Wallet.createRandom().address)).setFrozen(true)
        ).revertedWith("TC-9 governance only"); // AppErrors.GOVERNANCE_ONLY
      });
    });
  });

  describe("platformKind", () => {
    it("should return expected values", async () => {
      const controller = await TetuConverterApp.createController(deployer);

      const comptroller = await DForceHelper.getController(deployer);
      const pa = await AdaptersHelper.createDForcePlatformAdapter(
        deployer,
        controller.address,
        comptroller.address,
        ethers.Wallet.createRandom().address,
        [MaticAddresses.dForce_iDAI, MaticAddresses.dForce_iUSDC],
      );
      expect((await pa.platformKind())).eq(1); // LendingPlatformKinds.DFORCE_1
    });
  });
//endregion Unit tests

});
