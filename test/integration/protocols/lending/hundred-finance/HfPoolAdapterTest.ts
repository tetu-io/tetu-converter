import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../../scripts/utils/TimeUtils";
import {
  Controller, HfPlatformAdapter, HfPoolAdapter,
  IERC20Extended__factory, IHfComptroller, IHfCToken__factory, IHfPriceOracle, IPoolAdapter__factory
} from "../../../../../typechain";
import {expect} from "chai";
import {BigNumber, Wallet} from "ethers";
import {getBigNumberFrom} from "../../../../../scripts/utils/NumberUtils";
import {DeployerUtils} from "../../../../../scripts/utils/DeployerUtils";
import {AdaptersHelper} from "../../../../baseUT/helpers/AdaptersHelper";
import {isPolygonForkInUse} from "../../../../baseUT/utils/NetworkUtils";
import {BalanceUtils, IUserBalances} from "../../../../baseUT/utils/BalanceUtils";
import {CoreContractsHelper} from "../../../../baseUT/helpers/CoreContractsHelper";
import {HundredFinanceHelper, IHundredFinanceMarketData} from "../../../../../scripts/integration/helpers/HundredFinanceHelper";
import {MaticAddresses} from "../../../../../scripts/addresses/MaticAddresses";
import {MocksHelper} from "../../../../baseUT/helpers/MocksHelper";
import {TokenDataTypes} from "../../../../baseUT/types/TokenDataTypes";
import {Misc} from "../../../../../scripts/utils/Misc";
import {CompareAprUsesCase} from "../../../../baseUT/uses-cases/CompareAprUsesCase";
import {IHfAccountLiquidity} from "../../../../baseUT/apr/aprHundredFinance";

