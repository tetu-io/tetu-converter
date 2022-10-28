import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {
  Borrower,
  BorrowManager__factory,
  Controller,
  HfPlatformAdapter,
  HfPoolAdapter,
  HfPoolAdapter__factory, IERC20__factory,
  IERC20Extended__factory,
  IHfComptroller, IHfCToken,
  IHfCToken__factory,
  IHfPriceOracle,
  IPoolAdapter__factory
} from "../../../typechain";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {AdaptersHelper} from "../../baseUT/helpers/AdaptersHelper";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";
import {BalanceUtils, IUserBalances} from "../../baseUT/utils/BalanceUtils";
import {CoreContractsHelper} from "../../baseUT/helpers/CoreContractsHelper";
import {HundredFinanceHelper, IHundredFinanceMarketData} from "../../../scripts/integration/helpers/HundredFinanceHelper";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {MocksHelper} from "../../baseUT/helpers/MocksHelper";
import {TokenDataTypes} from "../../baseUT/types/TokenDataTypes";
import {Misc} from "../../../scripts/utils/Misc";
import {IHfAccountLiquidity} from "../../baseUT/apr/aprHundredFinance";
import {areAlmostEqual, toStringWithRound} from "../../baseUT/utils/CommonUtils";
import {IPoolAdapterStatus} from "../../baseUT/types/BorrowRepayDataTypes";
import {
  IAssetsInputParamsWithCTokens,
  IMakeRepayRebalanceBadPathParams,
  IMakeRepayToRebalanceInputParamsWithCTokens
} from "../../baseUT/protocols/shared/sharedDataTypes";
import {SharedRepayToRebalanceUtils} from "../../baseUT/protocols/shared/sharedRepayToRebalanceUtils";

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
    userContract: Borrower;
    hfPoolAdapterTC: HfPoolAdapter;
    hfPlatformAdapter: HfPlatformAdapter;
    priceOracle: IHfPriceOracle;
    comptroller: IHfComptroller;

    controller: Controller;

    /** Amount that can be borrowed according to the conversion plan */
    amountToBorrow: BigNumber;
    /** Actual amount that was used as collateral */
    collateralAmount: BigNumber;

    collateralCToken: IHfCToken;
    borrowCToken: IHfCToken;
  }

  interface IMarketsInfo {
    borrowData: IHundredFinanceMarketData;
    collateralData: IHundredFinanceMarketData;

    priceCollateral: BigNumber;
    priceBorrow: BigNumber;
  }
  /**
   * Initialize TetuConverter app and HundredFinance pool adapter.
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

    const converter = await AdaptersHelper.createHundredFinancePoolAdapter(deployer);

    const comptroller = await HundredFinanceHelper.getComptroller(deployer);
    const priceOracle = HundredFinanceHelper.getPriceOracle(deployer);

    const hfPlatformAdapter = await AdaptersHelper.createHundredFinancePlatformAdapter(
      deployer,
      controller.address,
      comptroller.address,
      converter.address,
      [collateralCTokenAddress, borrowCTokenAddress],
      MaticAddresses.HUNDRED_FINANCE_PRICE_ORACLE
    )

    await borrowManager.addAssetPairs(
      hfPlatformAdapter.address,
      [collateralToken.address],
      [borrowToken.address]
    );
    const bmAsTc = BorrowManager__factory.connect(
      borrowManager.address,
      await DeployerUtils.startImpersonate(tetuConverter.address)
    );
    await bmAsTc.registerPoolAdapter(
      converter.address,
      userContract.address,
      collateralToken.address,
      borrowToken.address
    );
    const hfPoolAdapterTC = HfPoolAdapter__factory.connect(
      await borrowManager.getPoolAdapter(
        converter.address,
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

    await collateralToken.token
      .connect(await DeployerUtils.startImpersonate(collateralHolder))
      .transfer(userContract.address, collateralAmount);

    // calculate max allowed amount to borrow
    const countBlocks = 1;
    const plan = await hfPlatformAdapter.getConversionPlan(
      collateralToken.address,
      collateralAmount,
      borrowToken.address,
      targetHealthFactor2 || await controller.targetHealthFactor2(),
      countBlocks
    );
    console.log("plan", plan);

    return {
      controller,
      userContract,
      amountToBorrow: plan.amountToBorrow,
      comptroller,
      hfPlatformAdapter,
      hfPoolAdapterTC,
      priceOracle,
      collateralAmount,
      collateralCToken: IHfCToken__factory.connect(collateralCTokenAddress, deployer),
      borrowCToken: IHfCToken__factory.connect(borrowCTokenAddress, deployer)
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

      await d.hfPoolAdapterTC.syncBalance(true, true);
      await IERC20__factory.connect(collateralToken.address,
        await DeployerUtils.startImpersonate(d.userContract.address)
      ).transfer(d.hfPoolAdapterTC.address, d.collateralAmount);
      await d.hfPoolAdapterTC.borrow(
        d.collateralAmount,
        borrowAmount,
        d.userContract.address
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

      const retBalanceBorrowUser = await borrowToken.token.balanceOf(d.userContract.address);
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
        const collateralCTokenAddress = MaticAddresses.hDAI;

        const borrowAsset = MaticAddresses.USDC;
        const borrowCTokenAddress = MaticAddresses.hUSDC;

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
        const collateralCTokenAddress = MaticAddresses.hMATIC;

        const borrowAsset = MaticAddresses.WETH;
        const borrowCTokenAddress = MaticAddresses.hETH;

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
          if (!await isPolygonForkInUse()) return;
          expect.fail("TODO");
        });
      });
      describe("Not usable as collateral", () => {
        it("", async () =>{
          if (!await isPolygonForkInUse()) return;
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

      // const info = await getMarketsInfo(d, collateralCTokenAddress, borrowCTokenAddress);

      // setup high values for all health factors
      await d.controller.setMaxHealthFactor2(maxHealthFactorInitial2);
      await d.controller.setTargetHealthFactor2(targetHealthFactorInitial2);
      await d.controller.setMinHealthFactor2(minHealthFactorInitial2);

      // make borrow
      const amountToBorrow = d.amountToBorrow;
      if (! badPathsParams?.skipBorrow) {
        await d.hfPoolAdapterTC.syncBalance(true, true);
        await IERC20__factory.connect(collateralToken.address,
          await DeployerUtils.startImpersonate(d.userContract.address)
        ).transfer(d.hfPoolAdapterTC.address, d.collateralAmount);

        await d.hfPoolAdapterTC.borrow(
          collateralAmount,
          amountToBorrow,
          d.userContract.address // receiver
        );
      }
      const afterBorrow = await d.comptroller.getAccountLiquidity(d.hfPoolAdapterTC.address);
      const statusAfterBorrow = await d.hfPoolAdapterTC.getStatus();
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
        ? IPoolAdapter__factory.connect(d.hfPoolAdapterTC.address, deployer)
        : d.hfPoolAdapterTC;
      await poolAdapterSigner.syncBalance(true, true);
      await poolAdapterSigner.borrowToRebalance(
        expectedAdditionalBorrowAmount,
        d.userContract.address // receiver
      );

      const afterBorrowToRebalance = await d.comptroller.getAccountLiquidity(d.hfPoolAdapterTC.address);
      const statusAfterBorrowToRebalance = await d.hfPoolAdapterTC.getStatus();
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
          ).revertedWith("TC-40"); // REPAY_TO_REBALANCE_NOT_ALLOWED
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
      /* Actually borrowed amount */
      borrowAmount: BigNumber;
      /* Actual collateral amount*/
      collateralAmount: BigNumber;
    }

    interface IBorrowAndRepayBadParams {
      /**
       * Try to make repay without borrowing
       */
      skipBorrow?: boolean;

      /**
       * What amount of borrow asset should be transferred to pool adapter's balance
       * before calling of repay().
       * We can emulate following problems:
       *    Try to transfer an amount LARGER than amount-to-pay - should revert
       *    Try to transfer an amount less than amount-to-pay - should revert
       */
      wrongAmountToRepayToTransfer?: BigNumber;

      forceToClosePosition?: boolean;

      repayAsNotUserAndNotTC?: boolean;
    }

    interface IAssetInfo {
      asset: string;
      holder: string;
      cToken: string;
    }

    async function makeBorrowAndRepay(
      collateralToken: TokenDataTypes,
      collateralCToken: TokenDataTypes,
      collateralHolder: string,
      collateralAmountRequired: BigNumber | undefined,
      borrowToken: TokenDataTypes,
      borrowCToken: TokenDataTypes,
      borrowHolder: string,
      borrowAmountRequired: BigNumber | undefined,
      amountToRepay?: BigNumber,
      initialBorrowAmountOnUserBalance?: BigNumber,
      badParams?: IBorrowAndRepayBadParams
    ) : Promise<IBorrowAndRepayResults>{
      const d = await prepareToBorrow(collateralToken,
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
      if (! badParams?.skipBorrow) {
        await d.hfPoolAdapterTC.syncBalance(true, true);
        await IERC20Extended__factory.connect(collateralToken.address
          , await DeployerUtils.startImpersonate(d.userContract.address)
        ).transfer(d.hfPoolAdapterTC.address, d.collateralAmount);
        await d.hfPoolAdapterTC.borrow(
          d.collateralAmount,
          borrowAmount,
          d.userContract.address
        );
      }

      const statusAfterBorrow = await d.hfPoolAdapterTC.getStatus();
      const afterBorrow: IUserBalances = {
        collateral: await collateralToken.token.balanceOf(d.userContract.address),
        borrow: await borrowToken.token.balanceOf(d.userContract.address)
      };
      console.log(afterBorrow, statusAfterBorrow);

      await TimeUtils.advanceNBlocks(1000);

      // make repay
      const borrowTokenAsUser = IERC20Extended__factory.connect(
        borrowToken.address,
        await DeployerUtils.startImpersonate(d.userContract.address)
      );
      if (amountToRepay) {
        const poolAdapter = badParams?.repayAsNotUserAndNotTC
          ? IPoolAdapter__factory.connect(
            d.hfPoolAdapterTC.address,
            deployer // not TC, not user
          )
          : d.hfPoolAdapterTC;

        // make partial repay
        await poolAdapter.syncBalance(false, true);
        await borrowTokenAsUser.transfer(
          poolAdapter.address,
          badParams?.wrongAmountToRepayToTransfer
            ? badParams?.wrongAmountToRepayToTransfer
            : amountToRepay
        );
        await poolAdapter.repay(
          amountToRepay,
          d.userContract.address,
          badParams?.forceToClosePosition || false
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

      // check results
      const statusAfterRepay = await d.hfPoolAdapterTC.getStatus();
      console.log("statusAfterRepay", statusAfterRepay);

      const afterRepay: IUserBalances = {
        collateral: await collateralToken.token.balanceOf(d.userContract.address),
        borrow: await borrowToken.token.balanceOf(d.userContract.address)
      };
      const cTokenCollateral = await IHfCToken__factory.connect(collateralCToken.address, deployer);
      const cTokenBorrow = await IHfCToken__factory.connect(borrowCToken.address, deployer);

      const retCollateral = await cTokenCollateral.getAccountSnapshot(d.hfPoolAdapterTC.address);
      const retBorrow = await cTokenBorrow.getAccountSnapshot(d.hfPoolAdapterTC.address);

      return {
        userBalancesBeforeBorrow: beforeBorrow,
        userBalancesAfterBorrow: afterBorrow,
        userBalancesAfterRepay: afterRepay,
        paCTokensBalance: await cTokenCollateral.balanceOf(d.hfPoolAdapterTC.address),
        totalCollateralBase: retCollateral.tokenBalance,
        totalDebtBase: retBorrow.borrowBalance,
        borrowAmount,
        collateralAmount: d.collateralAmount
      }
    }

    //region Utils
    async function collateralToBorrow(
      useMaxAvailableCollateral: boolean,
      fullRepay: boolean,
      initialBorrowAmountOnUserBalanceNum: number | undefined,
      collateral: IAssetInfo,
      borrow: IAssetInfo,
      defaultCollateralAmount: number = 100_000,
      defaultBorrowAmount: number = 10,
      badPathParams?: IBorrowAndRepayBadParams
    ) : Promise<{ret: string, expected: string}> {
      const collateralToken = await TokenDataTypes.Build(deployer, collateral.asset);
      const borrowToken = await TokenDataTypes.Build(deployer, borrow.asset);
      const collateralCToken = await TokenDataTypes.Build(deployer, collateral.cToken);
      const borrowCToken = await TokenDataTypes.Build(deployer, borrow.cToken);

      const collateralAmount = useMaxAvailableCollateral
        ? undefined
        : getBigNumberFrom(defaultCollateralAmount, collateralToken.decimals);
      const borrowAmount = useMaxAvailableCollateral
        ? undefined
        : getBigNumberFrom(defaultBorrowAmount, borrowToken.decimals);
      const initialBorrowAmountOnUserBalance = getBigNumberFrom(
        initialBorrowAmountOnUserBalanceNum || 0,
        borrowToken.decimals
      );

      const r = await makeBorrowAndRepay(
        collateralToken,
        collateralCToken,
        collateral.holder,
        collateralAmount,
        borrowToken,
        borrowCToken,
        borrow.holder,
        borrowAmount,
        fullRepay ? undefined : borrowAmount,
        initialBorrowAmountOnUserBalance,
        badPathParams
      );

      console.log(`r`, r);
      const ret = [
        r.userBalancesBeforeBorrow.collateral, r.userBalancesBeforeBorrow.borrow,
        r.userBalancesAfterBorrow.collateral, r.userBalancesAfterBorrow.borrow,

        // result collateral is almost same as initial, the difference is less than 1%
        r.collateralAmount.sub(r.userBalancesAfterRepay.collateral)
          .div(r.collateralAmount)
          .mul(100).toNumber() < 1,

        // result borrow balance either 0 or a bit less than initial balance
        initialBorrowAmountOnUserBalance.eq(0)
          ? r.userBalancesAfterRepay.borrow.eq(0)
          : r.userBalancesAfterRepay.borrow.lte(initialBorrowAmountOnUserBalance),

      ].map(x => BalanceUtils.toString(x)).join("\n");

      const expected = [
        r.collateralAmount, initialBorrowAmountOnUserBalance,
        0, r.borrowAmount.add(initialBorrowAmountOnUserBalance),

        true,
        true
      ].map(x => BalanceUtils.toString(x)).join("\n");

      return {ret, expected};
    }

    async function daiWMatic(
      useMaxAvailableCollateral: boolean,
      fullRepay: boolean,
      initialBorrowAmountOnUserBalanceNum?: number,
      badPathParams?: IBorrowAndRepayBadParams
    ) : Promise<{ret: string, expected: string}> {
      const collateralAsset = MaticAddresses.DAI;
      const collateralHolder = MaticAddresses.HOLDER_DAI;
      const collateralCTokenAddress = MaticAddresses.hDAI;

      const borrowAsset = MaticAddresses.WMATIC;
      const borrowHolder = MaticAddresses.HOLDER_WMATIC;
      const borrowCTokenAddress = MaticAddresses.hMATIC;

      return collateralToBorrow(
        useMaxAvailableCollateral,
        fullRepay,
        initialBorrowAmountOnUserBalanceNum,
        {
          asset: collateralAsset,
          holder: collateralHolder,
          cToken: collateralCTokenAddress
        },
        {
          asset: borrowAsset,
          holder: borrowHolder,
          cToken: borrowCTokenAddress
        },
        100_000,
        10,
        badPathParams
      );
    }

    async function daiUSDC(
      useMaxAvailableCollateral: boolean,
      fullRepay: boolean,
      initialBorrowAmountOnUserBalanceNum?: number,
      badPathParams?: IBorrowAndRepayBadParams
    ) : Promise<{ret: string, expected: string}> {
      const collateralAsset = MaticAddresses.DAI;
      const collateralHolder = MaticAddresses.HOLDER_DAI;
      const collateralCTokenAddress = MaticAddresses.hDAI;

      const borrowAsset = MaticAddresses.USDC;
      const borrowHolder = MaticAddresses.HOLDER_USDC;
      const borrowCTokenAddress = MaticAddresses.hUSDC;

      return collateralToBorrow(
        useMaxAvailableCollateral,
        fullRepay,
        initialBorrowAmountOnUserBalanceNum,
        {
          asset: collateralAsset,
          holder: collateralHolder,
          cToken: collateralCTokenAddress
        },
        {
          asset: borrowAsset,
          holder: borrowHolder,
          cToken: borrowCTokenAddress
        },
        100_000,
        10,
        badPathParams
      );
    }

    async function usdtWETH(
      useMaxAvailableCollateral: boolean,
      fullRepay: boolean,
      initialBorrowAmountOnUserBalanceNum?: number,
      badPathParams?: IBorrowAndRepayBadParams
    ) : Promise<{ret: string, expected: string}> {
      const collateralAsset = MaticAddresses.USDT;
      const collateralHolder = MaticAddresses.HOLDER_USDT;
      const collateralCTokenAddress = MaticAddresses.hUSDT;

      const borrowAsset = MaticAddresses.WETH;
      const borrowHolder = MaticAddresses.HOLDER_WETH;
      const borrowCTokenAddress = MaticAddresses.hETH;

      return collateralToBorrow(
        useMaxAvailableCollateral,
        fullRepay,
        initialBorrowAmountOnUserBalanceNum,
        {
          asset: collateralAsset,
          holder: collateralHolder,
          cToken: collateralCTokenAddress
        },
        {
          asset: borrowAsset,
          holder: borrowHolder,
          cToken: borrowCTokenAddress
        },
        100_000_000,
        1,
        badPathParams
      );
    }

    async function usdtUSDC(
      useMaxAvailableCollateral: boolean,
      fullRepay: boolean,
      initialBorrowAmountOnUserBalanceNum?: number,
      badPathParams?: IBorrowAndRepayBadParams
    ) : Promise<{ret: string, expected: string}> {
      const collateralAsset = MaticAddresses.USDT;
      const collateralHolder = MaticAddresses.HOLDER_USDT;
      const collateralCTokenAddress = MaticAddresses.hUSDT;

      const borrowAsset = MaticAddresses.USDC;
      const borrowHolder = MaticAddresses.HOLDER_USDC;
      const borrowCTokenAddress = MaticAddresses.hUSDC;

      return collateralToBorrow(
        useMaxAvailableCollateral,
        fullRepay,
        initialBorrowAmountOnUserBalanceNum,
        {
          asset: collateralAsset,
          holder: collateralHolder,
          cToken: collateralCTokenAddress
        },
        {
          asset: borrowAsset,
          holder: borrowHolder,
          cToken: borrowCTokenAddress
        },
        100_000,
        10,
        badPathParams
      );
    }
//endregion Utils

    describe("Good paths", () => {
      describe("Borrow and repay fixed small amount", () =>{
        describe("Partial repay of borrowed amount", () => {
          describe("DAI => USDC", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;

              const r = await daiUSDC(false, false);
              expect(r.ret).eq(r.expected);
            });
          });
          describe("DAI => WMATIC", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;

              const r = await daiWMatic(false, false);
              expect(r.ret).eq(r.expected);
            });
          });
          describe("USDT => WETH", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;

              const r = await usdtWETH(
                false,
                false,
              );
              expect(r.ret).eq(r.expected);
            });
          });
        });
        describe("Full repay of borrowed amount", () => {
          describe("DAI => USDC", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;

              const initialBorrowAmountOnUserBalance = 100;
              const r = await daiUSDC(
                false,
                true,
                initialBorrowAmountOnUserBalance
              );
              expect(r.ret).eq(r.expected);
            });
          });
          describe("DAI => WMATIC", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;

              const initialBorrowAmountOnUserBalance = 100;
              const r = await daiWMatic(
                false,
                true,
                initialBorrowAmountOnUserBalance
              );
              expect(r.ret).eq(r.expected);
            });
          });
        });
      });
      describe("Borrow max available amount using all available collateral", () =>{
        describe("Partial repay of borrowed amount", () => {
          describe("DAI => USDC", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;

              const r = await daiUSDC(false, false);
              expect(r.ret).eq(r.expected);
            });
          });
          describe("DAI => WMATIC", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;

              const r = await daiWMatic(false, false);
              expect(r.ret).eq(r.expected);
            });
          });
        });
        describe("Full repay of borrowed amount", () => {
          describe("DAI => USDC", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;

              const initialBorrowAmountOnUserBalance = 100;
              const r = await daiUSDC(
                false,
                true,
                initialBorrowAmountOnUserBalance
              );
              expect(r.ret).eq(r.expected);
            });
          });
          describe("DAI => WMATIC", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;

              const initialBorrowAmountOnUserBalance = 100;
              const r = await daiWMatic(
                false,
                true,
                initialBorrowAmountOnUserBalance
              );
              expect(r.ret).eq(r.expected);
            });
          });
          describe("USDT => USDC", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;

              const initialBorrowAmountOnUserBalance = 100;
              const r = await usdtUSDC(
                false,
                true,
                initialBorrowAmountOnUserBalance
              );
              expect(r.ret).eq(r.expected);
            });
          });
        });
      });
    });
    describe("Bad paths", () => {
      describe("Transfer amount less than specified amount to repay", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;

          const usdcDecimals = await IERC20Extended__factory.connect(MaticAddresses.USDC, deployer).decimals();
          await expect(
            daiUSDC(
              false,
              false,
              undefined,
              {
                // try to transfer too small amount on balance of the pool adapter
                wrongAmountToRepayToTransfer: getBigNumberFrom(1, usdcDecimals)
              }
            )
          ).revertedWith("TC-15"); // WRONG_BORROWED_BALANCE
        });
      });
      describe("Transfer amount larger than specified amount to repay", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;

          const usdcDecimals = await IERC20Extended__factory.connect(MaticAddresses.USDC, deployer).decimals();
          const initialBorrowAmountOnUserBalanceNumber = 1000;
          await expect(
            daiUSDC(
              false,
              false,
              initialBorrowAmountOnUserBalanceNumber,
              {
                // try to transfer too LARGE amount on balance of the pool adapter
                wrongAmountToRepayToTransfer: getBigNumberFrom(
                  initialBorrowAmountOnUserBalanceNumber,
                  usdcDecimals
                )
              }
            )
          ).revertedWith("TC-15"); // WRONG_BORROWED_BALANCE
        });
      });
      describe("Try to repay not opened position", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          const initialBorrowAmountOnUserBalanceNumber = 1000;
          await expect(
            daiUSDC(
              false,
              false,
              initialBorrowAmountOnUserBalanceNumber,
              {skipBorrow: true}
            )
          ).revertedWith("TC-28"); // ZERO_BALANCE
        });
      });
      describe("Try to close position with not zero debt", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            daiUSDC(
              false,
              false,
              undefined,
              {forceToClosePosition: true}
            )
          ).revertedWith("TC-24"); // CLOSE_POSITION_FAILED
        });
      });
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
      afterBorrow: IHfAccountLiquidity;
      afterRepayToRebalance: IHfAccountLiquidity;
      afterBorrowStatus: IPoolAdapterStatus;
      afterRepayToRebalanceStatus: IPoolAdapterStatus;
      userBalanceAfterBorrow: BigNumber;
      userBalanceAfterRepayToRebalance: BigNumber;
      expectedBorrowAssetAmountToRepay: BigNumber;
      expectedCollateralAssetAmountToRepay: BigNumber;
    }

    /**
     * Prepare HundredFinance pool adapter.
     * Set low health factors.
     * Make borrow.
     * Increase health factor twice.
     * Make repay to rebalance.
     */
    async function makeRepayToRebalance (
      p: IMakeRepayToRebalanceInputParamsWithCTokens
    ) : Promise<IMakeRepayToRebalanceResults>{
      const d = await prepareToBorrow(
        p.collateralToken,
        p.collateralHolder,
        p.collateralCTokenAddress,
        p.collateralAmount,
        p.borrowToken,
        p.borrowCTokenAddress,
        targetHealthFactorInitial2
      );
      const collateralAssetData = await HundredFinanceHelper.getCTokenData(
        deployer,
        d.comptroller,
        d.collateralCToken
      );
      console.log("collateralAssetData", collateralAssetData);
      const borrowAssetData = await HundredFinanceHelper.getCTokenData(
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

      if (! p.badPathsParams?.skipBorrow) {
        await d.hfPoolAdapterTC.syncBalance(true, true);
        await IERC20__factory.connect(p.collateralToken.address,
          await DeployerUtils.startImpersonate(d.userContract.address)
        ).transfer(d.hfPoolAdapterTC.address, p.collateralAmount);
        await d.hfPoolAdapterTC.borrow(
          p.collateralAmount,
          amountToBorrow,
          d.userContract.address // receiver
        );
      }

      const afterBorrow: IHfAccountLiquidity = await d.comptroller.getAccountLiquidity(d.hfPoolAdapterTC.address);
      const userBalanceAfterBorrow = await p.borrowToken.token.balanceOf(d.userContract.address);
      const afterBorrowStatus = await d.hfPoolAdapterTC.getStatus();
      console.log("after borrow:", afterBorrow, userBalanceAfterBorrow);

      // increase all health factors down on 2 times to have possibility for additional borrow
      await d.controller.setMaxHealthFactor2(maxHealthFactorUpdated2);
      await d.controller.setTargetHealthFactor2(targetHealthFactorUpdated2);
      await d.controller.setMinHealthFactor2(minHealthFactorUpdated2);
      console.log("controller", d.controller.address);
      console.log("min", await d.controller.minHealthFactor2());
      console.log("target", await d.controller.targetHealthFactor2());

      // calculate amount-to-repay and (if necessary) put the amount on userContract's balance
      const amountsToRepay = await SharedRepayToRebalanceUtils.prepareAmountsToRepayToRebalance(
        deployer,
        amountToBorrow,
        p.collateralAmount,
        d.userContract,
        p
      );

      // make repayment to rebalance
      const poolAdapterSigner = p.badPathsParams?.makeRepayToRebalanceAsDeployer
        ? IPoolAdapter__factory.connect(d.hfPoolAdapterTC.address, deployer)
        : d.hfPoolAdapterTC;
      await poolAdapterSigner.syncBalance(false, true);

      await SharedRepayToRebalanceUtils.transferAmountToRepayToUserContract(
        poolAdapterSigner.address,
        p.collateralToken.address,
        p.borrowToken.address,
        amountsToRepay,
        d.userContract.address
      );

      await poolAdapterSigner.repayToRebalance(
        amountsToRepay.useCollateral
          ? amountsToRepay.amountCollateralAsset
          : amountsToRepay.amountBorrowAsset,
        amountsToRepay.useCollateral
      );

      const afterRepayToRebalance: IHfAccountLiquidity = await d.comptroller.getAccountLiquidity(d.hfPoolAdapterTC.address);
      const userBalanceAfterRepayToRebalance = await p.borrowToken.token.balanceOf(d.userContract.address);
      const afterRepayToRebalanceStatus = await d.hfPoolAdapterTC.getStatus();
      console.log("after repay to rebalance:", afterRepayToRebalance, userBalanceAfterRepayToRebalance);

      return {
        afterBorrow,
        afterRepayToRebalance,
        afterBorrowStatus,
        afterRepayToRebalanceStatus,
        userBalanceAfterBorrow,
        userBalanceAfterRepayToRebalance,
        expectedBorrowAssetAmountToRepay: amountsToRepay.useCollateral
          ? BigNumber.from(0)
          : amountsToRepay.amountBorrowAsset,
        expectedCollateralAssetAmountToRepay: amountsToRepay.useCollateral
          ? amountsToRepay.amountCollateralAsset
          : BigNumber.from(0)
      }
    }

    async function makeRepayToRebalanceTest(
      assets: IAssetsInputParamsWithCTokens,
      useCollateralAssetToRepay: boolean,
      badPathsParams?: IMakeRepayRebalanceBadPathParams
    ) : Promise<{ret: string, expected: string}> {

      const collateralToken = await TokenDataTypes.Build(deployer, assets.collateralAsset);
      const borrowToken = await TokenDataTypes.Build(deployer, assets.borrowAsset);
      console.log("collateralToken.decimals", collateralToken.decimals);
      console.log("borrowToken.decimals", borrowToken.decimals);

      const collateralAmount = getBigNumberFrom(assets.collateralAmountNum, collateralToken.decimals);
      console.log(collateralAmount, collateralAmount);

      const r = await makeRepayToRebalance({
        collateralToken,
        collateralHolder: assets.collateralHolder,
        collateralAmount,
        borrowToken,
        borrowHolder: assets.borrowHolder,
        badPathsParams,
        useCollateralAssetToRepay,
        collateralCTokenAddress: assets.collateralCTokenAddress,
        borrowCTokenAddress: assets.borrowCTokenAddress
      });

      console.log(r);

      const ret = [
        Math.round(r.afterBorrowStatus.healthFactor18.div(
          getBigNumberFrom(1, 15)).toNumber() / 10.
        ),
        Math.round(r.afterRepayToRebalanceStatus.healthFactor18.div(
          getBigNumberFrom(1, 15)).toNumber() / 10.
        ),
        // actual collateral amount after borrow is a bit less than the initial amount
        areAlmostEqual(r.afterBorrowStatus.collateralAmount, collateralAmount, 2),

        // total collateral amount is increased on expected amount after repay-to-rebalance
        areAlmostEqual(
          r.afterRepayToRebalanceStatus.collateralAmount,
          r.afterBorrowStatus.collateralAmount.add(r.expectedCollateralAssetAmountToRepay),
          2
        ),

        // total collateral amount was increased twice after repay-to-rebalance
        // when the repayment was made using collateral asset
        !useCollateralAssetToRepay || areAlmostEqual(r.afterRepayToRebalanceStatus.collateralAmount,
          r.afterBorrowStatus.collateralAmount.mul(2),
          3
        ),

        r.afterRepayToRebalanceStatus.amountToPay
          .div(getBigNumberFrom(1, borrowToken.decimals)),
      ].join("\n");
      const expected = [
        targetHealthFactorInitial2,
        targetHealthFactorUpdated2,

        // actual collateral amount after borrow is a bit less than the initial amount
        true,

        // total collateral amount is increased on expected amount after repay-to-rebalance
        true,

        // total collateral amount was increased twice after repay-to-rebalance
        // when the repayment was made using collateral asset
        true,

        r.afterBorrowStatus.amountToPay
          .sub(r.expectedBorrowAssetAmountToRepay)
          .div(getBigNumberFrom(1, borrowToken.decimals)),
      ].join("\n");
      console.log("ret", ret);
      console.log("expected", expected);

      return {ret, expected};
    }

    async function daiWMatic(
      useCollateralAssetToRepay: boolean,
      badPathsParams?: IMakeRepayRebalanceBadPathParams
    ) : Promise<{ret: string, expected: string}> {
      const collateralAsset = MaticAddresses.DAI;
      const collateralHolder = MaticAddresses.HOLDER_DAI;
      const collateralCTokenAddress = MaticAddresses.hDAI;

      const borrowAsset = MaticAddresses.WMATIC;
      const borrowHolder = MaticAddresses.HOLDER_WMATIC;
      const borrowCTokenAddress = MaticAddresses.hMATIC;

      return makeRepayToRebalanceTest(
        {
          borrowCTokenAddress,
          collateralCTokenAddress,
          collateralAsset,
          borrowAsset,
          borrowHolder,
          collateralAmountNum: 100_000,
          collateralHolder
        },
        useCollateralAssetToRepay,
        badPathsParams
      );
    }

    async function usdcUsdt(
      useCollateralAssetToRepay: boolean,
      badPathsParams?: IMakeRepayRebalanceBadPathParams
    ) : Promise<{ret: string, expected: string}> {
      const collateralAsset = MaticAddresses.USDC;
      const collateralHolder = MaticAddresses.HOLDER_USDC;
      const collateralCTokenAddress = MaticAddresses.hUSDC;

      const borrowAsset = MaticAddresses.USDT;
      const borrowHolder = MaticAddresses.HOLDER_USDT;
      const borrowCTokenAddress = MaticAddresses.hUSDT;

      return makeRepayToRebalanceTest(
        {
          borrowCTokenAddress,
          collateralCTokenAddress,
          collateralAsset,
          borrowAsset,
          borrowHolder,
          collateralAmountNum: 100_000,
          collateralHolder
        },
        useCollateralAssetToRepay,
        badPathsParams
      );
    }

    describe("Good paths", () => {
      describe("Use borrow asset to repay", () => {
        describe("Dai : WMatic", () => {
          it("should return expected values", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await daiWMatic(false);

            expect(r.ret).eq(r.expected);
          });
        });
        describe("USDC : USDT", () => {
          it("should return expected values", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await usdcUsdt(false);

            expect(r.ret).eq(r.expected);
          });
        });
      });
      describe("Use collateral asset to repay", () => {
        describe("Dai : WMatic", () => {
          it("should return expected values", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await daiWMatic(true);

            expect(r.ret).eq(r.expected);
          });
        });
        describe("USDC : USDT", () => {
          it("should return expected values", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await usdcUsdt(true);

            expect(r.ret).eq(r.expected);
          });
        });
      });
    });

    describe("Bad paths", () => {
      describe("Not TetuConverter and not user", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            daiWMatic(false,{makeRepayToRebalanceAsDeployer: true})
          ).revertedWith("TC-32");
        });
      });
      describe("Position is not registered", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            daiWMatic(false,{skipBorrow: true})
          ).revertedWith("TC-11");
        });
      });
      describe("Result health factor is less min allowed one", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            daiWMatic(false,{additionalAmountCorrectionFactorDiv: 100})
          ).revertedWith("TC-3: wrong health factor");
        });
      });
      describe("Try to repay amount greater then the debt", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            daiWMatic(false,{additionalAmountCorrectionFactorMul: 100})
          ).revertedWith("TC-40"); // REPAY_TO_REBALANCE_NOT_ALLOWED
        });
      });
    });
  });

  describe("TODO:syncBalance", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        expect.fail("TODO");
      });
    });
    describe("Bad paths", () => {
      describe("", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          expect.fail("TODO");
        });
      });
    });
  });

  describe("TODO:updateBalance", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        expect.fail("TODO");
      });
    });
    describe("Bad paths", () => {
      describe("", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          expect.fail("TODO");
        });
      });
    });
  });

  describe("TODO:initialize", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        expect.fail("TODO");
      });
    });
    describe("Bad paths", () => {
      describe("", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          expect.fail("TODO");
        });
      });
    });
  });

  describe("TODO:hasRewards", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        expect.fail("TODO");
      });
    });
    describe("Bad paths", () => {
      describe("", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          expect.fail("TODO");
        });
      });
    });
  });

  describe("TODO:claimRewards", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        expect.fail("TODO");
      });
    });
    describe("Bad paths", () => {
      describe("", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          expect.fail("TODO");
        });
      });
    });
  });

  describe("TODO:getConversionKind", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        expect.fail("TODO");
      });
    });
    describe("Bad paths", () => {
      describe("", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          expect.fail("TODO");
        });
      });
    });
  });

  describe("TODO:getConfig", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        expect.fail("TODO");
      });
    });
    describe("Bad paths", () => {
      describe("", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          expect.fail("TODO");
        });
      });
    });
  });

  describe("TODO:getStatus", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        expect.fail("TODO");
      });
    });
    describe("Bad paths", () => {
      describe("", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          expect.fail("TODO");
        });
      });
    });
  });

  describe("TODO:getAPR18", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        expect.fail("TODO");
      });
    });
    describe("Bad paths", () => {
      describe("", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          expect.fail("TODO");
        });
      });
    });
  });

//endregion Unit tests

});