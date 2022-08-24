import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../../scripts/utils/TimeUtils";
import {
  IAavePool, IAavePool__factory,
  IERC20__factory,
  IERC20Extended__factory
} from "../../../../../typechain";
import {expect} from "chai";
import {BigNumber} from "ethers";
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

describe("Aave-v3 integration tests, pool adapter", () => {
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

//region Unit tests
  describe("borrow", () => {
    async function makeTest(
      collateralToken: TokenDataTypes,
      collateralHolder: string,
      collateralAmount: BigNumber,
      borrowToken: TokenDataTypes,
      borrowAmount: BigNumber
    ) : Promise<{sret: string, sexpected: string}>{
      const user = ethers.Wallet.createRandom();
      const tetuConveterStab = ethers.Wallet.createRandom();

      // initialize pool, adapters and helper for the adapters
      const h: Aave3Helper = new Aave3Helper(deployer);
      //const aavePlatformAdapter = await AdaptersHelper.createAave3PlatformAdapter(deployer);
      const aavePoolAdapterAsTC = await AdaptersHelper.createAave3PoolAdapter(
        await DeployerUtils.startImpersonate(tetuConveterStab.address)
      );
      const aavePool = await Aave3Helper.getAavePool(deployer);
      const dp = await Aave3Helper.getAaveProtocolDataProvider(deployer);
      const aavePrices = await Aave3Helper.getAavePriceOracle(deployer);

      // controller: we need TC (as a caller) and DM (to register borrow position)
      const controller = await CoreContractsHelper.createController(deployer);
      const dm = await CoreContractsHelper.createDebtMonitor(deployer, controller);
      const bm = await MocksHelper.createBorrowManagerStub(deployer, true);
      await controller.setBorrowManager(bm.address);
      await controller.setDebtMonitor(dm.address);
      await controller.setTetuConverter(tetuConveterStab.address);

      // collateral asset
      await collateralToken.token
        .connect(await DeployerUtils.startImpersonate(collateralHolder))
        .transfer(deployer.address, collateralAmount);
      const collateralData = await h.getReserveInfo(deployer, aavePool, dp, collateralToken.address);

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
      await aavePoolAdapterAsTC.borrow(
        collateralAmount,
        borrowAmount,
        user.address
      );

      // prices of assets in base currency
      const prices = await aavePrices.getAssetsPrices([collateralToken.address, borrowToken.address]);

      // check results
      const ret = await aavePool.getUserAccountData(aavePoolAdapterAsTC.address);

      const sret = [
        await borrowToken.token.balanceOf(user.address),
        await IERC20Extended__factory.connect(collateralData.data.aTokenAddress, deployer)
          .balanceOf(aavePoolAdapterAsTC.address),
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
    describe("Good paths", () => {
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

            const r = await makeTest(
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

            const r = await makeTest(
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

            const r = await makeTest(
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

            const r = await makeTest(
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
      aavePool: string
      , borrowHolders: string[]
      , borrowAsset: string
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
      user: string
      , collateralHolders: string[]
      , collateralAsset: string
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

    async function getMaxAmountToBorrow(collateralDataBefore: ReserveInfo) : Promise<BigNumber> {
      // get max allowed amount to borrow
      // amount = (debt-ceiling - total-isolation-debt) * 10^{6 - 2}
      // see aave-v3-core: validateBorrow()
      const debtCeiling = collateralDataBefore.data.debtCeiling;
      const totalIsolationDebt = collateralDataBefore.data.isolationModeTotalDebt;
      const decimalsBorrow = collateralDataBefore.data.decimals;
      const precisionDebtCeiling = 2; //Aave3ReserveConfiguration.DEBT_CEILING_DECIMALS
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
      aavePool: IAavePool
      , user: SignerWithAddress
      , borrowAmount: BigNumber
      , collateralAsset: string
      , borrowAsset: string
    ) {
      // user1 supplies the collateral
      const userCollateralBalance = await IERC20__factory.connect(collateralAsset, user).balanceOf(user.address);
      const collateralAmount = userCollateralBalance; //getBigNumberFrom(collateralAmountNumber, collateralDataBefore.data.decimals);

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
//endregion Utils
    describe("Good paths", () => {
      describe("USDT : DAI", () => {
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
        describe("Try to borrow max amount allowed by debt ceiling", () => {
          it("should return expected values", async () => {
            const user = await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address);

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
            const maxBorrowAmount = await getMaxAmountToBorrow(collateralDataBefore);

            // get conversion strategy from tetu converter
            const controller = await CoreContractsHelper.createController(deployer);
            const templateAdapterStub = ethers.Wallet.createRandom().address;

            const pa = await AdaptersHelper.createAave3PlatformAdapter(deployer
              , controller.address
              , aavePool.address
              , templateAdapterStub
              , templateAdapterStub
            );
            const plan = await pa.getConversionPlan(collateralAsset, borrowAsset, 0);

            // now, let's ensure that we can borrow max amount
            const borrowAmount = maxBorrowAmount //.add(DELTA)
              .mul(getBigNumberFrom(1, borrowDataBefore.data.decimals))
              .div(getBigNumberFrom(1, collateralDataBefore.data.decimals))
            ; //getBigNumberFrom(borrowAmountNumber, borrowDataBefore.data.decimals);
            console.log("Max amount to borrow", maxBorrowAmount);
            console.log("Amount to borrow", borrowAmount);

            await makeBorrow(aavePool, user, borrowAmount, collateralAsset, borrowAsset);

            // after borrow
            const collateralDataAfter = await h.getReserveInfo(user, aavePool, dp, collateralAsset);
            console.log("collateralDataAfter", collateralDataAfter);
            console.log("isolationModeTotalDebt delta"
              , BigNumber.from(collateralDataAfter.data.isolationModeTotalDebt)
                .sub(BigNumber.from(collateralDataBefore.data.isolationModeTotalDebt))
            );

            const sret = maxBorrowAmount.toString();
            const sexpected = plan.maxAmountToBorrowBT.toString();

            expect(sret).eq(sexpected);
          });
        });
      });
    });

    describe("Bad paths", () => {
      describe("Debt ceiling exceeded", () => {
        describe("USDT : DAI", () => {
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
          it("should revert", async () => {
            const user = await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address);

            const aavePool = await Aave3Helper.getAavePool(user);
            const dp = await Aave3Helper.getAaveProtocolDataProvider(user);

            await supplyEnoughBorrowAssetToAavePool(aavePool.address, borrowHolders, borrowAsset);
            await takeCollateralFromHolders(user.address, collateralHolders, collateralAsset);

            // take collateral status before supply
            const h: Aave3Helper = new Aave3Helper(user);
            const collateralDataBefore = await h.getReserveInfo(user, aavePool, dp, collateralAsset);
            const borrowDataBefore = await h.getReserveInfo(user, aavePool, dp, borrowAsset);
            console.log("collateralDataBefore", collateralDataBefore);

            // get conversion strategy from tetu converter
            const controller = await CoreContractsHelper.createController(deployer);
            const templateAdapterStub = ethers.Wallet.createRandom().address;

            const pa = await AdaptersHelper.createAave3PlatformAdapter(deployer
              , controller.address
              , aavePool.address
              , templateAdapterStub
              , templateAdapterStub
            );
            const plan = await pa.getConversionPlan(collateralAsset, borrowAsset, 0);

            // now, let's ensure that we can borrow max amount
            const DELTA = BigNumber.from(1e6); // $1
            const borrowAmount = plan.maxAmountToBorrowBT.add(DELTA)
              .mul(getBigNumberFrom(1, borrowDataBefore.data.decimals))
              .div(getBigNumberFrom(1, collateralDataBefore.data.decimals))
            ; //getBigNumberFrom(borrowAmountNumber, borrowDataBefore.data.decimals);
            console.log("borrow amount", borrowAmount.toString());

            // AAVE3: constant DEBT_CEILING_EXCEEDED = '53'; // 'Debt ceiling is exceeded'
            await expect(
              makeBorrow(aavePool, user, borrowAmount, collateralAsset, borrowAsset)
            ).revertedWith("VM Exception while processing transaction: reverted with reason string '53'");
          });
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
      //const aavePlatformAdapter = await AdaptersHelper.createAave3PlatformAdapter(deployer);
      const aavePoolAdapterAsTC = await AdaptersHelper.createAave3PoolAdapter(
        await DeployerUtils.startImpersonate(tetuConveterStab.address)
      );
      const aavePool = await Aave3Helper.getAavePool(deployer);
      const dp = await Aave3Helper.getAaveProtocolDataProvider(deployer);
      const aavePrices = await Aave3Helper.getAavePriceOracle(deployer);

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