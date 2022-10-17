import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../../scripts/utils/TimeUtils";
import {
  Controller, DForcePlatformAdapter, DForcePoolAdapter, IDForceController,
  IDForceCToken__factory, IDForcePriceOracle,
  IERC20Extended__factory,
} from "../../../../../typechain";
import {expect} from "chai";
import {BigNumber, Wallet} from "ethers";
import {getBigNumberFrom} from "../../../../../scripts/utils/NumberUtils";
import {DeployerUtils} from "../../../../../scripts/utils/DeployerUtils";
import {AdaptersHelper} from "../../../../baseUT/helpers/AdaptersHelper";
import {isPolygonForkInUse} from "../../../../baseUT/utils/NetworkUtils";
import {BalanceUtils, IUserBalances} from "../../../../baseUT/utils/BalanceUtils";
import {CoreContractsHelper} from "../../../../baseUT/helpers/CoreContractsHelper";
import {MaticAddresses} from "../../../../../scripts/addresses/MaticAddresses";
import {MocksHelper} from "../../../../baseUT/helpers/MocksHelper";
import {TokenDataTypes} from "../../../../baseUT/types/TokenDataTypes";
import {DForceHelper, IDForceMarketData} from "../../../../../scripts/integration/helpers/DForceHelper";
import {Misc} from "../../../../../scripts/utils/Misc";
import {CompareAprUsesCase} from "../../../../baseUT/uses-cases/CompareAprUsesCase";

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
    user: Wallet;
    dfPoolAdapterTC: DForcePoolAdapter;
    dfPlatformAdapter: DForcePlatformAdapter;
    priceOracle: IDForcePriceOracle;
    comptroller: IDForceController;

    controller: Controller;

    amountToBorrow: BigNumber;
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
    collateralCToken: string,
    collateralAmount: BigNumber,
    borrowToken: TokenDataTypes,
    borrowCToken: string,
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
    const dfPoolAdapterTC = await AdaptersHelper.createDForcePoolAdapter(
      await DeployerUtils.startImpersonate(tetuConveterStab.address)
    );
    const comptroller = await DForceHelper.getController(deployer);
    const dfPlatformAdapter = await AdaptersHelper.createDForcePlatformAdapter(
      deployer,
      controller.address,
      comptroller.address,
      dfPoolAdapterTC.address,
      [collateralCToken, borrowCToken],
    )
    const priceOracle = await DForceHelper.getPriceOracle(comptroller, deployer);

    // collateral asset
    await collateralToken.token
      .connect(await DeployerUtils.startImpersonate(collateralHolder))
      .transfer(deployer.address, collateralAmount);

    // initialize pool adapter
    await dfPoolAdapterTC.initialize(
      controller.address,
      dfPlatformAdapter.address,
      comptroller.address,
      user.address,
      collateralToken.address,
      borrowToken.address,
      dfPoolAdapterTC.address
    );

    // prepare to borrow
    await dfPoolAdapterTC.syncBalance(true);
    await collateralToken.token.transfer(dfPoolAdapterTC.address, collateralAmount);

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
      user,
      priceOracle,
    }
  }

  async function getMarketsInfo(
    d: IPrepareToBorrowResults,
    collateralCToken: string,
    borrowCToken: string
  ) : Promise<IMarketsInfo> {
    // tokens data
    const borrowData = await DForceHelper.getCTokenData(deployer, d.comptroller
      , IDForceCToken__factory.connect(borrowCToken, deployer)
    );
    const collateralData = await DForceHelper.getCTokenData(deployer, d.comptroller
      , IDForceCToken__factory.connect(collateralCToken, deployer)
    );

    // prices of assets in base currency
    // From sources: The underlying asset price mantissa (scaled by 1e18).
    // WRONG: The price of the asset in USD as an unsigned integer scaled up by 10 ^ (36 - underlying asset decimals).
    // WRONG: see https://compound.finance/docs/prices#price
    const priceCollateral = await d.priceOracle.getUnderlyingPrice(collateralCToken);
    const priceBorrow = await d.priceOracle.getUnderlyingPrice(borrowCToken);
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

      await d.dfPoolAdapterTC.borrow(
        collateralAmount,
        borrowAmount,
        d.user.address
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

      const retBalanceBorrowUser = await borrowToken.token.balanceOf(d.user.address);
      const retBalanceCollateralTokensPoolAdapter = await IERC20Extended__factory.connect(
        collateralCToken.address, deployer
      ).balanceOf(d.dfPoolAdapterTC.address);

      const expectedLiquiditiy = getExpectedLiquidity(
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
        collateralAmount
          .mul(Misc.WEI)
          .div(info.collateralData.exchangeRateStored),
        expectedLiquiditiy,
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
            const collateralCTokenAddress = MaticAddresses.dForce_iDAI;

            const borrowAsset = MaticAddresses.USDC;
            const borrowCTokenAddress = MaticAddresses.dForce_iUSDC;

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
      const dfPoolAdapterTC = await AdaptersHelper.createDForcePoolAdapter(
        await DeployerUtils.startImpersonate(tetuConveterStab.address)
      );
      const comptroller = await DForceHelper.getController(deployer);
      const dfPlatformAdapter = await AdaptersHelper.createDForcePlatformAdapter(
        deployer,
        controller.address,
        comptroller.address,
        dfPoolAdapterTC.address,
        [collateralCToken.address, borrowCToken.address],
      )

      // collateral asset
      await collateralToken.token
        .connect(await DeployerUtils.startImpersonate(collateralHolder))
        .transfer(user.address, collateralAmount);

      // initialize pool adapter
      await dfPoolAdapterTC.initialize(
        controller.address,
        dfPlatformAdapter.address,
        comptroller.address,
        user.address,
        collateralToken.address,
        borrowToken.address,
        dfPoolAdapterTC.address
      );

      const beforeBorrow: IUserBalances = {
        collateral: await collateralToken.token.balanceOf(user.address),
        borrow: await borrowToken.token.balanceOf(user.address)
      };

      // make borrow
      await dfPoolAdapterTC.syncBalance(true);
      await IERC20Extended__factory.connect(collateralToken.address
        , await DeployerUtils.startImpersonate(user.address)
      ).transfer(dfPoolAdapterTC.address, collateralAmount);

      await dfPoolAdapterTC.borrow(
        collateralAmount,
        borrowAmount,
        user.address
      );
      console.log("Borrowed amount", borrowAmount);
      const statusAfterBorrow = await dfPoolAdapterTC.getStatus();
      console.log("statusAfterBorrow", statusAfterBorrow);

      const afterBorrow: IUserBalances = {
        collateral: await collateralToken.token.balanceOf(user.address),
        borrow: await borrowToken.token.balanceOf(user.address)
      };
      console.log(afterBorrow);

      // make repay
      await dfPoolAdapterTC.syncBalance(false);
      await IERC20Extended__factory.connect(borrowToken.address
        , await DeployerUtils.startImpersonate(user.address)
      ).transfer(dfPoolAdapterTC.address, amountToRepay);
      console.log("Amount to repay", amountToRepay);

      await dfPoolAdapterTC.repay(
        amountToRepay,
        user.address,
        closePosition
      );
      console.log("repay is done");
      const statusAfterRepay = await dfPoolAdapterTC.getStatus();
      console.log("statusAfterRepay", statusAfterRepay);

      // check results
      const afterRepay: IUserBalances = {
        collateral: await collateralToken.token.balanceOf(user.address),
        borrow: await borrowToken.token.balanceOf(user.address)
      };
      const cTokenCollateral = await IDForceCToken__factory.connect(collateralCToken.address, deployer);
      const cTokenBorrow = await IDForceCToken__factory.connect(borrowCToken.address, deployer);

      const bBorrowBalance = await IDForceCToken__factory.connect(borrowCToken.address, deployer)
        .borrowBalanceStored(dfPoolAdapterTC.address);
      const cTokenBalance = await IDForceCToken__factory.connect(collateralCToken.address, deployer)
        .balanceOf(dfPoolAdapterTC.address);

      return {
        userBalancesBeforeBorrow: beforeBorrow,
        userBalancesAfterBorrow: afterBorrow,
        userBalancesAfterRepay: afterRepay,
        paCTokensBalance: await cTokenCollateral.balanceOf(dfPoolAdapterTC.address),
        totalCollateralBase: cTokenBalance,
        totalDebtBase: bBorrowBalance
      }
    }
    describe("Good paths", () => {
      describe("Borrow and repay modest amount", () =>{
        describe("Repay borrow amount without interest", () => {
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
            console.log(`r`, r);
            const sret = [
              r.userBalancesBeforeBorrow.collateral, r.userBalancesBeforeBorrow.borrow
              , r.userBalancesAfterBorrow.collateral, r.userBalancesAfterBorrow.borrow
              ,                                       r.userBalancesAfterRepay.borrow

              // ... the difference is less than 1%
              , collateralAmount.sub(r.userBalancesAfterRepay.collateral)
                .div(collateralAmount)
                .mul(100).toNumber() < 1
              , r.userBalancesAfterRepay.borrow
            ].map(x => BalanceUtils.toString(x)).join("\n");

            const sexpected = [
              collateralAmount, 0
              , 0, borrowAmount
              ,                 0

              , true // the difference is less than 1%
              , 0
            ].map(x => BalanceUtils.toString(x)).join("\n");

            expect(sret).eq(sexpected);
          });
        });
      });
    });
    describe("Bad paths", () => {

    });

  });

//endregion Unit tests

});