import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {
  Borrower,
  BorrowManager__factory,
  Controller, DForcePlatformAdapter, DForcePoolAdapter, DForcePoolAdapter__factory, IDForceController, IDForceCToken,
  IDForceCToken__factory, IDForcePriceOracle, IERC20__factory, IERC20Extended__factory, IPoolAdapter__factory,
} from "../../../../typechain";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../../scripts/utils/NumberUtils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {AdaptersHelper} from "../../../baseUT/helpers/AdaptersHelper";
import {isPolygonForkInUse} from "../../../baseUT/utils/NetworkUtils";
import {BalanceUtils, IUserBalances} from "../../../baseUT/utils/BalanceUtils";
import {CoreContractsHelper} from "../../../baseUT/helpers/CoreContractsHelper";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {MocksHelper} from "../../../baseUT/helpers/MocksHelper";
import {TokenDataTypes} from "../../../baseUT/types/TokenDataTypes";
import {DForceHelper, IDForceMarketData} from "../../../../scripts/integration/helpers/DForceHelper";
import {Misc} from "../../../../scripts/utils/Misc";
import {CompareAprUsesCase} from "../../../baseUT/uses-cases/CompareAprUsesCase";
import {IDForceCalcAccountEquityResults} from "../../../baseUT/apr/aprDForce";
import {areAlmostEqual, toStringWithRound} from "../../../baseUT/utils/CommonUtils";
import {IPoolAdapterStatus} from "../../../baseUT/types/BorrowRepayDataTypes";

