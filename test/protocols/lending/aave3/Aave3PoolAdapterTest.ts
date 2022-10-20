import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {
  Aave3PoolAdapter, Aave3PoolAdapter__factory, Borrower, BorrowManager__factory,
  Controller,
  IAavePool, IAavePool__factory, IAavePriceOracle, IAaveProtocolDataProvider,
  IERC20__factory,
  IERC20Extended__factory, IPoolAdapter__factory
} from "../../../../typechain";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../../scripts/utils/NumberUtils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {AdaptersHelper} from "../../../baseUT/helpers/AdaptersHelper";
import {isPolygonForkInUse} from "../../../baseUT/utils/NetworkUtils";
import {Aave3Helper, IAave3ReserveInfo} from "../../../../scripts/integration/helpers/Aave3Helper";
import {BalanceUtils, IUserBalances} from "../../../baseUT/utils/BalanceUtils";
import {CoreContractsHelper} from "../../../baseUT/helpers/CoreContractsHelper";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {MocksHelper} from "../../../baseUT/helpers/MocksHelper";
import {TokenDataTypes} from "../../../baseUT/types/TokenDataTypes";
import {Misc} from "../../../../scripts/utils/Misc";
import {IAave3UserAccountDataResults} from "../../../baseUT/apr/aprAave3";
import {CompareAprUsesCase} from "../../../baseUT/uses-cases/CompareAprUsesCase";
import {
  AaveMakeBorrowAndRepayUtils,
  IMakeBorrowAndRepayResults
} from "../../../baseUT/protocols/aaveShared/aaveBorrowAndRepayUtils";
import {
  AaveRepayToRebalanceUtils,
  IMakeRepayRebalanceBadPathParams,
  IMakeRepayToRebalanceResults
} from "../../../baseUT/protocols/aaveShared/aaveRepayToRebalanceUtils";
import {
  AaveBorrowToRebalanceUtils,
  IMakeBorrowToRebalanceBadPathParams,
  IMakeBorrowToRebalanceResults
} from "../../../baseUT/protocols/aaveShared/aaveBorrowToRebalanceUtils";
import {AaveBorrowUtils} from "../../../baseUT/protocols/aaveShared/aaveBorrowUtils";