describe("Hundred Finance integration tests, pool adapter", () => {

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
    user: Wallet;
    hfPoolAdapterTC: HfPoolAdapter;
    hfPlatformAdapter: HfPlatformAdapter;
    priceOracle: IHfPriceOracle;
    comptroller: IHfComptroller;

    controller: Controller;

    amountToBorrow: BigNumber;
  }

  interface IMarketsInfo {
    borrowData: IHundredFinanceMarketData;
    collateralData: IHundredFinanceMarketData;

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
    collateralAmount: BigNumber,
    borrowToken: TokenDataTypes,
    borrowCTokenAddress: string,
    targetHealthFactor2?: number
  ) : Promise<IPrepareToBorrowResults> {
    const user = ethers.Wallet.createRandom();
    const tetuConveterStab = ethers.Wallet.createRandom();

    // controller, dm, bm
    const controller = await CoreContractsHelper.createController(deployer);
    const debtMonitor = await CoreContractsHelper.createDebtMonitor(deployer, controller);
    const borrowManager = await MocksHelper.createBorrowManagerStub(deployer, true);
    await controller.setBorrowManager(borrowManager.address);
    await controller.setDebtMonitor(debtMonitor.address);
    await controller.setTetuConverter(tetuConveterStab.address);

    // initialize adapters and price oracle
    const hfPoolAdapterTC = await AdaptersHelper.createHundredFinancePoolAdapter(
      await DeployerUtils.startImpersonate(tetuConveterStab.address)
    );
    const comptroller = await HundredFinanceHelper.getComptroller(deployer);
    const hfPlatformAdapter = await AdaptersHelper.createHundredFinancePlatformAdapter(
      deployer,
      controller.address,
      comptroller.address,
      hfPoolAdapterTC.address,
      [collateralCTokenAddress, borrowCTokenAddress],
      MaticAddresses.HUNDRED_FINANCE_PRICE_ORACLE
    )
    const priceOracle = HundredFinanceHelper.getPriceOracle(deployer);

    // collateral asset
    await collateralToken.token
      .connect(await DeployerUtils.startImpersonate(collateralHolder))
      .transfer(deployer.address, collateralAmount);

    // initialize pool adapter
    await hfPoolAdapterTC.initialize(
      controller.address,
      hfPlatformAdapter.address,
      comptroller.address,
      user.address,
      collateralToken.address,
      borrowToken.address,
      hfPoolAdapterTC.address
    );

    // prepare to borrow
    await hfPoolAdapterTC.syncBalance(true);
    await collateralToken.token.transfer(hfPoolAdapterTC.address, collateralAmount);

    // calculate max allowed amount to borrow
    const countBlocks = 1;
    const borrowAmountFactor18 = CompareAprUsesCase.getBorrowAmountFactor18(
      collateralAmount,
      targetHealthFactor2 || await controller.targetHealthFactor2(),
      collateralToken.decimals
    );

    const plan = await hfPlatformAdapter.getConversionPlan(
      collateralToken.address,
      collateralAmount,
      borrowToken.address,
      borrowAmountFactor18,
      countBlocks
    );
    console.log("plan", plan);

    return {
      controller,
      user,
      amountToBorrow: plan.amountToBorrow,
      comptroller,
      hfPlatformAdapter,
      hfPoolAdapterTC,
      priceOracle
    }
  }

  async function getMarketsInfo(
    d: IPrepareToBorrowResults,
    collateralCTokenAddress: string,
    borrowCTokenAddress: string
  ) : Promise<IMarketsInfo> {
    // tokens data
    const borrowData = await HundredFinanceHelper.getCTokenData(deployer, d.comptroller
      , IHfCToken__factory.connect(borrowCTokenAddress, deployer)
    );
    const collateralData = await HundredFinanceHelper.getCTokenData(deployer, d.comptroller
      , IHfCToken__factory.connect(collateralCTokenAddress, deployer)
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
    collateralData: IHundredFinanceMarketData,
    priceCollateral: BigNumber,
    priceBorrow: BigNumber,
    cTokenBalance: BigNumber,
    bBorrowBalance: BigNumber
  ): BigNumber {

    const cf1 = collateralData.collateralFactorMantissa;
    const er1 = collateralData.exchangeRateStored;
    const pr1 = priceCollateral;
    const sc1 = cTokenBalance.mul(cf1).mul(er1).div(Misc.WEI).mul(pr1).div(Misc.WEI).div(Misc.WEI);
    const sb1 = priceBorrow.mul(bBorrowBalance).div(Misc.WEI);
    const expectedLiquiditiy = sc1.sub(sb1);
    console.log(`cf1=${cf1} er1=${er1} pr1=${pr1} sc1=${sc1} sb1=${sb1} L1=${expectedLiquiditiy}`);
    console.log("health factor", ethers.utils.formatUnits(sc1.mul(Misc.WEI).div(sb1)));
    return expectedLiquiditiy;
  }
//endregion Test impl

//region Unit tests
  describe("borrow", () => {
    async function makeTest(
      collateralToken: TokenDataTypes,
      collateralCToken: TokenDataTypes,
      collateralHolder: string,
      collateralAmount: BigNumber,
      borrowToken: TokenDataTypes,
      borrowCToken: TokenDataTypes,
      borrowAmount: BigNumber
    ) : Promise<{sret: string, sexpected: string}>{
      const d = await prepareToBorrow(
        collateralToken,
        collateralHolder,
        collateralCToken.address,
        collateralAmount,
        borrowToken,
        borrowCToken.address
      );

      await d.hfPoolAdapterTC.borrow(
        collateralAmount,
        borrowAmount,
        d.user.address
      );
      console.log(`borrow: success`);

      const info = await getMarketsInfo(d, collateralCToken.address, borrowCToken.address);

      // check results
      const {error, liquidity, shortfall} = await d.comptroller.getAccountLiquidity(d.hfPoolAdapterTC.address);
      const sb = await IHfCToken__factory.connect(borrowCToken.address, deployer)
        .getAccountSnapshot(d.hfPoolAdapterTC.address);
      console.log(`Borrow token: balance=${sb.borrowBalance} tokenBalance=${sb.tokenBalance} exchangeRate=${sb.exchangeRateMantissa}`);
      const sc = await IHfCToken__factory.connect(collateralCToken.address, deployer)
        .getAccountSnapshot(d.hfPoolAdapterTC.address);
      console.log(`Collateral token: balance=${sc.borrowBalance} tokenBalance=${sc.tokenBalance} exchangeRate=${sc.exchangeRateMantissa}`);

      const retBalanceBorrowUser = await borrowToken.token.balanceOf(d.user.address);
      const retBalanceCollateralTokensPoolAdapter = await IERC20Extended__factory.connect(
        collateralCToken.address, deployer
      ).balanceOf(d.hfPoolAdapterTC.address);

      const sret = [
        error,
        retBalanceBorrowUser,
        retBalanceCollateralTokensPoolAdapter,
        liquidity,
        shortfall,
      ].map(x => BalanceUtils.toString(x)).join("\n");

      const expectedLiquidity = getExpectedLiquidity(
        info.collateralData,
        info.priceCollateral,
        info.priceBorrow,
        sc.tokenBalance,
        sb.borrowBalance
      )
      const sexpected = [
        0,
        borrowAmount, // borrowed amount on user's balance
        collateralAmount
          .mul(Misc.WEI)
          .div(info.collateralData.exchangeRateStored),
        expectedLiquidity,
        0,
      ].map(x => BalanceUtils.toString(x)).join("\n");

      return {sret, sexpected};
    }

    describe("Good paths", () => {
      describe("Borrow modest amount", () => {
        describe("DAI-18 : usdc-6", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;

            const collateralAsset = MaticAddresses.DAI;
            const collateralHolder = MaticAddresses.HOLDER_DAI;
            const collateralCTokenAddress = MaticAddresses.hDAI;

            const borrowAsset = MaticAddresses.USDC;
            const borrowCTokenAddress = MaticAddresses.hUSDC;

            const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
            const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);
            const collateralCToken = await TokenDataTypes.Build(deployer, collateralCTokenAddress);
            const borrowCToken = await TokenDataTypes.Build(deployer, borrowCTokenAddress);

            const collateralAmount = getBigNumberFrom(100_000, collateralToken.decimals);
            const borrowAmount = getBigNumberFrom(10, borrowToken.decimals);

            const r = await makeTest(
              collateralToken
              , collateralCToken
              , collateralHolder
              , collateralAmount
              , borrowToken
              , borrowCToken
              , borrowAmount
            );
            expect(r.sret).eq(r.sexpected);
          });
        });
      });
      describe("Borrow extremely huge amount", () => {
        describe("DAI : matic", () => {
          it("should return expected values", async () => {
            expect.fail("TODO");                    });
        });
        describe("", () => {
          it("should return expected values", async () => {
            it("", async () => {
              expect.fail("TODO");
            });
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

    interface IMakeTestBorrowToRebalanceResults {
      afterBorrow: IHfAccountLiquidity;
      afterBorrowHealthFactor18: BigNumber;
      afterBorrowToRebalance: IHfAccountLiquidity;
      afterBorrowToRebalanceHealthFactor18: BigNumber;
      userBalanceAfterBorrow: BigNumber;
      userBalanceAfterBorrowToRebalance: BigNumber;
      expectedAdditionalBorrowAmount: BigNumber;
    }
    interface IMakeTestBorrowToRebalanceBadPathParams {
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
    async function makeTestBorrowToRebalance (
      collateralToken: TokenDataTypes,
      collateralHolder: string,
      collateralCTokenAddress: string,
      collateralAmount: BigNumber,
      borrowToken: TokenDataTypes,
      borrowCTokenAddress: string,
      borrowHolder: string,
      badPathsParams?: IMakeTestBorrowToRebalanceBadPathParams
    ) : Promise<IMakeTestBorrowToRebalanceResults>{
      const d = await prepareToBorrow(
        collateralToken,
        collateralHolder,
        collateralCTokenAddress,
        collateralAmount,
        borrowToken,
        borrowCTokenAddress,
        targetHealthFactorInitial2
      );

      const info = await getMarketsInfo(d, collateralCTokenAddress, borrowCTokenAddress);

      // setup high values for all health factors
      await d.controller.setMaxHealthFactor2(maxHealthFactorInitial2);
      await d.controller.setTargetHealthFactor2(targetHealthFactorInitial2);
      await d.controller.setMinHealthFactor2(minHealthFactorInitial2);

      // make borrow
      const amountToBorrow = d.amountToBorrow;
      if (! badPathsParams?.skipBorrow) {
        await d.hfPoolAdapterTC.borrow(
          collateralAmount,
          amountToBorrow,
          d.user.address // receiver
        );
      }
      const afterBorrow = await d.comptroller.getAccountLiquidity(d.hfPoolAdapterTC.address);
      const statusAfterBorrow = await d.hfPoolAdapterTC.getStatus();
      const userBalanceAfterBorrow = await borrowToken.token.balanceOf(d.user.address);
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
        ? IPoolAdapter__factory.connect(d.hfPoolAdapterTC.address, deployer)
        : d.hfPoolAdapterTC;
      await poolAdapterSigner.syncBalance(true);
      await poolAdapterSigner.borrowToRebalance(
        expectedAdditionalBorrowAmount,
        d.user.address // receiver
      );

      const afterBorrowToRebalance = await d.comptroller.getAccountLiquidity(d.hfPoolAdapterTC.address);
      const statusAfterBorrowToRebalance = await d.hfPoolAdapterTC.getStatus();
      const userBalanceAfterBorrowToRebalance = await borrowToken.token.balanceOf(d.user.address);
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
      badPathParams?: IMakeTestBorrowToRebalanceBadPathParams
    ) : Promise<IMakeTestBorrowToRebalanceResults> {
      const collateralAsset = MaticAddresses.DAI;
      const collateralHolder = MaticAddresses.HOLDER_DAI;
      const collateralCTokenAddress = MaticAddresses.hDAI;

      const borrowAsset = MaticAddresses.USDC;
      const borrowCTokenAddress = MaticAddresses.hUSDC;
      const borrowHolder = MaticAddresses.HOLDER_USDC;

      const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
      const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);
      console.log("collateralToken.decimals", collateralToken.decimals);
      console.log("borrowToken.decimals", borrowToken.decimals);

      const collateralAmount = getBigNumberFrom(100_000, collateralToken.decimals);
      console.log(collateralAmount, collateralAmount);

      const r = await makeTestBorrowToRebalance(
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
          ethers.utils.formatUnits(r.userBalanceAfterBorrow, 18),
          ethers.utils.formatUnits(r.userBalanceAfterBorrowToRebalance, 18),
        ].join();
        const expected = [
          targetHealthFactorInitial2,
          targetHealthFactorUpdated2,
          ethers.utils.formatUnits(r.expectedAdditionalBorrowAmount, 18),
          ethers.utils.formatUnits(r.expectedAdditionalBorrowAmount.mul(2), 18),
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
    async function makeTest(
      collateralToken: TokenDataTypes,
      collateralCToken: TokenDataTypes,
      collateralHolder: string,
      collateralAmount: BigNumber,
      borrowToken: TokenDataTypes,
      borrowCToken: TokenDataTypes,
      borrowHolder: string,
      borrowAmount: BigNumber,
      initialBorrowAmountOnUserBalance: BigNumber,
      amountToRepay: BigNumber,
      closePosition: boolean
    ) : Promise<{
      userBalancesBeforeBorrow: IUserBalances,
      userBalancesAfterBorrow: IUserBalances,
      userBalancesAfterRepay: IUserBalances,
      paCTokensBalance: BigNumber,
      totalCollateralBase: BigNumber,
      totalDebtBase: BigNumber
    }>{
      const user = ethers.Wallet.createRandom();
      const tetuConveterStab = ethers.Wallet.createRandom();

      // controller, dm, bm
      const controller = await CoreContractsHelper.createController(deployer);
      const debtMonitor = await CoreContractsHelper.createDebtMonitor(deployer, controller);
      const borrowManager = await MocksHelper.createBorrowManagerStub(deployer, true);
      await controller.setBorrowManager(borrowManager.address);
      await controller.setDebtMonitor(debtMonitor.address);
      await controller.setTetuConverter(tetuConveterStab.address);

      // initialize adapters and price oracle
      const hfPoolAdapterTC = await AdaptersHelper.createHundredFinancePoolAdapter(
        await DeployerUtils.startImpersonate(tetuConveterStab.address)
      );
      const comptroller = await HundredFinanceHelper.getComptroller(deployer);
      const hfPlatformAdapter = await AdaptersHelper.createHundredFinancePlatformAdapter(
        deployer,
        controller.address,
        comptroller.address,
        hfPoolAdapterTC.address,
        [collateralCToken.address, borrowCToken.address],
        MaticAddresses.HUNDRED_FINANCE_PRICE_ORACLE
      )

      // collateral asset
      await collateralToken.token
        .connect(await DeployerUtils.startImpersonate(collateralHolder))
        .transfer(user.address, collateralAmount);

      // initialize pool adapter
      await hfPoolAdapterTC.initialize(
        controller.address,
        hfPlatformAdapter.address,
        comptroller.address,
        user.address,
        collateralToken.address,
        borrowToken.address,
        hfPoolAdapterTC.address
      );

      const beforeBorrow: IUserBalances = {
        collateral: await collateralToken.token.balanceOf(user.address),
        borrow: await borrowToken.token.balanceOf(user.address)
      };

      // make borrow
      await hfPoolAdapterTC.syncBalance(true);
      await IERC20Extended__factory.connect(collateralToken.address
        , await DeployerUtils.startImpersonate(user.address)
      ).transfer(hfPoolAdapterTC.address, collateralAmount);

      await hfPoolAdapterTC.borrow(
        collateralAmount,
        borrowAmount,
        user.address
      );

      const afterBorrow: IUserBalances = {
        collateral: await collateralToken.token.balanceOf(user.address),
        borrow: await borrowToken.token.balanceOf(user.address)
      };
      console.log(afterBorrow);

      // make repay
      await hfPoolAdapterTC.syncBalance(false);
      await IERC20Extended__factory.connect(borrowToken.address
        , await DeployerUtils.startImpersonate(user.address)
      ).transfer(hfPoolAdapterTC.address, amountToRepay);
      console.log("amountToRepay", amountToRepay);

      await hfPoolAdapterTC.repay(
        amountToRepay,
        user.address,
        closePosition
      );
      console.log("repay is done");

      // check results
      const afterRepay: IUserBalances = {
        collateral: await collateralToken.token.balanceOf(user.address),
        borrow: await borrowToken.token.balanceOf(user.address)
      };
      const cTokenCollateral = await IHfCToken__factory.connect(collateralCToken.address, deployer);
      const cTokenBorrow = await IHfCToken__factory.connect(borrowCToken.address, deployer);

      const retCollateral = await cTokenCollateral.getAccountSnapshot(hfPoolAdapterTC.address);
      const retBorrow = await cTokenBorrow.getAccountSnapshot(hfPoolAdapterTC.address);

      return {
        userBalancesBeforeBorrow: beforeBorrow,
        userBalancesAfterBorrow: afterBorrow,
        userBalancesAfterRepay: afterRepay,
        paCTokensBalance: await cTokenCollateral.balanceOf(hfPoolAdapterTC.address),
        totalCollateralBase: retCollateral.tokenBalance,
        totalDebtBase: retBorrow.borrowBalance
      }
    }
    describe("Good paths", () =>{
      describe("Borrow and repay modest amount", () =>{
        describe("Repay borrow amount without interest", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;

            const collateralAsset = MaticAddresses.DAI;
            const collateralHolder = MaticAddresses.HOLDER_DAI;
            const collateralCTokenAddress = MaticAddresses.hDAI;

            const borrowAsset = MaticAddresses.USDC;
            const borrowCTokenAddress = MaticAddresses.hUSDC;
            const borrowHolder = MaticAddresses.HOLDER_USDC;

            const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
            const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);
            const collateralCToken = await TokenDataTypes.Build(deployer, collateralCTokenAddress);
            const borrowCToken = await TokenDataTypes.Build(deployer, borrowCTokenAddress);

            const collateralAmount = getBigNumberFrom(100_000, collateralToken.decimals);
            const borrowAmount = getBigNumberFrom(10, borrowToken.decimals);

            const r = await makeTest(
              collateralToken
              , collateralCToken
              , collateralHolder
              , collateralAmount
              , borrowToken
              , borrowCToken
              , borrowHolder
              , borrowAmount
              , getBigNumberFrom(0) // initially user don't have any tokens on balance
              , borrowAmount
              , false
            );

            console.log(`collateralAmount=${collateralAmount}`);
            console.log(`r.userBalancesAfterRepay.collateral=${r.userBalancesAfterRepay.collateral}`);
            const sret = [
              r.userBalancesBeforeBorrow.collateral, r.userBalancesBeforeBorrow.borrow
              , r.userBalancesAfterBorrow.collateral, r.userBalancesAfterBorrow.borrow
              ,                                       r.userBalancesAfterRepay.borrow
              , r.paCTokensBalance
              , r.totalCollateralBase
              , r.totalDebtBase

              // returned collateral > original collateral ...
              , r.userBalancesAfterRepay.collateral.gt(collateralAmount)
              // ... the difference is less than 1%
              , collateralAmount.sub(r.userBalancesAfterRepay.collateral)
                .div(collateralAmount)
                .mul(100).toNumber() < 1
              , r.userBalancesAfterRepay.borrow
            ].map(x => BalanceUtils.toString(x)).join();

            const sexpected = [
              collateralAmount, 0
              , 0, borrowAmount
              ,                 0
              , 0
              , 0
              , 0

              , true // original collateral > returned collateral ...
              , true // the difference is less than 1%
              , 0
            ].map(x => BalanceUtils.toString(x)).join();

            expect(sret).eq(sexpected);
          });
        });
      });
    });
    describe("Bad paths", () =>{

    });

  });

//endregion Unit tests

});