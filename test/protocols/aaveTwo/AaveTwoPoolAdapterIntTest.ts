import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {
  AaveTwoPoolAdapter__factory,
  BorrowManager__factory,
  IERC20Extended__factory,
  IPoolAdapter__factory
} from "../../../typechain";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";
import {BalanceUtils, IUserBalances} from "../../baseUT/utils/BalanceUtils";
import {AaveTwoHelper, IAaveTwoReserveInfo} from "../../../scripts/integration/helpers/AaveTwoHelper";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {TokenDataTypes} from "../../baseUT/types/TokenDataTypes";
import {IAaveTwoUserAccountDataResults} from "../../baseUT/apr/aprAaveTwo";
import {
  AaveMakeBorrowAndRepayUtils, IBorrowAndRepayBadParams,
  IMakeBorrowAndRepayResults
} from "../../baseUT/protocols/aaveShared/aaveBorrowAndRepayUtils";
import {
  AaveRepayToRebalanceUtils,
  IMakeRepayToRebalanceResults
} from "../../baseUT/protocols/aaveShared/aaveRepayToRebalanceUtils";
import {
  AaveBorrowToRebalanceUtils,
  IMakeBorrowToRebalanceBadPathParams,
  IMakeBorrowToRebalanceResults
} from "../../baseUT/protocols/aaveShared/aaveBorrowToRebalanceUtils";
import {AaveBorrowUtils} from "../../baseUT/protocols/aaveShared/aaveBorrowUtils";
import {
  IMakeRepayRebalanceBadPathParams,
  IMakeRepayToRebalanceInputParams
} from "../../baseUT/protocols/shared/sharedDataTypes";
import {SharedRepayToRebalanceUtils} from "../../baseUT/protocols/shared/sharedRepayToRebalanceUtils";
import {makeInfinityApprove, transferAndApprove} from "../../baseUT/utils/transferUtils";
import {AaveTwoTestUtils} from "../../baseUT/protocols/aaveTwo/AaveTwoTestUtils";
import {AdaptersHelper} from "../../baseUT/helpers/AdaptersHelper";
import {Misc} from "../../../scripts/utils/Misc";
import {TetuConverterApp} from "../../baseUT/helpers/TetuConverterApp";
import {MocksHelper} from "../../baseUT/helpers/MocksHelper";
import {parseUnits} from "ethers/lib/utils";
import {areAlmostEqual} from "../../baseUT/utils/CommonUtils";