describe("Aave3PoolAdapterTest", () => {
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
    h: Aave3Helper;

    aavePoolAdapterAsTC: Aave3PoolAdapter;
    aavePool: IAavePool;
    dataProvider: IAaveProtocolDataProvider;
    aavePrices: IAavePriceOracle;

    controller: Controller;

    /** Amount that can be borrowed according to the conversion plan */
    amountToBorrow: BigNumber;
    /** Actual amount that was used as collateral */
    collateralAmount: BigNumber;
  }

  /**
   * Initialize TetuConverter app and aave pool adapter.
   * Put the collateral amount on pool-adapter's balance.
   *
   * If collateralAmount is undefined, we should use all available amount as the collateral.
   */
  async function prepareToBorrow(
    collateralToken: TokenDataTypes,
    collateralHolder: string,
    collateralAmountRequired: BigNumber | undefined,
    borrowToken: TokenDataTypes,
    useEMode: boolean,
    targetHealthFactor2?: number
  ) : Promise<IPrepareToBorrowResults> {
    const periodInBlocks = 1000;

    // initialize pool, adapters and helper for the adapters
    const h: Aave3Helper = new Aave3Helper(deployer);

    const aavePool = await Aave3Helper.getAavePool(deployer);
    const dataProvider = await Aave3Helper.getAaveProtocolDataProvider(deployer);
    const aavePrices = await Aave3Helper.getAavePriceOracle(deployer);

    // controller: we need TC (as a caller) and DM (to register borrow position)
    const controller = await CoreContractsHelper.createController(deployer);
    const tetuConverter = await CoreContractsHelper.createTetuConverter(deployer, controller);
    const dm = await CoreContractsHelper.createDebtMonitor(deployer, controller);
    // const bm = await MocksHelper.createBorrowManagerStub(deployer, true);
    const bm = await CoreContractsHelper.createBorrowManager(deployer, controller);
    await controller.setBorrowManager(bm.address);
    await controller.setDebtMonitor(dm.address);
    await controller.setTetuConverter(tetuConverter.address);

    const userContract = await MocksHelper.deployBorrower(deployer.address, controller, periodInBlocks);

    const converterNormal = await AdaptersHelper.createAave3PoolAdapter(deployer);
    const converterEMode = await AdaptersHelper.createAave3PoolAdapterEMode(deployer);
    const aavePlatformAdapter = await AdaptersHelper.createAave3PlatformAdapter(
      deployer, controller.address, aavePool.address,
      converterNormal.address,
      converterEMode.address
    );

    await bm.addAssetPairs(
      aavePlatformAdapter.address,
      [collateralToken.address],
      [borrowToken.address]
    );
    const bmAsTc = BorrowManager__factory.connect(
      bm.address,
      await DeployerUtils.startImpersonate(tetuConverter.address)
    );
    await bmAsTc.registerPoolAdapter(
      useEMode ? converterEMode.address : converterNormal.address,
      userContract.address,
      collateralToken.address,
      borrowToken.address
    );
    const aavePoolAdapterAsTC = Aave3PoolAdapter__factory.connect(
      await bm.getPoolAdapter(
        useEMode ? converterEMode.address : converterNormal.address,
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
    const borrowAmountFactor18 = CompareAprUsesCase.getBorrowAmountFactor18(
      collateralAmount,
      targetHealthFactor2 || await controller.targetHealthFactor2(),
      collateralToken.decimals
    );

    const plan = await aavePlatformAdapter.getConversionPlan(
      collateralToken.address,
      collateralAmount,
      borrowToken.address,
      borrowAmountFactor18,
      countBlocks
    );
    console.log("plan", plan);

    return {
      controller,
      h,
      userContract,
      aavePrices,
      aavePool,
      aavePoolAdapterAsTC,
      dataProvider,
      amountToBorrow: plan.amountToBorrow,
      collateralAmount
    }
  }
//endregion Test impl

//region Unit tests
  describe("borrow", () => {
    async function makeBorrow(
      collateralToken: TokenDataTypes,
      collateralHolder: string,
      collateralAmountRequired: BigNumber | undefined,
      borrowToken: TokenDataTypes,
      borrowAmountRequired: BigNumber | undefined
    ): Promise<{ sret: string, sexpected: string }> {
      const d = await prepareToBorrow(
        collateralToken,
        collateralHolder,
        collateralAmountRequired,
        borrowToken,
        false
      );
      const collateralData = await d.h.getReserveInfo(deployer, d.aavePool, d.dataProvider, collateralToken.address);
      const borrowAmount = borrowAmountRequired
        ? borrowAmountRequired
        : d.amountToBorrow;
      console.log("collateralAmountRequired", collateralAmountRequired);
      console.log("borrowAmountRequired", borrowAmountRequired);
      console.log("d.collateralAmount", d.collateralAmount);
      console.log("borrowAmount", borrowAmount);

      await d.aavePoolAdapterAsTC.syncBalance(true);
      await IERC20__factory.connect(collateralToken.address, await DeployerUtils.startImpersonate(d.userContract.address))
        .transfer(d.aavePoolAdapterAsTC.address, d.collateralAmount);
      await d.aavePoolAdapterAsTC.borrow(
        d.collateralAmount,
        borrowAmount,
        d.userContract.address
      );

      // prices of assets in base currency
      const prices = await d.aavePrices.getAssetsPrices([collateralToken.address, borrowToken.address]);

      // check results
      const ret = await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address);

      const sret = [
        await borrowToken.token.balanceOf(d.userContract.address),
        await IERC20Extended__factory.connect(collateralData.data.aTokenAddress, deployer)
          .balanceOf(d.aavePoolAdapterAsTC.address),
        ret.totalCollateralBase,
        ret.totalDebtBase
      ].map(x => BalanceUtils.toString(x)).join("\n");

      const sexpected = [
        borrowAmount, // borrowed amount on user's balance
        d.collateralAmount, // amount of collateral tokens on pool-adapter's balance
        d.collateralAmount.mul(prices[0])  // registered collateral in the pool
          .div(getBigNumberFrom(1, collateralToken.decimals)),
        borrowAmount.mul(prices[1]) // registered debt in the pool
          .div(getBigNumberFrom(1, borrowToken.decimals)),
      ].map(x => BalanceUtils.toString(x)).join("\n");

      return {sret, sexpected};
    }

    describe("Good paths", () => {
      describe("Borrow fixed small amount", () => {
        describe("DAI-18 : matic-18", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await AaveBorrowUtils.daiWMatic(
              deployer,
              makeBorrow,
              100_000,
              10
            );
            expect(r.ret).eq(r.expected);
          });
        });
        describe("DAI-18 : USDC-6", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;

            const r = await AaveBorrowUtils.daiUsdc(
              deployer,
              makeBorrow,
              100_000,
              10
            );
            expect(r.ret).eq(r.expected);
          });
        });
        describe("STASIS EURS-2 : Tether-6", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;

            const r = await AaveBorrowUtils.eursTether(
              deployer,
              makeBorrow,
              100_000,
              10
            );
            expect(r.ret).eq(r.expected);
          });
        });
        describe("USDC-6 : DAI-18", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;

            const r = await AaveBorrowUtils.eursTether(
              deployer,
              makeBorrow,
              100_000,
              10
            );
            expect(r.ret).eq(r.expected);
          });
        });
        describe("WBTC-8 : Tether-6", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;

            const r = await AaveBorrowUtils.wbtcTether(
              deployer,
              makeBorrow,
              100,
              10
            );
            expect(r.ret).eq(r.expected);
          });
        });
      });
      describe("Borrow max available amount using all available collateral", () => {
        describe("DAI-18 : matic-18", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await AaveBorrowUtils.daiWMatic(
              deployer,
              makeBorrow,
              undefined,
              undefined
            );
            expect(r.ret).eq(r.expected);
          });
        });
        describe("DAI-18 : USDC-6", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;

            const r = await AaveBorrowUtils.daiUsdc(
              deployer,
              makeBorrow,
              undefined,
              undefined
            );
            expect(r.ret).eq(r.expected);
          });
        });
        describe("STASIS EURS-2 : Tether-6", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;

            const r = await AaveBorrowUtils.eursTether(
              deployer,
              makeBorrow,
              undefined,
              undefined
            );
            expect(r.ret).eq(r.expected);
          });
        });
        describe("USDC-6 : DAI-18", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;

            const r = await AaveBorrowUtils.eursTether(
              deployer,
              makeBorrow,
              undefined,
              undefined
            );
            expect(r.ret).eq(r.expected);
          });
        });
        describe("WBTC-8 : Tether-6", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;

            const r = await AaveBorrowUtils.wbtcTether(
              deployer,
              makeBorrow,
              undefined,
              undefined
            );
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


  /**
   *                LTV                LiquidationThreshold
   * DAI:           0.75               0.8
   * WMATIC:        0.65               0.7
   *
   * LTV: what amount of collateral we can use to borrow
   * LiquidationThreshold: if borrow amount exceeds collateral*LiquidationThreshold => liquidation
   *
   * Let's ensure in following test, that LTV and LiquidationThreshold of collateral are used
   * in calculations inside getUserAccountData. The values of borrow asset don't matter there
   */
  describe("Borrow: check LTV and liquidationThreshold", () => {
    async function makeTestBorrowMaxAmount(
      collateralToken: TokenDataTypes,
      collateralHolder: string,
      collateralAmount: BigNumber,
      borrowToken: TokenDataTypes,
    ): Promise<{userAccountData: IAave3UserAccountDataResults, collateralData: IAave3ReserveInfo}> {
      const minHealthFactor2 = 101;
      const targetHealthFactor2 = 202;
      const d = await prepareToBorrow(
        collateralToken,
        collateralHolder,
        collateralAmount,
        borrowToken,
        false,
        targetHealthFactor2
      );
      await d.controller.setMinHealthFactor2(minHealthFactor2);
      await d.controller.setTargetHealthFactor2(targetHealthFactor2);
      const collateralData = await d.h.getReserveInfo(deployer, d.aavePool, d.dataProvider, collateralToken.address);
      console.log("collateralData", collateralData);

      // prices of assets in base currency
      const prices = await d.aavePrices.getAssetsPrices([collateralToken.address, borrowToken.address]);
      console.log("prices", prices);

      // let's manually calculate max allowed amount to borrow
      const collateralAmountInBase18 = collateralAmount
        .mul(prices[0])
        .div(getBigNumberFrom(1, collateralToken.decimals));
      const maxAllowedAmountToBorrowInBase18 = collateralAmountInBase18
        .mul(100) // let's take into account min allowed health factor
        .div(minHealthFactor2)
        .mul(collateralData.data.ltv)
        .div(1e4);
      const maxAllowedAmountToBorrow = maxAllowedAmountToBorrowInBase18
        .div(prices[1])
        .mul(getBigNumberFrom(1, borrowToken.decimals));
      console.log("collateralAmountInBase18", collateralAmountInBase18);
      console.log("maxAllowedAmountToBorrowInBase18", maxAllowedAmountToBorrowInBase18);
      console.log("maxAllowedAmountToBorrow", maxAllowedAmountToBorrow);

      await d.aavePoolAdapterAsTC.syncBalance(true);
      await IERC20__factory.connect(collateralToken.address, await DeployerUtils.startImpersonate(d.userContract.address))
        .transfer(d.aavePoolAdapterAsTC.address, collateralAmount);
      await d.aavePoolAdapterAsTC.borrow(
        collateralAmount,
        maxAllowedAmountToBorrow,
        d.userContract.address
      );
      console.log("amountToBorrow", maxAllowedAmountToBorrow);

      // check results
      const ret = await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address);
      console.log(ret);
      return {
        userAccountData: ret,
        collateralData
      }
    }
    describe("Good paths", () => {
      it("should move user account in the pool to expected state", async () => {
        const collateralAsset = MaticAddresses.DAI;
        const collateralHolder = MaticAddresses.HOLDER_DAI;
        const borrowAsset = MaticAddresses.WMATIC;

        const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
        const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

        const collateralAmount = getBigNumberFrom(100_000, collateralToken.decimals);

        const r = await makeTestBorrowMaxAmount(
          collateralToken
          , collateralHolder
          , collateralAmount
          , borrowToken
        );
        console.log(r);

        const ret = [
          r.userAccountData.ltv,
          r.userAccountData.currentLiquidationThreshold,
          r.userAccountData.totalDebtBase
            .add(r.userAccountData.availableBorrowsBase)
            .mul(1e4)
            .div(r.userAccountData.totalCollateralBase)
        ].map(x => BalanceUtils.toString(x)).join("\n");

        const expected = [
          r.collateralData.data.ltv,
          r.collateralData.data.liquidationThreshold,
          r.collateralData.data.ltv
        ].map(x => BalanceUtils.toString(x)).join("\n");

        expect(ret).eq(expected);
      });
    });
  });

  describe("Borrow in isolated mode", () => {
//region Utils
    async function supplyEnoughBorrowAssetToAavePool(
      aavePool: string,
      borrowHolders: string[],
      borrowAsset: string
    ) {
      const user2 = await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address);

      // user2 provides DAI amount enough to borrow by user1
      for (const h of borrowHolders) {
        const caAsH = IERC20__factory.connect(borrowAsset, await DeployerUtils.startImpersonate(h));
        const holderBalance = await caAsH.balanceOf(h);
        console.log("Holder balance:", holderBalance.toString());
        await caAsH.transfer(user2.address, await caAsH.balanceOf(h));
        const userBalance = await caAsH.balanceOf(user2.address);
        console.log("User balance:", userBalance.toString());
      }

      // supply all available borrow asset to aave pool
      const user2CollateralBalance = await IERC20__factory.connect(borrowAsset, user2).balanceOf(user2.address);
      await IERC20Extended__factory.connect(borrowAsset, user2).approve(aavePool, user2CollateralBalance);
      console.log(`Supply collateral ${borrowAsset} amount ${user2CollateralBalance}`);
      await IAavePool__factory.connect(aavePool, await DeployerUtils.startImpersonate(user2.address))
        .supply(borrowAsset, user2CollateralBalance, user2.address, 0);
    }

    async function takeCollateralFromHolders(
      user: string,
      collateralHolders: string[],
      collateralAsset: string
    ) {
      // take collateral amount from holders
      for (const h of collateralHolders) {
        const caAsH = IERC20__factory.connect(collateralAsset, await DeployerUtils.startImpersonate(h));
        const holderBalance = await caAsH.balanceOf(h);
        console.log("Holder balance:", holderBalance.toString());
        await caAsH.transfer(user, await caAsH.balanceOf(h));
        const userBalance = await caAsH.balanceOf(user);
        console.log("User balance:", userBalance.toString());
      }
    }

    async function getMaxAmountToBorrow(
      collateralDataBefore: IAave3ReserveInfo,
      borrowDataBefore: IAave3ReserveInfo
    ) : Promise<BigNumber> {
      // get max allowed amount to borrow
      // amount = (debt-ceiling - total-isolation-debt) * 10^{6 - 2}
      // see aave-v3-core: validateBorrow()
      const debtCeiling = collateralDataBefore.data.debtCeiling;
      const totalIsolationDebt = collateralDataBefore.data.isolationModeTotalDebt;
      const decimalsBorrow = borrowDataBefore.data.decimals;
      const precisionDebtCeiling = 2; // Aave3ReserveConfiguration.DEBT_CEILING_DECIMALS
      console.log("debtCeiling", debtCeiling);
      console.log("totalIsolationDebt", totalIsolationDebt);
      console.log("decimalsBorrow", decimalsBorrow);
      console.log("precisionDebtCeiling", precisionDebtCeiling);

      // calculate max amount manually
      return debtCeiling
        .sub(totalIsolationDebt)
        .mul(getBigNumberFrom(1, decimalsBorrow - precisionDebtCeiling));

    }

    async function makeBorrow(
      aavePool: IAavePool,
      user: SignerWithAddress,
      borrowAmount: BigNumber,
      collateralAsset: string,
      borrowAsset: string
    ) {
      // user1 supplies the collateral
      const userCollateralBalance = await IERC20__factory.connect(collateralAsset, user).balanceOf(user.address);
      const collateralAmount = userCollateralBalance; // getBigNumberFrom(collateralAmountNumber, collateralDataBefore.data.decimals);

      await IERC20Extended__factory.connect(collateralAsset, user).approve(aavePool.address, collateralAmount);
      console.log(`Supply collateral ${collateralAsset} amount ${collateralAmount}`);
      await aavePool.supply(collateralAsset, collateralAmount, user.address, 0);
      const userAccountDataBefore = await aavePool.getUserAccountData(user.address);
      console.log(userAccountDataBefore);
      await aavePool.setUserUseReserveAsCollateral(collateralAsset, true);

      await aavePool.borrow(borrowAsset, borrowAmount, 2, 0, user.address);
      console.log("Borrow", borrowAmount);
      const userAccountDataAfter = await aavePool.getUserAccountData(user.address);
      console.log(userAccountDataAfter);
    }

    /**
     * Calculate max allowed borrow amount in isolation mode manually and using getConversionPlan
     * Try to make borrow of (the max allowed amount + optional delta)
     */
    async function borrowMaxAmountInIsolationMode (
      collateralAsset: string,
      collateralHolders: string[],
      borrowAsset: string,
      borrowHolders: string[],
      deltaToMaxAmount?: BigNumber
    ) : Promise<{maxBorrowAmount: BigNumber, maxBorrowAmountByPlan: BigNumber}>{
      const user = await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address);
      const countBlocks = 10;

      const aavePool = await Aave3Helper.getAavePool(user);
      const dp = await Aave3Helper.getAaveProtocolDataProvider(user);

      await supplyEnoughBorrowAssetToAavePool(aavePool.address, borrowHolders, borrowAsset);
      await takeCollateralFromHolders(user.address, collateralHolders, collateralAsset);

      // take collateral status before supply
      const h: Aave3Helper = new Aave3Helper(user);
      const collateralDataBefore = await h.getReserveInfo(user, aavePool, dp, collateralAsset);
      const borrowDataBefore = await h.getReserveInfo(user, aavePool, dp, borrowAsset);
      console.log("collateralDataBefore", collateralDataBefore);

      // calculate max amount to borrow manually
      const maxBorrowAmount = await getMaxAmountToBorrow(collateralDataBefore, borrowDataBefore);

      // get conversion strategy from tetu converter
      const controller = await CoreContractsHelper.createController(deployer);
      const templateAdapterStub = ethers.Wallet.createRandom().address;

      const pa = await AdaptersHelper.createAave3PlatformAdapter(deployer
        , controller.address
        , aavePool.address
        , templateAdapterStub
        , templateAdapterStub
      );
      const plan = await pa.getConversionPlan(
        collateralAsset,
        0,
        borrowAsset,
        0,
        countBlocks);

      // now, let's ensure that we can borrow max amount
      console.log("Max allowed amount to borrow", maxBorrowAmount);

      const amountToBorrow = deltaToMaxAmount
        ? maxBorrowAmount.add(deltaToMaxAmount)
        : maxBorrowAmount;

      console.log("Try to borrow", amountToBorrow);

      await makeBorrow(aavePool, user, amountToBorrow, collateralAsset, borrowAsset);

      // after borrow
      const collateralDataAfter = await h.getReserveInfo(user, aavePool, dp, collateralAsset);
      console.log("collateralDataAfter", collateralDataAfter);
      console.log("isolationModeTotalDebt delta"
        , BigNumber.from(collateralDataAfter.data.isolationModeTotalDebt)
          .sub(BigNumber.from(collateralDataBefore.data.isolationModeTotalDebt))
      );

      return {maxBorrowAmount, maxBorrowAmountByPlan: plan.maxAmountToBorrow}
    }
