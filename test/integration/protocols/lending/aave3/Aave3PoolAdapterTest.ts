import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../../scripts/utils/TimeUtils";
import {
  Aave3PoolAdapter,
  Controller,
  IAavePool, IAavePool__factory, IAavePriceOracle, IAaveProtocolDataProvider,
  IERC20__factory,
  IERC20Extended__factory, IPoolAdapter__factory
} from "../../../../../typechain";
import {expect} from "chai";
import {BigNumber, Wallet} from "ethers";
import {getBigNumberFrom} from "../../../../../scripts/utils/NumberUtils";
import {DeployerUtils} from "../../../../../scripts/utils/DeployerUtils";
import {AdaptersHelper} from "../../../../baseUT/helpers/AdaptersHelper";
import {isPolygonForkInUse} from "../../../../baseUT/utils/NetworkUtils";
import {Aave3Helper, ReserveInfo} from "../../../../../scripts/integration/helpers/Aave3Helper";
import {BalanceUtils, IUserBalances} from "../../../../baseUT/utils/BalanceUtils";
import {CoreContractsHelper} from "../../../../baseUT/helpers/CoreContractsHelper";
import {MaticAddresses} from "../../../../../scripts/addresses/MaticAddresses";
import {MocksHelper} from "../../../../baseUT/helpers/MocksHelper";
import {TokenDataTypes} from "../../../../baseUT/types/TokenDataTypes";
import {Misc} from "../../../../../scripts/utils/Misc";
import {IAave3UserAccountDataResults} from "../../../../baseUT/apr/aprAave3";
import {CompareAprUsesCase} from "../../../../baseUT/uses-cases/CompareAprUsesCase";

describe("Aave3PoolAdapterTest", () => {
//region Constants

//endregion Constants

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
    h: Aave3Helper;

    aavePoolAdapterAsTC: Aave3PoolAdapter;
    aavePool: IAavePool;
    dataProvider: IAaveProtocolDataProvider;
    aavePrices: IAavePriceOracle;

    controller: Controller;

    amountToBorrow: BigNumber;
  }

  /**
   * Initialize TetuConverter app and aave pool adapter.
   * Put the collateral amount on pool-adapter's balance.
   */
  async function prepareToBorrow(
    collateralToken: TokenDataTypes,
    collateralHolder: string,
    collateralAmount: BigNumber,
    borrowToken: TokenDataTypes,
    targetHealthFactor2?: number
  ) : Promise<IPrepareToBorrowResults> {
    const user = ethers.Wallet.createRandom();
    const tetuConveterStub = ethers.Wallet.createRandom();
    const templateAdapterNormalStub = ethers.Wallet.createRandom().address;
    const templateAdapterHighEfficientModeStub = ethers.Wallet.createRandom().address;

    // initialize pool, adapters and helper for the adapters
    const h: Aave3Helper = new Aave3Helper(deployer);
    const aavePoolAdapterAsTC = await AdaptersHelper.createAave3PoolAdapter(
      await DeployerUtils.startImpersonate(tetuConveterStub.address)
    );

    const aavePool = await Aave3Helper.getAavePool(deployer);
    const dataProvider = await Aave3Helper.getAaveProtocolDataProvider(deployer);
    const aavePrices = await Aave3Helper.getAavePriceOracle(deployer);

    // controller: we need TC (as a caller) and DM (to register borrow position)
    const controller = await CoreContractsHelper.createController(deployer);
    const dm = await CoreContractsHelper.createDebtMonitor(deployer, controller);
    const bm = await MocksHelper.createBorrowManagerStub(deployer, true);
    await controller.setBorrowManager(bm.address);
    await controller.setDebtMonitor(dm.address);
    await controller.setTetuConverter(tetuConveterStub.address);

    const aavePlatformAdapter = await AdaptersHelper.createAave3PlatformAdapter(
      deployer, controller.address, aavePool.address, templateAdapterNormalStub, templateAdapterHighEfficientModeStub
    );

    // put collateral amount on deployer's balance
    await collateralToken.token
      .connect(await DeployerUtils.startImpersonate(collateralHolder))
      .transfer(deployer.address, collateralAmount);
    const collateralData = await h.getReserveInfo(deployer, aavePool, dataProvider, collateralToken.address);

    // make borrow
    await aavePoolAdapterAsTC.initialize(
      controller.address,
      aavePool.address,
      user.address,
      collateralToken.address,
      borrowToken.address,
      aavePoolAdapterAsTC.address
    );
    await aavePoolAdapterAsTC.syncBalance(true);
    await collateralToken.token.transfer(aavePoolAdapterAsTC.address, collateralAmount);

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
      user,
      aavePrices,
      aavePool,
      aavePoolAdapterAsTC,
      dataProvider,
      amountToBorrow: plan.amountToBorrow
    }
  }