describe("AaveTwoPoolAdapterIntTest", () => {
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
    async function makeBorrow(
      collateralToken: TokenDataTypes,
      collateralHolder: string,
      collateralAmountRequired: BigNumber | undefined,
      borrowToken: TokenDataTypes,
      borrowAmountRequired: BigNumber | undefined
    ) : Promise<{sret: string, sexpected: string}>{
      const minHealthFactor2 = 101;
      const targetHealthFactor2 = 202;

      const d = await AaveTwoTestUtils.prepareToBorrow(
        deployer,
        collateralToken,
        collateralHolder,
        collateralAmountRequired,
        borrowToken,
        targetHealthFactor2
      );

      await d.controller.setMinHealthFactor2(minHealthFactor2);
      await d.controller.setTargetHealthFactor2(targetHealthFactor2);

      const borrowResults = await AaveTwoTestUtils.makeBorrow(deployer, d, borrowAmountRequired);

      // check results
      const ret = await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address);

      const sret = [
        await borrowToken.token.balanceOf(d.userContract.address),
        await IERC20Extended__factory.connect(borrowResults.collateralData.data.aTokenAddress, deployer)
          .balanceOf(d.aavePoolAdapterAsTC.address),
        ret.totalCollateralETH,
        ret.totalDebtETH,
      ].map(x => BalanceUtils.toString(x)).join("\n");


      const sexpected = [
        borrowResults.borrowedAmount, // borrowed amount on user's balance
        d.collateralAmount, // amount of collateral tokens on pool-adapter's balance
        d.collateralAmount.mul(d.priceCollateral)  // registered collateral in the pool
          .div(getBigNumberFrom(1, collateralToken.decimals)),
        borrowResults.borrowedAmount.mul(d.priceBorrow) // registered debt in the pool
          .div(getBigNumberFrom(1, borrowToken.decimals)),
      ].map(x => BalanceUtils.toString(x)).join("\n");

      return {sret, sexpected};
    }
    describe("Good paths", () => {
      describe("Borrow small fixed amount", () => {
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
    async function makeBorrowMaxAmount(
      collateralToken: TokenDataTypes,
      collateralHolder: string,
      collateralAmount: BigNumber,
      borrowToken: TokenDataTypes,
    ): Promise<{userAccountData: IAaveTwoUserAccountDataResults, collateralData: IAaveTwoReserveInfo}> {
      const minHealthFactor2 = 101;
      const targetHealthFactor2 = 202;
      const d = await AaveTwoTestUtils.prepareToBorrow(
        deployer,
        collateralToken,
        collateralHolder,
        collateralAmount,
        borrowToken,
        targetHealthFactor2
      );

      await d.controller.setMinHealthFactor2(minHealthFactor2);
      await d.controller.setTargetHealthFactor2(targetHealthFactor2);
      const collateralData = await AaveTwoHelper.getReserveInfo(deployer, d.aavePool, d.dataProvider, collateralToken.address);
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

      await transferAndApprove(
        collateralToken.address,
        d.userContract.address,
        await d.controller.tetuConverter(),
        d.collateralAmount,
        d.aavePoolAdapterAsTC.address
      );
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
        if (!await isPolygonForkInUse()) return;

        const collateralAsset = MaticAddresses.DAI;
        const collateralHolder = MaticAddresses.HOLDER_DAI;
        const borrowAsset = MaticAddresses.WMATIC;

        const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
        const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

        const collateralAmount = getBigNumberFrom(100_000, collateralToken.decimals);

        const r = await makeBorrowMaxAmount(
          collateralToken
          , collateralHolder
          , collateralAmount
          , borrowToken
        );
        console.log(r);

        const ret = [
          r.userAccountData.ltv,
          r.userAccountData.currentLiquidationThreshold,
          r.userAccountData.totalDebtETH
            .add(r.userAccountData.availableBorrowsETH)
            .mul(1e4)
            .div(r.userAccountData.totalCollateralETH)
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

  describe("borrowToRebalance", () => {
    const minHealthFactorInitial2 = 1000;
    const targetHealthFactorInitial2 = 2000;
    const maxHealthFactorInitial2 = 4000;
    const minHealthFactorUpdated2 = 500;
    const targetHealthFactorUpdated2 = 1000;
    const maxHealthFactorUpdated2 = 2000;

    /**
     * Prepare aaveTwo pool adapter.
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
      const d = await AaveTwoTestUtils.prepareToBorrow(
        deployer,
        collateralToken,
        collateralHolder,
        collateralAmount,
        borrowToken,
        targetHealthFactorInitial2
      );
      const collateralAssetData = await AaveTwoHelper.getReserveInfo(deployer, d.aavePool, d.dataProvider, collateralToken.address);
      console.log("collateralAssetData", collateralAssetData);
      const borrowAssetData = await AaveTwoHelper.getReserveInfo(deployer, d.aavePool, d.dataProvider, borrowToken.address);
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
        await transferAndApprove(
          collateralToken.address,
          d.userContract.address,
          await d.controller.tetuConverter(),
          d.collateralAmount,
          d.aavePoolAdapterAsTC.address
        );
        await d.aavePoolAdapterAsTC.borrow(
          collateralAmount,
          amountToBorrow,
          d.userContract.address // receiver
        );
      }
      const afterBorrow: IAaveTwoUserAccountDataResults = await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address);
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

      await poolAdapterSigner.borrowToRebalance(
        expectedAdditionalBorrowAmount,
        d.userContract.address // receiver
      );

      const afterBorrowToRebalance: IAaveTwoUserAccountDataResults = await d.aavePool.getUserAccountData(
        d.aavePoolAdapterAsTC.address
      );
      const userBalanceAfterBorrowToRebalance = await borrowToken.token.balanceOf(d.userContract.address);
      console.log("after borrow to rebalance:", afterBorrowToRebalance, userBalanceAfterBorrowToRebalance);

      return {
        afterBorrow: {
          totalDebtBase: afterBorrow.totalDebtETH,
          totalCollateralBase: afterBorrow.totalCollateralETH,
          currentLiquidationThreshold: afterBorrow.currentLiquidationThreshold,
          availableBorrowsBase: afterBorrow.availableBorrowsETH,
          ltv: afterBorrow.ltv,
          healthFactor: afterBorrow.healthFactor
        },
        afterBorrowToRebalance: {
          totalDebtBase: afterBorrowToRebalance.totalDebtETH,
          totalCollateralBase: afterBorrowToRebalance.totalCollateralETH,
          currentLiquidationThreshold: afterBorrowToRebalance.currentLiquidationThreshold,
          availableBorrowsBase: afterBorrowToRebalance.availableBorrowsETH,
          ltv: afterBorrowToRebalance.ltv,
          healthFactor: afterBorrowToRebalance.healthFactor
        },
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

  describe("repay", () =>{
    async function makeBorrowAndRepay(
      collateralToken: TokenDataTypes,
      collateralHolder: string,
      collateralAmountRequired: BigNumber | undefined,
      borrowToken: TokenDataTypes,
      borrowHolder: string,
      borrowAmountRequired: BigNumber | undefined,
      amountToRepay?: BigNumber,
      initialBorrowAmountOnUserBalance?: BigNumber,
      badParams?: IBorrowAndRepayBadParams
    ) : Promise<IMakeBorrowAndRepayResults>{
      const d = await AaveTwoTestUtils.prepareToBorrow(
        deployer,
        collateralToken,
        collateralHolder,
        collateralAmountRequired,
        borrowToken,
      );
      const collateralData = await AaveTwoHelper.getReserveInfo(deployer,
        d.aavePool,
        d.dataProvider,
        collateralToken.address
      );
      const borrowAmount = borrowAmountRequired
        ? borrowAmountRequired
        : d.amountToBorrow;

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
        await transferAndApprove(
          collateralToken.address,
          d.userContract.address,
          await d.controller.tetuConverter(),
          d.collateralAmount,
          d.aavePoolAdapterAsTC.address
        );
        await d.aavePoolAdapterAsTC.borrow(
          d.collateralAmount,
          borrowAmount,
          d.userContract.address
        );
      }

      const afterBorrow: IUserBalances = {
        collateral: await collateralToken.token.balanceOf(d.userContract.address),
        borrow: await borrowToken.token.balanceOf(d.userContract.address)
      };
      console.log(afterBorrow);

      await TimeUtils.advanceNBlocks(1000);

      const borrowTokenAsUser = IERC20Extended__factory.connect(
        borrowToken.address,
        await DeployerUtils.startImpersonate(d.userContract.address)
      );
      if (amountToRepay) {
        const repayCaller = badParams?.repayAsNotUserAndNotTC
          ? deployer.address // not TC, not user
          : await d.controller.tetuConverter();

        const poolAdapterAsCaller = IPoolAdapter__factory.connect(
          d.aavePoolAdapterAsTC.address,
          await DeployerUtils.startImpersonate(repayCaller)
        );
        // make partial repay
        const amountBorrowAssetToSendToPoolAdapter = badParams?.wrongAmountToRepayToTransfer
          ? badParams?.wrongAmountToRepayToTransfer
          : amountToRepay;

        await transferAndApprove(
          borrowToken.address,
          d.userContract.address,
          repayCaller,
          amountBorrowAssetToSendToPoolAdapter,
          d.aavePoolAdapterAsTC.address
        );
        await poolAdapterAsCaller.repay(
          amountToRepay,
          d.userContract.address,
          // normally we don't close position here
          // but in bad paths we need to emulate attempts to close the position
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
        totalCollateralBase: ret.totalCollateralETH,
        totalDebtBase: ret.totalDebtETH,
        poolAdapter: d.aavePoolAdapterAsTC.address,
        collateralAmount: d.collateralAmount,
        borrowAmount
      }
    }
    describe("Good paths", () =>{
      describe("Borrow and repay modest amount", () =>{
        describe("Partial repay of borrowed amount", () => {
          describe("DAI => WMATIC", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const r = await AaveMakeBorrowAndRepayUtils.daiWmatic(
                deployer,
                makeBorrowAndRepay,
                false,
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
                false,
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
              false,
              initialBorrowAmountOnUserBalance
            );
            expect(r.ret).eq(r.expected);
          });
        });
      });
      describe("Borrow max available amount using all available collateral", () => {
        describe("Full repay of borrowed amount", () => {
          describe("DAI => WMATIC", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const initialBorrowAmountOnUserBalance = 100;
              const r = await AaveMakeBorrowAndRepayUtils.daiWmatic(
                deployer,
                makeBorrowAndRepay,
                true,
                true,
                initialBorrowAmountOnUserBalance
              );
              expect(r.ret).eq(r.expected);
            });
          });
          describe("WMATIC => DAI", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const initialBorrowAmountOnUserBalance = 100;
              const r = await AaveMakeBorrowAndRepayUtils.daiWmatic(
                deployer,
                makeBorrowAndRepay,
                true,
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

          const daiDecimals = await IERC20Extended__factory.connect(MaticAddresses.DAI, deployer).decimals();
          await expect(
            AaveMakeBorrowAndRepayUtils.wmaticDai(
              deployer,
              makeBorrowAndRepay,
              false,
              false,
              undefined,
              {
                // try to transfer too small amount on balance of the pool adapter
                wrongAmountToRepayToTransfer: getBigNumberFrom(1, daiDecimals)
              }
            )
          ).revertedWith("ERC20: transfer amount exceeds balance");
        });
      });
      describe("Try to repay not opened position", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          const initialBorrowAmountOnUserBalanceNumber = 1000;
          await expect(
            AaveMakeBorrowAndRepayUtils.daiWmatic(
              deployer,
              makeBorrowAndRepay,
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
            AaveMakeBorrowAndRepayUtils.daiWmatic(
              deployer,
              makeBorrowAndRepay,
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

    /**
     * Prepare aaveTwo pool adapter.
     * Set low health factors.
     * Make borrow.
     * Increase health factor twice.
     * Make repay to rebalance.
     */
    async function makeRepayToRebalance (
      p: IMakeRepayToRebalanceInputParams,
    ) : Promise<IMakeRepayToRebalanceResults>{
      const d = await AaveTwoTestUtils.prepareToBorrow(
        deployer,
        p.collateralToken,
        p.collateralHolder,
        p.collateralAmount,
        p.borrowToken,
        targetHealthFactorInitial2
      );
      const collateralAssetData = await AaveTwoHelper.getReserveInfo(deployer,
        d.aavePool, d.dataProvider, p.collateralToken.address);
      console.log("collateralAssetData", collateralAssetData);
      const borrowAssetData = await AaveTwoHelper.getReserveInfo(deployer,
        d.aavePool, d.dataProvider, p.borrowToken.address);
      console.log("borrowAssetData", borrowAssetData);

      // prices of assets in base currency
      const prices = await d.aavePrices.getAssetsPrices([p.collateralToken.address, p.borrowToken.address]);
      console.log("prices", prices);

      // setup low values for all health factors
      await d.controller.setMaxHealthFactor2(maxHealthFactorInitial2);
      await d.controller.setTargetHealthFactor2(targetHealthFactorInitial2);
      await d.controller.setMinHealthFactor2(minHealthFactorInitial2);

      // make borrow
      const amountToBorrow = d.amountToBorrow;

      if (! p.badPathsParams?.skipBorrow) {
        await transferAndApprove(
          p.collateralToken.address,
          d.userContract.address,
          await d.controller.tetuConverter(),
          d.collateralAmount,
          d.aavePoolAdapterAsTC.address
        );
        await d.aavePoolAdapterAsTC.borrow(
          p.collateralAmount,
          amountToBorrow,
          d.userContract.address // receiver
        );
      }

      const afterBorrow: IAaveTwoUserAccountDataResults = await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address);
      const userBalanceAfterBorrow = await p.borrowToken.token.balanceOf(d.userContract.address);
      const statusAfterBorrow = await d.aavePoolAdapterAsTC.getStatus();
      console.log("after borrow:", afterBorrow, userBalanceAfterBorrow, statusAfterBorrow);

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
        ? IPoolAdapter__factory.connect(d.aavePoolAdapterAsTC.address, deployer)
        : d.aavePoolAdapterAsTC;

      await SharedRepayToRebalanceUtils.approveAmountToRepayToUserContract(
        poolAdapterSigner.address,
        p.collateralToken.address,
        p.borrowToken.address,
        amountsToRepay,
        d.userContract.address,
        await d.controller.tetuConverter()
      );

      await poolAdapterSigner.repayToRebalance(
        amountsToRepay.useCollateral
          ? amountsToRepay.amountCollateralAsset
          : amountsToRepay.amountBorrowAsset,
        amountsToRepay.useCollateral
      );

      const afterBorrowToRebalance: IAaveTwoUserAccountDataResults = await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address);
      const userBalanceAfterRepayToRebalance = await p.borrowToken.token.balanceOf(d.userContract.address);
      const statusAfterRepay = await d.aavePoolAdapterAsTC.getStatus();
      console.log("after repay to rebalance:",
        afterBorrowToRebalance,
        userBalanceAfterRepayToRebalance,
        statusAfterRepay
      );

      const userAccountCollateralBalanceAfterBorrow = afterBorrow.totalCollateralETH
        .mul(getBigNumberFrom(1, p.collateralToken.decimals))
        .div(prices[0]);
      const userAccountCollateralBalanceAfterRepayToRebalance = afterBorrowToRebalance.totalCollateralETH
        .mul(getBigNumberFrom(1, p.collateralToken.decimals))
        .div(prices[0]);
      const userAccountBorrowBalanceAfterBorrow = afterBorrow.totalDebtETH
        .mul(getBigNumberFrom(1, p.borrowToken.decimals))
        .div(prices[1]);
      const userAccountBorrowBalanceAfterRepayToRebalance = afterBorrowToRebalance.totalDebtETH
        .mul(getBigNumberFrom(1, p.borrowToken.decimals))
        .div(prices[1]);

      return {
        afterBorrow: {
          totalDebtBase: afterBorrow.totalDebtETH,
          totalCollateralBase: afterBorrow.totalCollateralETH,
          currentLiquidationThreshold: afterBorrow.currentLiquidationThreshold,
          availableBorrowsBase: afterBorrow.availableBorrowsETH,
          ltv: afterBorrow.ltv,
          healthFactor: afterBorrow.healthFactor
        },
        afterBorrowToRebalance: {
          totalDebtBase: afterBorrowToRebalance.totalDebtETH,
          totalCollateralBase: afterBorrowToRebalance.totalCollateralETH,
          currentLiquidationThreshold: afterBorrowToRebalance.currentLiquidationThreshold,
          availableBorrowsBase: afterBorrowToRebalance.availableBorrowsETH,
          ltv: afterBorrowToRebalance.ltv,
          healthFactor: afterBorrowToRebalance.healthFactor
        },
        userAccountBorrowBalanceAfterBorrow,
        userAccountBorrowBalanceAfterRepayToRebalance,
        userAccountCollateralBalanceAfterBorrow,
        userAccountCollateralBalanceAfterRepayToRebalance,
        expectedBorrowAssetAmountToRepay: amountsToRepay.useCollateral
          ? BigNumber.from(0)
          : amountsToRepay.amountBorrowAsset,
        expectedCollateralAssetAmountToRepay: amountsToRepay.useCollateral
          ? amountsToRepay.amountCollateralAsset
          : BigNumber.from(0)
      }
    }

    describe("Good paths", () => {
      describe("Repay using borrow asset", () => {
        describe("Dai:WMatic", () => {
          it("should return expected values", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await AaveRepayToRebalanceUtils.daiWMatic(
              deployer,
              makeRepayToRebalance,
              targetHealthFactorInitial2,
              targetHealthFactorUpdated2,
              false
            );

            expect(r.ret).eq(r.expected);
          });
        });
        describe("USDC:USDT", () => {
          it("should return expected values", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await AaveRepayToRebalanceUtils.usdcUsdt(
              deployer,
              async (p) => makeRepayToRebalance(p),
              targetHealthFactorInitial2,
              targetHealthFactorUpdated2,
              false
            );

            expect(r.ret).eq(r.expected);
          });
        });
      });
      describe("Repay using collateral asset", () => {
        describe("Dai:WMatic", () => {
          it("should return expected values", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await AaveRepayToRebalanceUtils.daiWMatic(
              deployer,
              makeRepayToRebalance,
              targetHealthFactorInitial2,
              targetHealthFactorUpdated2,
              true
            );

            expect(r.ret).eq(r.expected);
          });
        });
        describe("USDC:USDT", () => {
          it("should return expected values", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await AaveRepayToRebalanceUtils.usdcUsdt(
              deployer,
              async (p) => makeRepayToRebalance(p),
              targetHealthFactorInitial2,
              targetHealthFactorUpdated2,
              true
            );

            expect(r.ret).eq(r.expected);
          });
        });
      });
    });

    describe("Bad paths", () => {
      async function testRepayToRebalanceDaiWMatic(badPathParams?: IMakeRepayRebalanceBadPathParams) {
        await AaveRepayToRebalanceUtils.daiWMatic(
          deployer,
          makeRepayToRebalance,
          targetHealthFactorInitial2,
          targetHealthFactorUpdated2,
          false,
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
          ).revertedWith("TC-40"); // REPAY_TO_REBALANCE_NOT_ALLOWED
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

//endregion Unit tests

});