//endregion Utils

    describe("Good paths", () => {
      describe("USDT : DAI", () => {
//region Constants
        const collateralAsset = MaticAddresses.USDT;
        const borrowAsset = MaticAddresses.DAI;
        const collateralHolders = [
          MaticAddresses.HOLDER_USDT,
          MaticAddresses.HOLDER_USDT_1,
          MaticAddresses.HOLDER_USDT_2,
          MaticAddresses.HOLDER_USDT_3
        ];
        const borrowHolders = [
          MaticAddresses.HOLDER_DAI,
          MaticAddresses.HOLDER_DAI_2,
          MaticAddresses.HOLDER_DAI_3,
          MaticAddresses.HOLDER_DAI_4,
          MaticAddresses.HOLDER_DAI_5,
          MaticAddresses.HOLDER_DAI_6
        ];
//endregion Constants
        describe("Try to borrow max amount allowed by debt ceiling", () => {
          it("should return expected values", async () => {
            const ret = await borrowMaxAmountInIsolationMode(collateralAsset, collateralHolders, borrowAsset, borrowHolders);

            const sret = ret.maxBorrowAmount.toString();
            const sexpected = ret.maxBorrowAmountByPlan.toString();

            expect(sret).eq(sexpected);
          });
        });
      });
      describe("EURS : USDC", () => {
//region Constants
        const collateralAsset = MaticAddresses.EURS;
        const borrowAsset = MaticAddresses.USDC;
        const collateralHolders = [MaticAddresses.HOLDER_EURS
          , MaticAddresses.HOLDER_EURS_2
          , MaticAddresses.HOLDER_EURS_3
        ];
        const borrowHolders = [MaticAddresses.HOLDER_USDC];
//endregion Constants

        describe("Try to borrow max amount allowed by debt ceiling", () => {
          it("should return expected values", async () => {
            const ret = await borrowMaxAmountInIsolationMode(collateralAsset, collateralHolders, borrowAsset, borrowHolders);

            const sret = ret.maxBorrowAmount.toString();
            const sexpected = ret.maxBorrowAmountByPlan.toString();

            expect(sret).eq(sexpected);
          });
        });
      });
      describe("EURS : USDT", () => {
//region Constants
        const collateralAsset = MaticAddresses.EURS;
        const borrowAsset = MaticAddresses.USDT;
        const collateralHolders = [MaticAddresses.HOLDER_EURS
          , MaticAddresses.HOLDER_EURS_2
          , MaticAddresses.HOLDER_EURS_3
        ];
        const borrowHolders = [MaticAddresses.HOLDER_USDT];
//endregion Constants

        describe("Try to borrow max amount allowed by debt ceiling", () => {
          it("should return expected values", async () => {
            const ret = await borrowMaxAmountInIsolationMode(collateralAsset, collateralHolders, borrowAsset, borrowHolders);

            const sret = ret.maxBorrowAmount.toString();
            const sexpected = ret.maxBorrowAmountByPlan.toString();

            expect(sret).eq(sexpected);
          });
        });
      });
    });

    describe("Bad paths", () => {
      describe("Debt ceiling exceeded", () => {
        describe("USDT : DAI", () => {
//region Constants
          const collateralAsset = MaticAddresses.USDT;
          const borrowAsset = MaticAddresses.DAI;
          const collateralHolders = [
            MaticAddresses.HOLDER_USDT,
            MaticAddresses.HOLDER_USDT_1,
            MaticAddresses.HOLDER_USDT_2,
            MaticAddresses.HOLDER_USDT_3
          ];
          const borrowHolders = [
            MaticAddresses.HOLDER_DAI,
            MaticAddresses.HOLDER_DAI_2,
            MaticAddresses.HOLDER_DAI_3,
            MaticAddresses.HOLDER_DAI_4,
            MaticAddresses.HOLDER_DAI_5,
            MaticAddresses.HOLDER_DAI_6
          ];
//endregion Constants
          describe("Try to borrow max amount allowed by debt ceiling", () => {
            it("should return expected values", async () => {
              await expect(
                borrowMaxAmountInIsolationMode(collateralAsset
                  , collateralHolders
                  , borrowAsset
                  , borrowHolders
                  , Misc.WEI // 1 DAI
                )
              ).revertedWith("VM Exception while processing transaction: reverted with reason string '53'");
            });
          });
        });
        describe("EURS : USDC", () => {
//region Constants
          const collateralAsset = MaticAddresses.EURS;
          const borrowAsset = MaticAddresses.USDC;
          const collateralHolders = [MaticAddresses.HOLDER_EURS
            , MaticAddresses.HOLDER_EURS_2
            , MaticAddresses.HOLDER_EURS_3
          ];
          const borrowHolders = [MaticAddresses.HOLDER_USDC];
//endregion Constants

          describe("Try to borrow max amount allowed by debt ceiling", () => {
            it("should return expected values", async () => {
              await expect(
                borrowMaxAmountInIsolationMode(collateralAsset
                  , collateralHolders
                  , borrowAsset
                  , borrowHolders
                  , getBigNumberFrom(1, 6) // 1 USDC
                )
              ).revertedWith("VM Exception while processing transaction: reverted with reason string '53'");
            });
          });
        });
      });
      describe("Not borrowable in isolation mode", () => {
        describe("USDT : Chainlink", () => {
//region Constants
          const collateralAsset = MaticAddresses.USDT;
          const borrowAsset = MaticAddresses.ChainLink;
          const collateralHolders = [
            MaticAddresses.HOLDER_USDT,
            MaticAddresses.HOLDER_USDT_1,
            MaticAddresses.HOLDER_USDT_2,
            MaticAddresses.HOLDER_USDT_3
          ];
          const borrowHolders = [
            MaticAddresses.HOLDER_ChainLink,
          ];
//endregion Constants
          describe("Try to borrow max amount allowed by debt ceiling", () => {
            it("should return expected values", async () => {
              await expect(
                borrowMaxAmountInIsolationMode(collateralAsset
                  , collateralHolders
                  , borrowAsset
                  , borrowHolders
                  , Misc.WEI // 1 DAI
                )
              ).revertedWith("VM Exception while processing transaction: reverted with reason string '60'");
            });
          });
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
      collateralAmount: BigNumber,
      borrowToken: TokenDataTypes,
      borrowHolder: string,
      badPathsParams?: IMakeBorrowToRebalanceBadPathParams
    ) : Promise<IMakeBorrowToRebalanceResults>{
      const d = await prepareToBorrow(
        collateralToken,
        collateralHolder,
        collateralAmount,
        borrowToken,
        false,
        targetHealthFactorInitial2
      );
      const collateralAssetData = await d.h.getReserveInfo(deployer, d.aavePool, d.dataProvider, collateralToken.address);
      console.log("collateralAssetData", collateralAssetData);
      const borrowAssetData = await d.h.getReserveInfo(deployer, d.aavePool, d.dataProvider, borrowToken.address);
      console.log("borrowAssetData", borrowAssetData);

      const collateralFactor = collateralAssetData.data.ltv;
      console.log("collateralFactor", collateralFactor);

      // prices of assets in base currency
      const prices = await d.aavePrices.getAssetsPrices([collateralToken.address, borrowToken.address]);
      console.log("prices", prices);

      // setup high values for all health factors
      await d.controller.setMaxHealthFactor2(maxHealthFactorInitial2);
      await d.controller.setTargetHealthFactor2(targetHealthFactorInitial2);
      await d.controller.setMinHealthFactor2(minHealthFactorInitial2);

      // make borrow
      const amountToBorrow = d.amountToBorrow;
      if (! badPathsParams?.skipBorrow) {
        await d.aavePoolAdapterAsTC.syncBalance(true);
        await IERC20__factory.connect(collateralToken.address, await DeployerUtils.startImpersonate(d.userContract.address))
          .transfer(d.aavePoolAdapterAsTC.address, collateralAmount);
        await d.aavePoolAdapterAsTC.borrow(
          collateralAmount,
          amountToBorrow,
          d.userContract.address // receiver
        );
      }
      const afterBorrow: IAave3UserAccountDataResults = await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address);
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
        ? IPoolAdapter__factory.connect(d.aavePoolAdapterAsTC.address, deployer)
        : d.aavePoolAdapterAsTC;
      await poolAdapterSigner.syncBalance(true);
      await poolAdapterSigner.borrowToRebalance(
        expectedAdditionalBorrowAmount,
        d.userContract.address // receiver
      );

      const afterBorrowToRebalance: IAave3UserAccountDataResults = await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address);
      const userBalanceAfterBorrowToRebalance = await borrowToken.token.balanceOf(d.userContract.address);
      console.log("after borrow to rebalance:", afterBorrowToRebalance, userBalanceAfterBorrowToRebalance);

      return {
        afterBorrow,
        afterBorrowToRebalance,
        userBalanceAfterBorrow,
        userBalanceAfterBorrowToRebalance,
        expectedAdditionalBorrowAmount
      }
    }

    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        const r = await AaveBorrowToRebalanceUtils.testDaiWMatic(
          deployer,
          makeBorrowToRebalance,
          targetHealthFactorInitial2,
          targetHealthFactorUpdated2
        );

        expect(r.ret).eq(r.expected);
      });
    });
    describe("Bad paths", () => {
      async function testDaiWMatic(badPathsParams?: IMakeBorrowToRebalanceBadPathParams) {
        await AaveBorrowToRebalanceUtils.testDaiWMatic(
          deployer,
          makeBorrowToRebalance,
          targetHealthFactorInitial2,
          targetHealthFactorUpdated2,
          badPathsParams
        );
      }
      describe("Not TetuConverter", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            testDaiWMatic({makeBorrowToRebalanceAsDeployer: true})
          ).revertedWith("TC-8");
        });
      });
      describe("Position is not registered", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            testDaiWMatic({skipBorrow: true})
          ).revertedWith("TC-11");
        });
      });
      describe("Result health factor is less min allowed one", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            testDaiWMatic({additionalAmountCorrectionFactor: 10})
          ).revertedWith("TC-3: wrong health factor");
        });
      });
    });
  });

  describe("repay", () => {
    /* Make full or partial repay. Set amountToRepay for partial repay, leave it undefined to full repay */
    async function makeBorrowAndRepay(
      collateralToken: TokenDataTypes,
      collateralHolder: string,
      collateralAmount: BigNumber,
      borrowToken: TokenDataTypes,
      borrowHolder: string,
      borrowAmount: BigNumber,
      amountToRepay?: BigNumber,
      initialBorrowAmountOnUserBalance?: BigNumber,
    ) : Promise<IMakeBorrowAndRepayResults>{
      const d = await prepareToBorrow(collateralToken,
        collateralHolder,
        collateralAmount,
        borrowToken,
        false
      );
      const collateralData = await d.h.getReserveInfo(deployer, d.aavePool, d.dataProvider, collateralToken.address);

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
      await d.aavePoolAdapterAsTC.syncBalance(true);
      await IERC20__factory.connect(collateralToken.address, await DeployerUtils.startImpersonate(d.userContract.address))
        .transfer(d.aavePoolAdapterAsTC.address, collateralAmount);
      await d.aavePoolAdapterAsTC.borrow(
        collateralAmount,
        borrowAmount,
        d.userContract.address
      );

      const afterBorrow: IUserBalances = {
        collateral: await collateralToken.token.balanceOf(d.userContract.address),
        borrow: await borrowToken.token.balanceOf(d.userContract.address)
      };
      console.log(afterBorrow);

      const borrowTokenAsUser = IERC20Extended__factory.connect(
        borrowToken.address,
        await DeployerUtils.startImpersonate(d.userContract.address)
      );
      if (amountToRepay) {
        // make partial repay
        await d.aavePoolAdapterAsTC.syncBalance(false);
        await borrowTokenAsUser.transfer(d.aavePoolAdapterAsTC.address, amountToRepay);
        await d.aavePoolAdapterAsTC.repay(
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

      // check results
      const afterRepay: IUserBalances = {
        collateral: await collateralToken.token.balanceOf(d.userContract.address),
        borrow: await borrowToken.token.balanceOf(d.userContract.address)
      };
      const ret = await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address);

      return {
        userBalancesBeforeBorrow: beforeBorrow,
        userBalancesAfterBorrow: afterBorrow,
        userBalancesAfterRepay: afterRepay,
        paATokensBalance: await IERC20Extended__factory.connect(collateralData.data.aTokenAddress, deployer)
          .balanceOf(d.aavePoolAdapterAsTC.address),
        totalCollateralBase: ret.totalCollateralBase,
        totalDebtBase: ret.totalDebtBase,
        poolAdapter: d.aavePoolAdapterAsTC.address
      }
    }
    describe("Good paths", () => {
      describe("Borrow and repay modest amount", () => {
        describe("Partial repay of borrowed amount", () => {
          describe("DAI => WMATIC", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const r = await AaveMakeBorrowAndRepayUtils.daiWmatic(
                deployer,
                makeBorrowAndRepay,
                false
              );
              expect(r.ret).eq(r.expected);
            });
          });
          describe("WMATIC => DAI", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const r = await AaveMakeBorrowAndRepayUtils.daiWmatic(
                deployer,
                makeBorrowAndRepay,
                false
              );
              expect(r.ret).eq(r.expected);
            });
          });
        });
        describe("Full repay of borrowed amount", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;
            const initialBorrowAmountOnUserBalance = 1;
            const r = await AaveMakeBorrowAndRepayUtils.daiWmatic(
              deployer,
              makeBorrowAndRepay,
              true,
              initialBorrowAmountOnUserBalance
            );
            expect(r.ret).eq(r.expected);
          });
        });
      });
    });
    describe("Bad paths", () =>{
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

    /**
     * Prepare aave3 pool adapter.
     * Set low health factors.
     * Make borrow.
     * Increase health factor twice.
     * Make repay to rebalance.
     */
    async function makeRepayToRebalance (
      collateralToken: TokenDataTypes,
      collateralHolder: string,
      collateralAmount: BigNumber,
      borrowToken: TokenDataTypes,
      borrowHolder: string,
      badPathsParams?: IMakeRepayRebalanceBadPathParams
    ) : Promise<IMakeRepayToRebalanceResults>{
      const d = await prepareToBorrow(
        collateralToken,
        collateralHolder,
        collateralAmount,
        borrowToken,
        false,
        targetHealthFactorInitial2
      );
      const collateralAssetData = await d.h.getReserveInfo(deployer, d.aavePool, d.dataProvider, collateralToken.address);
      console.log("collateralAssetData", collateralAssetData);
      const borrowAssetData = await d.h.getReserveInfo(deployer, d.aavePool, d.dataProvider, borrowToken.address);
      console.log("borrowAssetData", borrowAssetData);

      // prices of assets in base currency
      const prices = await d.aavePrices.getAssetsPrices([collateralToken.address, borrowToken.address]);
      console.log("prices", prices);

      // setup low values for all health factors
      await d.controller.setMaxHealthFactor2(maxHealthFactorInitial2);
      await d.controller.setTargetHealthFactor2(targetHealthFactorInitial2);
      await d.controller.setMinHealthFactor2(minHealthFactorInitial2);

      // make borrow
      const amountToBorrow = d.amountToBorrow;

      if (! badPathsParams?.skipBorrow) {
        await d.aavePoolAdapterAsTC.syncBalance(true);
        await IERC20__factory.connect(collateralToken.address, await DeployerUtils.startImpersonate(d.userContract.address))
          .transfer(d.aavePoolAdapterAsTC.address, collateralAmount);
        await d.aavePoolAdapterAsTC.borrow(
          collateralAmount,
          amountToBorrow,
          d.userContract.address // receiver
        );
      }

      const afterBorrow: IAave3UserAccountDataResults = await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address);
      const userBalanceAfterBorrow = await borrowToken.token.balanceOf(d.userContract.address);
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
        ? IPoolAdapter__factory.connect(d.aavePoolAdapterAsTC.address, deployer)
        : d.aavePoolAdapterAsTC;
      await poolAdapterSigner.syncBalance(false);
      await IERC20__factory.connect(
        borrowToken.address,
        await DeployerUtils.startImpersonate(d.userContract.address)
      ).transfer(
        poolAdapterSigner.address,
        expectedAmountToRepay
      );

      await poolAdapterSigner.repayToRebalance(expectedAmountToRepay);

      const afterBorrowToRebalance: IAave3UserAccountDataResults = await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address);
      const userBalanceAfterRepayToRebalance = await borrowToken.token.balanceOf(d.userContract.address);
      console.log("after repay to rebalance:", afterBorrowToRebalance, userBalanceAfterRepayToRebalance);

      return {
        afterBorrow,
        afterBorrowToRebalance,
        userBalanceAfterBorrow,
        userBalanceAfterRepayToRebalance,
        expectedAmountToRepay
      }
    }

    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        const r = await AaveRepayToRebalanceUtils.daiWMatic(
          deployer,
          makeRepayToRebalance,
          targetHealthFactorInitial2,
          targetHealthFactorUpdated2
        );

        expect(r.ret).eq(r.expected);
      });
    });

    describe("Bad paths", () => {
      async function testRepayToRebalanceDaiWMatic(badPathParams?: IMakeRepayRebalanceBadPathParams) {
        await AaveRepayToRebalanceUtils.daiWMatic(
          deployer,
          makeRepayToRebalance,
          targetHealthFactorInitial2,
          targetHealthFactorUpdated2,
          badPathParams
        );
      }
      describe("Not TetuConverter and not user", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            testRepayToRebalanceDaiWMatic({makeRepayToRebalanceAsDeployer: true})
          ).revertedWith("TC-32");
        });
      });
      describe("Position is not registered", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            testRepayToRebalanceDaiWMatic({skipBorrow: true})
          ).revertedWith("TC-11");
        });
      });
      describe("Result health factor is less min allowed one", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            testRepayToRebalanceDaiWMatic({additionalAmountCorrectionFactorDiv: 100})
          ).revertedWith("TC-3: wrong health factor");
        });
      });
      describe("Try to repay amount greater then the debt", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            testRepayToRebalanceDaiWMatic({additionalAmountCorrectionFactorMul: 100})
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