//endregion Test impl

//region Unit tests
  describe("borrow", () => {
    describe("Good paths", () => {
      async function makeTestBorrowFixedAmount(
        collateralToken: TokenDataTypes,
        collateralHolder: string,
        collateralAmount: BigNumber,
        borrowToken: TokenDataTypes,
        borrowAmount: BigNumber
      ) : Promise<{sret: string, sexpected: string}>{
        const d = await prepareToBorrow(
          collateralToken,
          collateralHolder,
          collateralAmount,
          borrowToken
        );
        const collateralData = await d.h.getReserveInfo(deployer, d.aavePool, d.dataProvider, collateralToken.address);

        await d.aavePoolAdapterAsTC.borrow(
          collateralAmount,
          borrowAmount,
          d.user.address
        );

        // prices of assets in base currency
        const prices = await d.aavePrices.getAssetsPrices([collateralToken.address, borrowToken.address]);

        // check results
        const ret = await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address);

        const sret = [
          await borrowToken.token.balanceOf(d.user.address),
          await IERC20Extended__factory.connect(collateralData.data.aTokenAddress, deployer)
            .balanceOf(d.aavePoolAdapterAsTC.address),
          ret.totalCollateralBase,
          ret.totalDebtBase
        ].map(x => BalanceUtils.toString(x)).join("\n");

        const sexpected = [
          borrowAmount, // borrowed amount on user's balance
          collateralAmount, // amount of collateral tokens on pool-adapter's balance
          collateralAmount.mul(prices[0])  // registered collateral in the pool
            .div(getBigNumberFrom(1, collateralToken.decimals)),
          borrowAmount.mul(prices[1]) // registered debt in the pool
            .div(getBigNumberFrom(1, borrowToken.decimals)),
        ].map(x => BalanceUtils.toString(x)).join("\n");

        return {sret, sexpected};
      }
      async function makeTestBorrowMaxAmount(
        collateralToken: TokenDataTypes,
        collateralHolder: string,
        collateralAmount: BigNumber,
        borrowToken: TokenDataTypes,
      ) : Promise<{sret: string, sexpected: string}>{
        const minHealthFactor2 = 101;
        const targetHealthFactor2 = 202;
        const d = await prepareToBorrow(
          collateralToken,
          collateralHolder,
          collateralAmount,
          borrowToken,
          targetHealthFactor2
        );
        await d.controller.setMinHealthFactor2(minHealthFactor2);
        await d.controller.setTargetHealthFactor2(targetHealthFactor2);
        const collateralData = await d.h.getReserveInfo(deployer, d.aavePool, d.dataProvider, collateralToken.address);
        console.log("collateralData", collateralData);

        // prices of assets in base currency
        const prices = await d.aavePrices.getAssetsPrices([collateralToken.address, borrowToken.address]);
        const baseCurrencyUnit = await d.aavePrices.BASE_CURRENCY_UNIT();
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

        await d.aavePoolAdapterAsTC.borrow(
          collateralAmount,
          maxAllowedAmountToBorrow,
          d.user.address
        );
        console.log("amountToBorrow", maxAllowedAmountToBorrow);

        // check results
        const ret = await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address);
        console.log(ret);

        const sret = [
          ret.totalCollateralBase.mul(prices[0]).mul(getBigNumberFrom(1, collateralToken.decimals)).div(Misc.WEI),
          ret.totalDebtBase.mul(prices[1]).mul(getBigNumberFrom(1, collateralToken.decimals)).div(Misc.WEI),
          ret.availableBorrowsBase.mul(prices[1]).mul(getBigNumberFrom(1, collateralToken.decimals)).div(Misc.WEI),
          ret.healthFactor.div(getBigNumberFrom(1, 16))
        ].map(x => BalanceUtils.toString(x)).join("\n");

        const sexpected = [
          collateralAmount,
          d.amountToBorrow,
          0,
          targetHealthFactor2
        ].map(x => BalanceUtils.toString(x)).join("\n");

        return {sret, sexpected};
      }
      describe("Borrow modest amount", () => {
        describe("DAI-18 : matic-18", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;

            const collateralAsset = MaticAddresses.DAI;
            const collateralHolder = MaticAddresses.HOLDER_DAI;
            const borrowAsset = MaticAddresses.WMATIC;

            const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
            const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

            const collateralAmount = getBigNumberFrom(100_000, collateralToken.decimals);
            const borrowAmount = getBigNumberFrom(10, borrowToken.decimals);

            const r = await makeTestBorrowFixedAmount(
              collateralToken
              , collateralHolder
              , collateralAmount
              , borrowToken
              , borrowAmount
            );
            expect(r.sret).eq(r.sexpected);
          });
        });
        describe("DAI-18 : USDC-6", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;

            const collateralAsset = MaticAddresses.DAI;
            const collateralHolder = MaticAddresses.HOLDER_DAI;
            const borrowAsset = MaticAddresses.USDC;

            const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
            const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

            const collateralAmount = getBigNumberFrom(100_000, collateralToken.decimals);
            const borrowAmount = getBigNumberFrom(10, borrowToken.decimals);

            const r = await makeTestBorrowFixedAmount(
              collateralToken
              , collateralHolder
              , collateralAmount
              , borrowToken
              , borrowAmount
            );
            expect(r.sret).eq(r.sexpected);
          });
        });
        describe("STASIS EURS-2 : Tether-6", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;

            const collateralAsset = MaticAddresses.EURS;
            const collateralHolder = MaticAddresses.HOLDER_EURS;
            const borrowAsset = MaticAddresses.USDT;

            const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
            const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

            const collateralAmount = getBigNumberFrom(100_000, collateralToken.decimals);
            const borrowAmount = getBigNumberFrom(10, borrowToken.decimals);

            const r = await makeTestBorrowFixedAmount(
              collateralToken
              , collateralHolder
              , collateralAmount
              , borrowToken
              , borrowAmount
            );
            expect(r.sret).eq(r.sexpected);
          });
        });
        describe("USDC-6 : DAI-18", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;

            const collateralAsset = MaticAddresses.USDC;
            const collateralHolder = MaticAddresses.HOLDER_USDC;
            const borrowAsset = MaticAddresses.DAI;

            const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
            const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

            const collateralAmount = getBigNumberFrom(100_000, collateralToken.decimals);
            const borrowAmount = getBigNumberFrom(10, borrowToken.decimals);

            const r = await makeTestBorrowFixedAmount(
              collateralToken
              , collateralHolder
              , collateralAmount
              , borrowToken
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
      describe.skip('Try to borrow max allowed amount and see results in console', function () {
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
      collateralDataBefore: ReserveInfo,
      borrowDataBefore: ReserveInfo
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

    interface IMakeTestBorrowToRebalanceResults {
      afterBorrow: IAave3UserAccountDataResults;
      afterBorrowToRebalance: IAave3UserAccountDataResults;
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
      collateralAmount: BigNumber,
      borrowToken: TokenDataTypes,
      badPathsParams?: IMakeTestBorrowToRebalanceBadPathParams
    ) : Promise<IMakeTestBorrowToRebalanceResults>{
      const d = await prepareToBorrow(
        collateralToken,
        collateralHolder,
        collateralAmount,
        borrowToken,
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
        await d.aavePoolAdapterAsTC.borrow(
          collateralAmount,
          amountToBorrow,
          d.user.address // receiver
        );
      }
      const afterBorrow: IAave3UserAccountDataResults = await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address);
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
        ? IPoolAdapter__factory.connect(d.aavePoolAdapterAsTC.address, deployer)
        : d.aavePoolAdapterAsTC;
      await poolAdapterSigner.borrowToRebalance(
        expectedAdditionalBorrowAmount,
        d.user.address // receiver
      );

      const afterBorrowToRebalance: IAave3UserAccountDataResults = await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address);
      const userBalanceAfterBorrowToRebalance = await borrowToken.token.balanceOf(d.user.address);
      console.log("after borrow to rebalance:", afterBorrowToRebalance, userBalanceAfterBorrowToRebalance);

      return {
        afterBorrow,
        afterBorrowToRebalance,
        userBalanceAfterBorrow,
        userBalanceAfterBorrowToRebalance,
        expectedAdditionalBorrowAmount
      }
    }
    async function testDaiWMatic(
      badPathParams?: IMakeTestBorrowToRebalanceBadPathParams
    ) : Promise<IMakeTestBorrowToRebalanceResults> {
      const collateralAsset = MaticAddresses.DAI;
      const collateralHolder = MaticAddresses.HOLDER_DAI;
      const borrowAsset = MaticAddresses.WMATIC;

      const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
      const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);
      console.log("collateralToken.decimals", collateralToken.decimals);
      console.log("borrowToken.decimals", borrowToken.decimals);

      const collateralAmount = getBigNumberFrom(100_000, collateralToken.decimals);
      console.log(collateralAmount, collateralAmount);

      const r = await makeTestBorrowToRebalance(
        collateralToken
        , collateralHolder
        , collateralAmount
        , borrowToken
        , badPathParams
      );

      console.log(r);
      return r;
    }
    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        const r = await testDaiWMatic();
        const ret = [
          Math.round(r.afterBorrow.healthFactor.div(getBigNumberFrom(1, 15)).toNumber() / 10.),
          Math.round(r.afterBorrowToRebalance.healthFactor.div(getBigNumberFrom(1, 15)).toNumber() / 10.),
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
      describe.skip("Wrong borrow balance - how to check it?", () => {
        // it("should revert", async () => {
        //   if (!await isPolygonForkInUse()) return;
        //   await expect(
        //     testDaiWMatic({skipBorrow: true})
        //   ).revertedWith("TC-11");
        // });
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

  describe("repay", () =>{
    async function makeTest(
      collateralToken: TokenDataTypes,
      collateralHolder: string,
      collateralAmount: BigNumber,
      borrowToken: TokenDataTypes,
      borrowHolder: string,
      borrowAmount: BigNumber,
      initialBorrowAmountOnUserBalance: BigNumber,
      amountToRepay: BigNumber,
      closePosition: boolean
    ) : Promise<{
      userBalancesBeforeBorrow: IUserBalances,
      userBalancesAfterBorrow: IUserBalances,
      userBalancesAfterRepay: IUserBalances,
      paATokensBalance: BigNumber,
      totalCollateralBase: BigNumber,
      totalDebtBase: BigNumber
    }>{
      const user = ethers.Wallet.createRandom();
      const tetuConveterStab = ethers.Wallet.createRandom();

      // initialize pool, adapters and helper for the adapters
      const h: Aave3Helper = new Aave3Helper(deployer);
      const aavePoolAdapterAsTC = await AdaptersHelper.createAave3PoolAdapter(
        await DeployerUtils.startImpersonate(tetuConveterStab.address)
      );
      const aavePool = await Aave3Helper.getAavePool(deployer);
      const dp = await Aave3Helper.getAaveProtocolDataProvider(deployer);

      // controller: we need TC (as a caller) and DM (to register borrow position)
      const controller = await CoreContractsHelper.createController(deployer);
      const dm = await CoreContractsHelper.createDebtMonitor(deployer, controller);
      const bm = await MocksHelper.createBorrowManagerStub(deployer, true);
      console.log("bm", bm.address);
      await controller.setBorrowManager(bm.address);
      await controller.setDebtMonitor(dm.address);
      await controller.setTetuConverter(tetuConveterStab.address);

      // collateral asset
      await collateralToken.token
        .connect(await DeployerUtils.startImpersonate(collateralHolder))
        .transfer(user.address, collateralAmount);
      const collateralData = await h.getReserveInfo(deployer, aavePool, dp, collateralToken.address);

      // borrow asset
      if (initialBorrowAmountOnUserBalance) {
        await borrowToken.token
          .connect(await DeployerUtils.startImpersonate(borrowHolder))
          .transfer(user.address, initialBorrowAmountOnUserBalance);
      }

      const beforeBorrow: IUserBalances = {
        collateral: await collateralToken.token.balanceOf(user.address),
        borrow: await borrowToken.token.balanceOf(user.address)
      };

      // make borrow
      await aavePoolAdapterAsTC.initialize(
        controller.address,
        aavePool.address,
        user.address,
        collateralToken.address,
        borrowToken.address,
        aavePoolAdapterAsTC.address
      );
      await aavePoolAdapterAsTC.syncBalance(true);
      await IERC20Extended__factory.connect(collateralToken.address
        , await DeployerUtils.startImpersonate(user.address)
      ).transfer(aavePoolAdapterAsTC.address, collateralAmount);
      await aavePoolAdapterAsTC.borrow(
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
      await aavePoolAdapterAsTC.syncBalance(false);
      await IERC20Extended__factory.connect(borrowToken.address
        , await DeployerUtils.startImpersonate(user.address)
      ).transfer(aavePoolAdapterAsTC.address, amountToRepay);

      await aavePoolAdapterAsTC.repay(
        amountToRepay,
        user.address,
        closePosition
      );

      // check results
      const afterRepay: IUserBalances = {
        collateral: await collateralToken.token.balanceOf(user.address),
        borrow: await borrowToken.token.balanceOf(user.address)
      };
      const ret = await aavePool.getUserAccountData(aavePoolAdapterAsTC.address);

      return {
        userBalancesBeforeBorrow: beforeBorrow,
        userBalancesAfterBorrow: afterBorrow,
        userBalancesAfterRepay: afterRepay,
        paATokensBalance: await IERC20Extended__factory.connect(collateralData.data.aTokenAddress, deployer)
          .balanceOf(aavePoolAdapterAsTC.address),
        totalCollateralBase: ret.totalCollateralBase,
        totalDebtBase: ret.totalDebtBase
      }
    }
    describe("Good paths", () =>{
      describe("Borrow and repay modest amount", () =>{
        describe("Repay borrow amount without interest", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;

            const collateralAsset = MaticAddresses.DAI;
            const collateralHolder = MaticAddresses.HOLDER_DAI;
            const borrowAsset = MaticAddresses.WMATIC;
            const borrowHolder = MaticAddresses.HOLDER_WMATIC;

            const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
            const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

            const collateralAmount = getBigNumberFrom(100_000, collateralToken.decimals);
            const borrowAmount = getBigNumberFrom(10, borrowToken.decimals);

            const r = await makeTest(
              collateralToken
              , collateralHolder
              , collateralAmount
              , borrowToken
              , borrowHolder
              , borrowAmount
              , getBigNumberFrom(0) // initially user don't have any tokens on balance
              , borrowAmount
              , false
            );

            const sret = [
              r.userBalancesBeforeBorrow.collateral, r.userBalancesBeforeBorrow.borrow
              , r.userBalancesAfterBorrow.collateral, r.userBalancesAfterBorrow.borrow

              // original collateral > returned collateral ...
              , collateralAmount.gt(r.userBalancesAfterRepay.collateral)
              // ... the difference is less than 1%
              , collateralAmount.sub(r.userBalancesAfterRepay.collateral)
                .div(collateralAmount)
                .mul(100).toNumber() < 1
              , r.userBalancesAfterRepay.borrow
            ].map(x => BalanceUtils.toString(x)).join();

            const sexpected = [
              collateralAmount, 0
              , 0, borrowAmount

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