describe("DForce integration tests, pool adapter", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
//endregion Global vars for all tests

//region before, after
  before(async function () {
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

//region Test impl
  interface IPrepareToBorrowResults {
    userContract: Borrower;
    dfPoolAdapterTC: DForcePoolAdapter;
    dfPlatformAdapter: DForcePlatformAdapter;
    priceOracle: IDForcePriceOracle;
    comptroller: IDForceController;

    controller: Controller;

    /** Amount that can be borrowed according to the conversion plan */
    amountToBorrow: BigNumber;
    /** Actual amount that was used as collateral */
    collateralAmount: BigNumber;

    collateralCToken: IDForceCToken;
    borrowCToken: IDForceCToken;
  }

  interface IMarketsInfo {
    borrowData: IDForceMarketData;
    collateralData: IDForceMarketData;

    priceCollateral: BigNumber;
    priceBorrow: BigNumber;
  }

  /**
   * Initialize TetuConverter app and DForce pool adapter.
   * Put the collateral amount on pool-adapter's balance.
   */
  async function prepareToBorrow(
    collateralToken: TokenDataTypes,
    collateralHolder: string,
    collateralCTokenAddress: string,
    collateralAmountRequired: BigNumber | undefined,
    borrowToken: TokenDataTypes,
    borrowCTokenAddress: string,
    targetHealthFactor2?: number
  ) : Promise<IPrepareToBorrowResults> {
    const periodInBlocks = 1000;

    // controller, dm, bm
    const controller = await CoreContractsHelper.createController(deployer);
    const tetuConverter = await CoreContractsHelper.createTetuConverter(deployer, controller);
    const debtMonitor = await CoreContractsHelper.createDebtMonitor(deployer, controller);
    // const borrowManager = await MocksHelper.createBorrowManagerStub(deployer, true);
    const borrowManager = await CoreContractsHelper.createBorrowManager(deployer, controller);
    await controller.setBorrowManager(borrowManager.address);
    await controller.setDebtMonitor(debtMonitor.address);
    await controller.setTetuConverter(tetuConverter.address);

    const userContract = await MocksHelper.deployBorrower(deployer.address, controller, periodInBlocks);

    const converterNormal = await AdaptersHelper.createDForcePoolAdapter(deployer);

    const comptroller = await DForceHelper.getController(deployer);
    const priceOracle = await DForceHelper.getPriceOracle(comptroller, deployer);

    const dfPlatformAdapter = await AdaptersHelper.createDForcePlatformAdapter(
      deployer,
      controller.address,
      MaticAddresses.DFORCE_CONTROLLER,
      converterNormal.address,
      [collateralCTokenAddress, borrowCTokenAddress],
    );

    await borrowManager.addAssetPairs(
      dfPlatformAdapter.address,
      [collateralToken.address],
      [borrowToken.address]
    );
    const bmAsTc = BorrowManager__factory.connect(
      borrowManager.address,
      await DeployerUtils.startImpersonate(tetuConverter.address)
    );
    await bmAsTc.registerPoolAdapter(
      converterNormal.address,
      userContract.address,
      collateralToken.address,
      borrowToken.address
    );
    const dfPoolAdapterTC = DForcePoolAdapter__factory.connect(
      await borrowManager.getPoolAdapter(
        converterNormal.address,
        userContract.address,
        collateralToken.address,
        borrowToken.address
      ),
      await DeployerUtils.startImpersonate(tetuConverter.address)
    );

    // put collateral amount on user's balance
    const holderBalance = await collateralToken.token.balanceOf(collateralHolder);
    const collateralAmount = collateralAmountRequired && holderBalance.gt(collateralAmountRequired)
      ? collateralAmountRequired
      : holderBalance;

    // collateral asset
    await collateralToken.token
      .connect(await DeployerUtils.startImpersonate(collateralHolder))
      .transfer(userContract.address, collateralAmount);

     // calculate max allowed amount to borrow
    const countBlocks = 1;
    const borrowAmountFactor18 = CompareAprUsesCase.getBorrowAmountFactor18(
      collateralAmount,
      targetHealthFactor2 || await controller.targetHealthFactor2(),
      collateralToken.decimals
    );

    const plan = await dfPlatformAdapter.getConversionPlan(
      collateralToken.address,
      collateralAmount,
      borrowToken.address,
      borrowAmountFactor18,
      countBlocks
    );
    console.log("plan", plan);

    return {
      controller,
      comptroller,
      dfPoolAdapterTC,
      dfPlatformAdapter,
      amountToBorrow: plan.amountToBorrow,
      userContract,
      priceOracle,
      collateralAmount,
      collateralCToken: IDForceCToken__factory.connect(collateralCTokenAddress, deployer),
      borrowCToken: IDForceCToken__factory.connect(borrowCTokenAddress, deployer)
    }
  }

  async function getMarketsInfo(
    d: IPrepareToBorrowResults,
    collateralCTokenAddress: string,
    borrowCTokenAddress: string
  ) : Promise<IMarketsInfo> {
    // tokens data
    const borrowData = await DForceHelper.getCTokenData(deployer, d.comptroller
      , IDForceCToken__factory.connect(borrowCTokenAddress, deployer)
    );
    const collateralData = await DForceHelper.getCTokenData(deployer, d.comptroller
      , IDForceCToken__factory.connect(collateralCTokenAddress, deployer)
    );

    // prices of assets in base currency
    // From sources: The underlying asset price mantissa (scaled by 1e18).
    // WRONG: The price of the asset in USD as an unsigned integer scaled up by 10 ^ (36 - underlying asset decimals).
    // WRONG: see https://compound.finance/docs/prices#price
    const priceCollateral = await d.priceOracle.getUnderlyingPrice(collateralCTokenAddress);
    const priceBorrow = await d.priceOracle.getUnderlyingPrice(borrowCTokenAddress);
    console.log("priceCollateral", priceCollateral);
    console.log("priceBorrow", priceBorrow);

    return {
      borrowData,
      collateralData,
      priceBorrow,
      priceCollateral
    }
  }

  /**
   *  ALl calculations are explained here:
   *  https://docs.google.com/spreadsheets/d/1oLeF7nlTefoN0_9RWCuNc62Y7W72-Yk7
   *  sheet: HundredFinance
   */
  function getExpectedLiquidity(
    collateralData: IDForceMarketData,
    priceCollateral: BigNumber,
    priceBorrow: BigNumber,
    cTokenBalance: BigNumber,
    bBorrowBalance: BigNumber
  ): BigNumber {

    const cf1 = collateralData.collateralFactorMantissa;
    const er1 = collateralData.exchangeRateStored;
    const pr1 = priceCollateral;
    const sc1 = cTokenBalance.mul(cf1).mul(er1).div(Misc.WEI).mul(pr1).div(Misc.WEI);
    const sb1 = priceBorrow.mul(bBorrowBalance);
    const expectedLiquiditiy = sc1.sub(sb1);
    console.log(`cf1=${cf1} er1=${er1} pr1=${pr1} sc1=${sc1} sb1=${sb1} L1=${expectedLiquiditiy}`);
    console.log("health factor", ethers.utils.formatUnits(sc1.mul(Misc.WEI).div(sb1)));
    return expectedLiquiditiy;
  }
//endregion Test impl

//region Unit tests
  describe("borrow", () => {
    async function makeBorrow(
      collateralToken: TokenDataTypes,
      collateralCToken: TokenDataTypes,
      collateralHolder: string,
      collateralAmountRequired: BigNumber | undefined,
      borrowToken: TokenDataTypes,
      borrowCToken: TokenDataTypes,
      borrowAmountRequired: BigNumber | undefined
    ) : Promise<{sret: string, sexpected: string}>{
      const d = await prepareToBorrow(
        collateralToken,
        collateralHolder,
        collateralCToken.address,
        collateralAmountRequired,
        borrowToken,
        borrowCToken.address
      );
      const borrowAmount = borrowAmountRequired
        ? borrowAmountRequired
        : d.amountToBorrow;
      console.log("collateralAmountRequired", collateralAmountRequired);
      console.log("borrowAmountRequired", borrowAmountRequired);
      console.log("d.collateralAmount", d.collateralAmount);
      console.log("borrowAmount", borrowAmount);

      await d.dfPoolAdapterTC.syncBalance(true, true);
      await IERC20__factory.connect(collateralToken.address,
        await DeployerUtils.startImpersonate(d.userContract.address)
      ).transfer(d.dfPoolAdapterTC.address, d.collateralAmount);
      await d.dfPoolAdapterTC.borrow(
        d.collateralAmount,
        borrowAmount,
        d.userContract.address
      );
      console.log(`borrow: success`);

      // get market's info afer borrowing
      const info = await getMarketsInfo(
        d,
        collateralCToken.address,
        borrowCToken.address
      );

      // check results

      // https://developers.dforce.network/lend/lend-and-synth/controller#calcaccountequity
      // Collaterals and borrows represent the current collateral and borrow value is USD with 36 integer precision
      // which for example, 360000000000000000000000000000000000000000 indicates 360000 in USD.
      const {
        accountEquity,
        shortfall,
        collateralValue,
        borrowedValue
      } = await d.comptroller.calcAccountEquity(d.dfPoolAdapterTC.address);
      console.log(`calcAccountEquity: accountEquity=${accountEquity} shortfall=${shortfall} collateralValue=${collateralValue} borrowedValue=${borrowedValue}`);

      const cTokenBorrow = await IDForceCToken__factory.connect(borrowCToken.address, deployer);
      const bBorrowBalance = await cTokenBorrow.borrowBalanceStored(d.dfPoolAdapterTC.address);
      const bTokenBalance = await cTokenBorrow.balanceOf(d.dfPoolAdapterTC.address);
      const bExchangeRateMantissa = await cTokenBorrow.exchangeRateStored();
      console.log(`Borrow token: balance=${bBorrowBalance} tokenBalance=${bTokenBalance} exchangeRate=${bExchangeRateMantissa}`);

      const cTokenCollateral = await IDForceCToken__factory.connect(collateralCToken.address, deployer);
      const cBorrowBalance = await cTokenCollateral.borrowBalanceStored(d.dfPoolAdapterTC.address);
      const cTokenBalance = await cTokenCollateral.balanceOf(d.dfPoolAdapterTC.address);
      const cExchangeRateMantissa = await cTokenCollateral.exchangeRateStored();
      console.log(`Collateral token: balance=${cBorrowBalance} tokenBalance=${cTokenBalance} exchangeRate=${cExchangeRateMantissa}`);

      const retBalanceBorrowUser = await borrowToken.token.balanceOf(d.userContract.address);
      const retBalanceCollateralTokensPoolAdapter = await IERC20Extended__factory.connect(
        collateralCToken.address, deployer
      ).balanceOf(d.dfPoolAdapterTC.address);

      const expectedLiquidity = getExpectedLiquidity(
        info.collateralData,
        info.priceCollateral,
        info.priceBorrow,
        cTokenBalance,
        bBorrowBalance
      )

      const sret = [
        retBalanceBorrowUser,
        retBalanceCollateralTokensPoolAdapter,
        accountEquity,
        shortfall,
      ].map(x => BalanceUtils.toString(x)).join("\n");

      const sexpected = [
        borrowAmount, // borrowed amount on user's balance
        d.collateralAmount
          .mul(Misc.WEI)
          .div(info.collateralData.exchangeRateStored),
        expectedLiquidity,
        0,
      ].map(x => BalanceUtils.toString(x)).join("\n");

      return {sret, sexpected};
    }

    describe("Good paths", () => {
//region Utils
      async function testDaiUsdc(
        collateralAmountNum: number | undefined,
        borrowAmountNum: number | undefined
      ) : Promise<{ret: string, expected: string}> {
        const collateralAsset = MaticAddresses.DAI;
        const collateralHolder = MaticAddresses.HOLDER_DAI;
        const collateralCTokenAddress = MaticAddresses.dForce_iDAI;

        const borrowAsset = MaticAddresses.USDC;
        const borrowCTokenAddress = MaticAddresses.dForce_iUSDC;

        const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
        const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);
        const collateralCToken = await TokenDataTypes.Build(deployer, collateralCTokenAddress);
        const borrowCToken = await TokenDataTypes.Build(deployer, borrowCTokenAddress);

        const collateralAmount = collateralAmountNum
          ? getBigNumberFrom(collateralAmountNum, collateralToken.decimals)
          : undefined;
        const borrowAmount = borrowAmountNum
          ? getBigNumberFrom(borrowAmountNum, borrowToken.decimals)
          : undefined;

        const r = await makeBorrow(
          collateralToken
          , collateralCToken
          , collateralHolder
          , collateralAmount
          , borrowToken
          , borrowCToken
          , borrowAmount
        );

        return {ret: r.sret, expected: r.sexpected};
      }

      async function testMaticEth(
        collateralAmountNum: number | undefined,
        borrowAmountNum: number | undefined
      ) : Promise<{ret: string, expected: string}> {
        const collateralAsset = MaticAddresses.WMATIC;
        const collateralHolder = MaticAddresses.HOLDER_WMATIC;
        const collateralCTokenAddress = MaticAddresses.dForce_iMATIC;

        const borrowAsset = MaticAddresses.WETH;
        const borrowCTokenAddress = MaticAddresses.dForce_iWETH;

        const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
        const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);
        const collateralCToken = await TokenDataTypes.Build(deployer, collateralCTokenAddress);
        const borrowCToken = await TokenDataTypes.Build(deployer, borrowCTokenAddress);

        const collateralAmount = collateralAmountNum
          ? getBigNumberFrom(collateralAmountNum, collateralToken.decimals)
          : undefined;
        const borrowAmount = borrowAmountNum
          ? getBigNumberFrom(borrowAmountNum, borrowToken.decimals)
          : undefined;

        const r = await makeBorrow(
          collateralToken
          , collateralCToken
          , collateralHolder
          , collateralAmount
          , borrowToken
          , borrowCToken
          , borrowAmount
        );

        return {ret: r.sret, expected: r.sexpected};
      }
//endregion Utils

      describe("Borrow small fixed amount", () => {
        describe("DAI-18 : usdc-6", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await testDaiUsdc(100_000, 10);
            expect(r.ret).eq(r.expected);
          });
        });
      });
      describe("Borrow max available amount using all available collateral", () => {
        describe("DAI-18 : usdc-6", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await testDaiUsdc(undefined, undefined);
            expect(r.ret).eq(r.expected);
          });
        });
        describe("Matic-18 : ETH-18", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await testMaticEth(undefined, undefined);
            expect(r.ret).eq(r.expected);
          });
        });
      });
    });
    describe("Bad paths", () => {
      describe("Not borrowable", () => {
        it("", async () =>{
          expect.fail("TODO");
        });
      });
      describe("Not usable as collateral", () => {
        it("", async () =>{
          expect.fail("TODO");
        });
      });
    });
  });

  describe("borrowToRebalance", () => {
    const minHealthFactorInitial2 = 1000;
    const targetHealthFactorInitial2 = 2000;
    const maxHealthFactorInitial2 = 4000;
    const minHealthFactorUpdated2 = 500;
    const targetHealthFactorUpdated2 = 1000;
    const maxHealthFactorUpdated2 = 2000;

    interface IMakeBorrowToRebalanceResults {
      afterBorrow: IDForceCalcAccountEquityResults;
      afterBorrowHealthFactor18: BigNumber;
      afterBorrowToRebalance: IDForceCalcAccountEquityResults;
      afterBorrowToRebalanceHealthFactor18: BigNumber;
      userBalanceAfterBorrow: BigNumber;
      userBalanceAfterBorrowToRebalance: BigNumber;
      expectedAdditionalBorrowAmount: BigNumber;
    }
    interface IMakeBorrowToRebalanceBadPathParams {
      makeBorrowToRebalanceAsDeployer?: boolean;
      skipBorrow?: boolean;
      additionalAmountCorrectionFactor?: number;
    }
    /**
     * Prepare aave3 pool adapter.
     * Set high health factors.
     * Make borrow.
     * Reduce health factor twice.
     * Make additional borrow.
     */
    async function makeBorrowToRebalance (
      collateralToken: TokenDataTypes,
      collateralHolder: string,
      collateralCTokenAddress: string,
      collateralAmount: BigNumber,
      borrowToken: TokenDataTypes,
      borrowCTokenAddress: string,
      borrowHolder: string,
      badPathsParams?: IMakeBorrowToRebalanceBadPathParams
    ) : Promise<IMakeBorrowToRebalanceResults>{
      const d = await prepareToBorrow(
        collateralToken,
        collateralHolder,
        collateralCTokenAddress,
        collateralAmount,
        borrowToken,
        borrowCTokenAddress,
        targetHealthFactorInitial2
      );

      // const info = await getMarketsInfo(d, collateralCTokenAddress, borrowCTokenAddress);

      // setup high values for all health factors
      await d.controller.setMaxHealthFactor2(maxHealthFactorInitial2);
      await d.controller.setTargetHealthFactor2(targetHealthFactorInitial2);
      await d.controller.setMinHealthFactor2(minHealthFactorInitial2);

      // make borrow
      const amountToBorrow = d.amountToBorrow;
      if (! badPathsParams?.skipBorrow) {
        await d.dfPoolAdapterTC.syncBalance(true, true);
        await IERC20__factory.connect(collateralToken.address,
          await DeployerUtils.startImpersonate(d.userContract.address)
        ).transfer(d.dfPoolAdapterTC.address, d.collateralAmount);
        await d.dfPoolAdapterTC.borrow(
          collateralAmount,
          amountToBorrow,
          d.userContract.address // receiver
        );
      }
      const afterBorrow = await d.comptroller.calcAccountEquity(d.dfPoolAdapterTC.address);
      const statusAfterBorrow = await d.dfPoolAdapterTC.getStatus();
      const userBalanceAfterBorrow = await borrowToken.token.balanceOf(d.userContract.address);
      console.log("after borrow:", afterBorrow, userBalanceAfterBorrow);

      // reduce all health factors down on 2 times to have possibility for additional borrow
      await d.controller.setMinHealthFactor2(minHealthFactorUpdated2);
      await d.controller.setTargetHealthFactor2(targetHealthFactorUpdated2);
      await d.controller.setMaxHealthFactor2(maxHealthFactorUpdated2);

      const expectedAdditionalBorrowAmount = amountToBorrow.mul(
        badPathsParams?.additionalAmountCorrectionFactor
          ? badPathsParams.additionalAmountCorrectionFactor
          : 1
      );
      console.log("expectedAdditionalBorrowAmount", expectedAdditionalBorrowAmount);

      // make additional borrow
      const poolAdapterSigner = badPathsParams?.makeBorrowToRebalanceAsDeployer
        ? IPoolAdapter__factory.connect(d.dfPoolAdapterTC.address, deployer)
        : d.dfPoolAdapterTC;
      await poolAdapterSigner.syncBalance(true, true);
      await poolAdapterSigner.borrowToRebalance(
        expectedAdditionalBorrowAmount,
        d.userContract.address // receiver
      );

      const afterBorrowToRebalance = await d.comptroller.calcAccountEquity(d.dfPoolAdapterTC.address);
      const statusAfterBorrowToRebalance = await d.dfPoolAdapterTC.getStatus();
      const userBalanceAfterBorrowToRebalance = await borrowToken.token.balanceOf(d.userContract.address);
      console.log("after borrow to rebalance:", afterBorrowToRebalance, userBalanceAfterBorrowToRebalance);

      return {
        afterBorrow,
        afterBorrowHealthFactor18: statusAfterBorrow.healthFactor18,
        afterBorrowToRebalance,
        afterBorrowToRebalanceHealthFactor18: statusAfterBorrowToRebalance.healthFactor18,
        userBalanceAfterBorrow,
        userBalanceAfterBorrowToRebalance,
        expectedAdditionalBorrowAmount
      }
    }

    async function testDaiUSDC(
      badPathParams?: IMakeBorrowToRebalanceBadPathParams
    ) : Promise<IMakeBorrowToRebalanceResults> {
      const collateralAsset = MaticAddresses.DAI;
      const collateralHolder = MaticAddresses.HOLDER_DAI;
      const collateralCTokenAddress = MaticAddresses.dForce_iDAI;

      const borrowAsset = MaticAddresses.USDC;
      const borrowCTokenAddress = MaticAddresses.dForce_iUSDC;
      const borrowHolder = MaticAddresses.HOLDER_USDC;

      const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
      const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);
      console.log("collateralToken.decimals", collateralToken.decimals);
      console.log("borrowToken.decimals", borrowToken.decimals);

      const collateralAmount = getBigNumberFrom(100_000, collateralToken.decimals);
      console.log(collateralAmount, collateralAmount);

      const r = await makeBorrowToRebalance(
        collateralToken,
        collateralHolder,
        collateralCTokenAddress,
        collateralAmount,
        borrowToken,
        borrowCTokenAddress,
        borrowHolder,
        badPathParams
      );

      console.log(r);
      return r;
    }

    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        const r = await testDaiUSDC();
        const ret = [
          Math.round(r.afterBorrowHealthFactor18.div(getBigNumberFrom(1, 15)).toNumber() / 10.),
          Math.round(r.afterBorrowToRebalanceHealthFactor18.div(getBigNumberFrom(1, 15)).toNumber() / 10.),
          toStringWithRound(r.userBalanceAfterBorrow),
          toStringWithRound(r.userBalanceAfterBorrowToRebalance),
        ].join();
        const expected = [
          targetHealthFactorInitial2,
          targetHealthFactorUpdated2,
          toStringWithRound(r.expectedAdditionalBorrowAmount),
          toStringWithRound(r.expectedAdditionalBorrowAmount.mul(2)),
        ].join();
        expect(ret).eq(expected);
      });
    });
    describe("Bad paths", () => {
      describe("Not TetuConverter", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            testDaiUSDC({makeBorrowToRebalanceAsDeployer: true})
          ).revertedWith("TC-8");
        });
      });
      describe("Position is not registered", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            testDaiUSDC({skipBorrow: true})
          ).revertedWith("TC-11");
        });
      });
      describe("Result health factor is less min allowed one", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            testDaiUSDC({additionalAmountCorrectionFactor: 10})
          ).revertedWith("TC-3: wrong health factor");
        });
      });
    });
  });

  describe("repay", () =>{
    interface IBorrowAndRepayResults {
      userBalancesBeforeBorrow: IUserBalances;
      userBalancesAfterBorrow: IUserBalances;
      userBalancesAfterRepay: IUserBalances;
      paCTokensBalance: BigNumber;
      totalCollateralBase: BigNumber;
      totalDebtBase: BigNumber;
    }
    async function makeBorrowAndRepay(
      collateralToken: TokenDataTypes,
      collateralCToken: TokenDataTypes,
      collateralHolder: string,
      collateralAmount: BigNumber,
      borrowToken: TokenDataTypes,
      borrowCToken: TokenDataTypes,
      borrowHolder: string,
      borrowAmount: BigNumber,
      amountToRepay?: BigNumber,
      initialBorrowAmountOnUserBalance?: BigNumber,
    ) : Promise<IBorrowAndRepayResults>{
      const d = await prepareToBorrow(collateralToken,
        collateralHolder,
        collateralCToken.address,
        collateralAmount,
        borrowToken,
        borrowCToken.address
      );

      // borrow asset
      if (initialBorrowAmountOnUserBalance) {
        await borrowToken.token
          .connect(await DeployerUtils.startImpersonate(borrowHolder))
          .transfer(d.userContract.address, initialBorrowAmountOnUserBalance);
      }

      const beforeBorrow: IUserBalances = {
        collateral: await collateralToken.token.balanceOf(d.userContract.address),
        borrow: await borrowToken.token.balanceOf(d.userContract.address)
      };

      // make borrow
      await d.dfPoolAdapterTC.syncBalance(true, true);
      await IERC20Extended__factory.connect(collateralToken.address
        , await DeployerUtils.startImpersonate(d.userContract.address)
      ).transfer(d.dfPoolAdapterTC.address, collateralAmount);
      await d.dfPoolAdapterTC.borrow(
        collateralAmount,
        borrowAmount,
        d.userContract.address
      );

      const statusAfterBorrow = await d.dfPoolAdapterTC.getStatus();
      console.log("statusAfterBorrow", statusAfterBorrow);
      const afterBorrow: IUserBalances = {
        collateral: await collateralToken.token.balanceOf(d.userContract.address),
        borrow: await borrowToken.token.balanceOf(d.userContract.address)
      };
      console.log(afterBorrow);

      TimeUtils.advanceNBlocks(1000);

      const borrowTokenAsUser = IERC20Extended__factory.connect(
        borrowToken.address,
        await DeployerUtils.startImpersonate(d.userContract.address)
      );
      if (amountToRepay) {
        // make partial repay
        await d.dfPoolAdapterTC.syncBalance(false, true);
        await borrowTokenAsUser.transfer(d.dfPoolAdapterTC.address, amountToRepay);
        await d.dfPoolAdapterTC.repay(
          amountToRepay,
          d.userContract.address,
          false
        );
      } else {
        console.log("user balance borrow asset before repay", await borrowTokenAsUser.balanceOf(d.userContract.address));
        // make full repayment
        await d.userContract.makeRepayComplete(
          collateralToken.address,
          borrowToken.address,
          d.userContract.address
        );
        console.log("user balance borrow asset after repay", await borrowTokenAsUser.balanceOf(d.userContract.address));
      }

      console.log("repay is done");
      const statusAfterRepay = await d.dfPoolAdapterTC.getStatus();
      console.log("statusAfterRepay", statusAfterRepay);

      // check results
      const afterRepay: IUserBalances = {
        collateral: await collateralToken.token.balanceOf(d.userContract.address),
        borrow: await borrowToken.token.balanceOf(d.userContract.address)
      };
      const cTokenCollateral = await IDForceCToken__factory.connect(collateralCToken.address, deployer);
      const cTokenBorrow = await IDForceCToken__factory.connect(borrowCToken.address, deployer);

      const bBorrowBalance = await cTokenBorrow.borrowBalanceStored(d.dfPoolAdapterTC.address);
      const cTokenBalance = await cTokenCollateral.balanceOf(d.dfPoolAdapterTC.address);

      return {
        userBalancesBeforeBorrow: beforeBorrow,
        userBalancesAfterBorrow: afterBorrow,
        userBalancesAfterRepay: afterRepay,
        paCTokensBalance: await cTokenCollateral.balanceOf(d.dfPoolAdapterTC.address),
        totalCollateralBase: cTokenBalance,
        totalDebtBase: bBorrowBalance
      }
    }
    describe("Good paths", () => {
      describe("Borrow and repay modest amount", () =>{
        describe("Partial repay of borrowed amount", () => {
          describe("DAI => USDC", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;

              const collateralAsset = MaticAddresses.DAI;
              const collateralHolder = MaticAddresses.HOLDER_DAI;
              const collateralCTokenAddress = MaticAddresses.dForce_iDAI;

              const borrowAsset = MaticAddresses.USDC;
              const borrowCTokenAddress = MaticAddresses.dForce_iUSDC;
              const borrowHolder = MaticAddresses.HOLDER_USDC;

              const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
              const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);
              const collateralCToken = await TokenDataTypes.Build(deployer, collateralCTokenAddress);
              const borrowCToken = await TokenDataTypes.Build(deployer, borrowCTokenAddress);

              const collateralAmount = getBigNumberFrom(100_000, collateralToken.decimals);
              const borrowAmount = getBigNumberFrom(10, borrowToken.decimals);

              const r = await makeBorrowAndRepay(
                collateralToken,
                collateralCToken,
                collateralHolder,
                collateralAmount,
                borrowToken,
                borrowCToken,
                borrowHolder,
                borrowAmount,
                borrowAmount,
                getBigNumberFrom(0), // initially user don't have any tokens on balance
              );

              console.log(`collateralAmount=${collateralAmount}`);
              console.log(`r`, r);
              const sret = [
                r.userBalancesBeforeBorrow.collateral, r.userBalancesBeforeBorrow.borrow
                , r.userBalancesAfterBorrow.collateral, r.userBalancesAfterBorrow.borrow
                , r.userBalancesAfterRepay.borrow

                // ... the difference is less than 1%
                , collateralAmount.sub(r.userBalancesAfterRepay.collateral)
                  .div(collateralAmount)
                  .mul(100).toNumber() < 1
                , r.userBalancesAfterRepay.borrow
              ].map(x => BalanceUtils.toString(x)).join("\n");

              const sexpected = [
                collateralAmount, 0
                , 0, borrowAmount
                , 0

                , true // the difference is less than 1%
                , 0
              ].map(x => BalanceUtils.toString(x)).join("\n");

              expect(sret).eq(sexpected);
            });
          });
        });
        describe("Full repay of borrowed amount", () => {
          describe("DAI => USDC", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;

              const initialBorrowAssetOnUserBalanceNum = 1;

              const collateralAsset = MaticAddresses.DAI;
              const collateralHolder = MaticAddresses.HOLDER_DAI;
              const collateralCTokenAddress = MaticAddresses.dForce_iDAI;

              const borrowAsset = MaticAddresses.USDC;
              const borrowCTokenAddress = MaticAddresses.dForce_iUSDC;
              const borrowHolder = MaticAddresses.HOLDER_USDC;

              const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
              const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);
              const collateralCToken = await TokenDataTypes.Build(deployer, collateralCTokenAddress);
              const borrowCToken = await TokenDataTypes.Build(deployer, borrowCTokenAddress);

              const collateralAmount = getBigNumberFrom(100_000, collateralToken.decimals);
              const borrowAmount = getBigNumberFrom(10, borrowToken.decimals);

              const initialBorrowAssetOnUserBalance = getBigNumberFrom(
                initialBorrowAssetOnUserBalanceNum,
                borrowToken.decimals
              );

              const r = await makeBorrowAndRepay(
                collateralToken,
                collateralCToken,
                collateralHolder,
                collateralAmount,
                borrowToken,
                borrowCToken,
                borrowHolder,
                borrowAmount,
                undefined, // full repay
                initialBorrowAssetOnUserBalance
              );

              console.log(`collateralAmount=${collateralAmount}`);
              console.log(`r`, r);
              const sret = [
                r.userBalancesBeforeBorrow.collateral, r.userBalancesBeforeBorrow.borrow,
                r.userBalancesAfterBorrow.collateral, r.userBalancesAfterBorrow.borrow,

                areAlmostEqual(
                  r.userBalancesAfterRepay.collateral,
                  r.userBalancesBeforeBorrow.collateral,
                  5
                ),
                r.userBalancesAfterRepay.borrow,

                // ... the difference is less than 1%
                collateralAmount.sub(r.userBalancesAfterRepay.collateral)
                  .div(collateralAmount)
                  .mul(100).toNumber() < 1,
              ].map(x => BalanceUtils.toString(x)).join("\n");

              const sexpected = [
                collateralAmount, initialBorrowAssetOnUserBalance,
                0, borrowAmount.add(initialBorrowAssetOnUserBalance),

                true,
                initialBorrowAssetOnUserBalance,

                true, // the difference is less than 1%
              ].map(x => BalanceUtils.toString(x)).join("\n");

              expect(sret).eq(sexpected);
            });
          });
        });
      });
    });
    describe("Bad paths", () => {
// TODO
    });

  });

  describe("repayToRebalance", () => {
    const minHealthFactorInitial2 = 500;
    const targetHealthFactorInitial2 = 1000;
    const maxHealthFactorInitial2 = 2000;
    const minHealthFactorUpdated2 = 1000+300; // we need small addon for bad paths
    const targetHealthFactorUpdated2 = 2000;
    const maxHealthFactorUpdated2 = 4000;

    interface IMakeRepayToRebalanceResults {
      afterBorrow: IDForceCalcAccountEquityResults;
      afterBorrowToRebalance: IDForceCalcAccountEquityResults;
      afterBorrowStatus: IPoolAdapterStatus;
      afterBorrowToRebalanceStatus: IPoolAdapterStatus;
      userBalanceAfterBorrow: BigNumber;
      userBalanceAfterRepayToRebalance: BigNumber;
      expectedAmountToRepay: BigNumber;
    }

    interface IMakeRepayRebalanceBadPathParams {
      makeRepayToRebalanceAsDeployer?: boolean;
      skipBorrow?: boolean;
      additionalAmountCorrectionFactorMul?: number;
      additionalAmountCorrectionFactorDiv?: number;
    }

    /**
     * Prepare DForce pool adapter.
     * Set low health factors.
     * Make borrow.
     * Increase health factor twice.
     * Make repay to rebalance.
     */
    async function makeRepayToRebalance (
      collateralToken: TokenDataTypes,
      collateralHolder: string,
      collateralCTokenAddress: string,
      collateralAmount: BigNumber,
      borrowToken: TokenDataTypes,
      borrowHolder: string,
      borrowCTokenAddress: string,
      badPathsParams?: IMakeRepayRebalanceBadPathParams
    ) : Promise<IMakeRepayToRebalanceResults>{
      const d = await prepareToBorrow(
        collateralToken,
        collateralHolder,
        collateralCTokenAddress,
        collateralAmount,
        borrowToken,
        borrowCTokenAddress,
        targetHealthFactorInitial2
      );
      const collateralAssetData = await DForceHelper.getCTokenData(
        deployer,
        d.comptroller,
        d.collateralCToken
      );
      console.log("collateralAssetData", collateralAssetData);
      const borrowAssetData = await DForceHelper.getCTokenData(
        deployer,
        d.comptroller,
        d.borrowCToken
      );
      console.log("borrowAssetData", borrowAssetData);

      // prices of assets in base currency
      const priceCollateral = await d.priceOracle.getUnderlyingPrice(d.collateralCToken.address);
      const priceBorrow = await d.priceOracle.getUnderlyingPrice(d.borrowCToken.address);
      console.log("prices", priceCollateral, priceBorrow);

      // setup low values for all health factors
      await d.controller.setMaxHealthFactor2(maxHealthFactorInitial2);
      await d.controller.setTargetHealthFactor2(targetHealthFactorInitial2);
      await d.controller.setMinHealthFactor2(minHealthFactorInitial2);

      // make borrow
      const amountToBorrow = d.amountToBorrow;

      if (! badPathsParams?.skipBorrow) {
        await d.dfPoolAdapterTC.syncBalance(true, true);
        await IERC20__factory.connect(collateralToken.address,
          await DeployerUtils.startImpersonate(d.userContract.address)
        ).transfer(d.dfPoolAdapterTC.address, collateralAmount);
        await d.dfPoolAdapterTC.borrow(
          collateralAmount,
          amountToBorrow,
          d.userContract.address // receiver
        );
      }

      const afterBorrow: IDForceCalcAccountEquityResults = await d.comptroller.calcAccountEquity(d.dfPoolAdapterTC.address);
      const userBalanceAfterBorrow = await borrowToken.token.balanceOf(d.userContract.address);
      const afterBorrowStatus = await d.dfPoolAdapterTC.getStatus();
      console.log("after borrow:", afterBorrow, userBalanceAfterBorrow);

      // increase all health factors down on 2 times to have possibility for additional borrow
      await d.controller.setMaxHealthFactor2(maxHealthFactorUpdated2);
      await d.controller.setTargetHealthFactor2(targetHealthFactorUpdated2);
      await d.controller.setMinHealthFactor2(minHealthFactorUpdated2);
      console.log("controller", d.controller.address);
      console.log("min", await d.controller.minHealthFactor2());
      console.log("target", await d.controller.targetHealthFactor2());

      let expectedAmountToRepay = amountToBorrow.div(2); // health factor was increased twice
      if (badPathsParams?.additionalAmountCorrectionFactorMul) {
        expectedAmountToRepay = expectedAmountToRepay.mul(badPathsParams.additionalAmountCorrectionFactorMul);
      }
      if (badPathsParams?.additionalAmountCorrectionFactorDiv) {
        expectedAmountToRepay = expectedAmountToRepay.div(badPathsParams.additionalAmountCorrectionFactorDiv);
      }
      if (badPathsParams) {
        // we try to repay too much in bad-paths-test, so we need to give additional borrow asset to user
        const userBorrowAssetBalance = await IERC20__factory.connect(borrowToken.address, deployer)
          .balanceOf(d.userContract.address);
        if (userBorrowAssetBalance.lt(expectedAmountToRepay)) {
          await IERC20__factory.connect(borrowToken.address,
            await DeployerUtils.startImpersonate(borrowHolder)
          ).transfer(d.userContract.address, expectedAmountToRepay.sub(userBorrowAssetBalance));
        }
      }
      console.log("expectedAmountToRepay", expectedAmountToRepay);

      // make repayment to rebalance
      const poolAdapterSigner = badPathsParams?.makeRepayToRebalanceAsDeployer
        ? IPoolAdapter__factory.connect(d.dfPoolAdapterTC.address, deployer)
        : d.dfPoolAdapterTC;
      await poolAdapterSigner.syncBalance(false, true);
      await IERC20__factory.connect(
        borrowToken.address,
        await DeployerUtils.startImpersonate(d.userContract.address)
      ).transfer(
        poolAdapterSigner.address,
        expectedAmountToRepay
      );

      await poolAdapterSigner.repayToRebalance(expectedAmountToRepay);

      const afterBorrowToRebalance: IDForceCalcAccountEquityResults = await d.comptroller.calcAccountEquity(d.dfPoolAdapterTC.address);
      const userBalanceAfterRepayToRebalance = await borrowToken.token.balanceOf(d.userContract.address);
      const afterBorrowToRebalanceStatus = await d.dfPoolAdapterTC.getStatus();
      console.log("after repay to rebalance:", afterBorrowToRebalance, userBalanceAfterRepayToRebalance);

      return {
        afterBorrow,
        afterBorrowToRebalance,
        userBalanceAfterBorrow,
        userBalanceAfterRepayToRebalance,
        expectedAmountToRepay,
        afterBorrowStatus,
        afterBorrowToRebalanceStatus
      }
    }

    async function daiWMatic(
      badPathParams?: IMakeRepayRebalanceBadPathParams
  ) : Promise<{ret: string, expected: string}> {
      const collateralAsset = MaticAddresses.DAI;
      const collateralHolder = MaticAddresses.HOLDER_DAI;
      const collateralCToken = MaticAddresses.dForce_iDAI;

      const borrowAsset = MaticAddresses.WMATIC;
      const borrowHolder = MaticAddresses.HOLDER_WMATIC;
      const borrowCToken = MaticAddresses.dForce_iMATIC;

      const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
      const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);
      console.log("collateralToken.decimals", collateralToken.decimals);
      console.log("borrowToken.decimals", borrowToken.decimals);

      const collateralAmount = getBigNumberFrom(100_000, collateralToken.decimals);
      console.log(collateralAmount, collateralAmount);

      const r = await makeRepayToRebalance(
        collateralToken,
        collateralHolder,
        collateralCToken,
        collateralAmount,
        borrowToken,
        borrowHolder,
        borrowCToken,
        badPathParams
      );

      console.log(r);

      const ret = [
        Math.round(r.afterBorrowStatus.healthFactor18.div(getBigNumberFrom(1, 15)).toNumber() / 10.),
        Math.round(r.afterBorrowToRebalanceStatus.healthFactor18.div(getBigNumberFrom(1, 15)).toNumber() / 10.),
        toStringWithRound(r.userBalanceAfterBorrow),
        toStringWithRound(r.userBalanceAfterRepayToRebalance),
      ].join("\n");
      const expected = [
        targetHealthFactorInitial2,
        targetHealthFactorUpdated2,
        toStringWithRound(r.expectedAmountToRepay.mul(2)),
        toStringWithRound(r.expectedAmountToRepay),
      ].join("\n");

      return {ret, expected};
    }

    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        const r = await daiWMatic();

        expect(r.ret).eq(r.expected);
      });
    });

    describe("Bad paths", () => {
      describe("Not TetuConverter and not user", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            daiWMatic({makeRepayToRebalanceAsDeployer: true})
          ).revertedWith("TC-32");
        });
      });
      describe("Position is not registered", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            daiWMatic({skipBorrow: true})
          ).revertedWith("TC-40"); // REPAY_TO_REBALANCE_NOT_ALLOWED
        });
      });
      describe("Result health factor is less min allowed one", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            daiWMatic({additionalAmountCorrectionFactorDiv: 100})
          ).revertedWith("TC-3: wrong health factor");
        });
      });
      describe("Try to repay amount greater then the debt", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            daiWMatic({additionalAmountCorrectionFactorMul: 100})
          ).revertedWith("TC-40"); // REPAY_TO_REBALANCE_NOT_ALLOWED
        });
      });
    });
  });

  describe("TODO:syncBalance", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        expect.fail("TODO");
      });
    });
    describe("Bad paths", () => {
      describe("", () => {
        it("should revert", async () => {
          expect.fail("TODO");
        });
      });
    });
  });

  describe("TODO:updateBalance", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        expect.fail("TODO");
      });
    });
    describe("Bad paths", () => {
      describe("", () => {
        it("should revert", async () => {
          expect.fail("TODO");
        });
      });
    });
  });

  describe("TODO:initialize", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        expect.fail("TODO");
      });
    });
    describe("Bad paths", () => {
      describe("", () => {
        it("should revert", async () => {
          expect.fail("TODO");
        });
      });
    });
  });

  describe("TODO:hasRewards", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        expect.fail("TODO");
      });
    });
    describe("Bad paths", () => {
      describe("", () => {
        it("should revert", async () => {
          expect.fail("TODO");
        });
      });
    });
  });

  describe("TODO:claimRewards", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        expect.fail("TODO");
      });
    });
    describe("Bad paths", () => {
      describe("", () => {
        it("should revert", async () => {
          expect.fail("TODO");
        });
      });
    });
  });

  describe("TODO:getConversionKind", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        expect.fail("TODO");
      });
    });
    describe("Bad paths", () => {
      describe("", () => {
        it("should revert", async () => {
          expect.fail("TODO");
        });
      });
    });
  });

  describe("TODO:getConfig", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        expect.fail("TODO");
      });
    });
    describe("Bad paths", () => {
      describe("", () => {
        it("should revert", async () => {
          expect.fail("TODO");
        });
      });
    });
  });

  describe("TODO:getStatus", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        expect.fail("TODO");
      });
    });
    describe("Bad paths", () => {
      describe("", () => {
        it("should revert", async () => {
          expect.fail("TODO");
        });
      });
    });
  });

  describe("TODO:getAPR18", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        expect.fail("TODO");
      });
    });
    describe("Bad paths", () => {
      describe("", () => {
        it("should revert", async () => {
          expect.fail("TODO");
        });
      });
    });
  });
//endregion Unit tests

});