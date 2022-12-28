import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {
  AaveTwoPoolAdapter,
  AaveTwoPoolAdapter__factory, AaveTwoPoolMock__factory,
  BorrowManager__factory, Controller, DebtMonitor__factory,
  IERC20Metadata__factory,
  IPoolAdapter__factory, ITetuConverter__factory
} from "../../../typechain";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {AaveTwoHelper} from "../../../scripts/integration/helpers/AaveTwoHelper";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {TokenDataTypes} from "../../baseUT/types/TokenDataTypes";
import {IAaveTwoUserAccountDataResults} from "../../baseUT/apr/aprAaveTwo";
import {
  AaveRepayToRebalanceUtils,
  IMakeRepayToRebalanceResults
} from "../../baseUT/protocols/aaveShared/aaveRepayToRebalanceUtils";
import {
  AaveBorrowToRebalanceUtils,
  IMakeBorrowToRebalanceBadPathParams,
  IMakeBorrowToRebalanceResults
} from "../../baseUT/protocols/aaveShared/aaveBorrowToRebalanceUtils";
import {
  IMakeRepayRebalanceBadPathParams,
  IMakeRepayToRebalanceInputParams
} from "../../baseUT/protocols/shared/sharedDataTypes";
import {SharedRepayToRebalanceUtils} from "../../baseUT/protocols/shared/sharedRepayToRebalanceUtils";
import {makeInfinityApprove, transferAndApprove} from "../../baseUT/utils/transferUtils";
import {
  AaveTwoTestUtils, IBorrowResults,
  IMakeBorrowOrRepayBadPathsParams,
  IPrepareToBorrowResults
} from "../../baseUT/protocols/aaveTwo/AaveTwoTestUtils";
import {AdaptersHelper} from "../../baseUT/helpers/AdaptersHelper";
import {Misc} from "../../../scripts/utils/Misc";
import {TetuConverterApp} from "../../baseUT/helpers/TetuConverterApp";
import {MocksHelper} from "../../baseUT/helpers/MocksHelper";
import {parseUnits} from "ethers/lib/utils";
import {areAlmostEqual} from "../../baseUT/utils/CommonUtils";
import {IPoolAdapterStatus} from "../../baseUT/types/BorrowRepayDataTypes";
import {AaveTwoChangePricesUtils} from "../../baseUT/protocols/aaveTwo/AaveTwoChangePricesUtils";

describe("AaveTwoPoolAdapterUnitTest", () => {
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
  interface IMakeBorrowTestResults {
    init: IPrepareToBorrowResults;
    borrowResults: IBorrowResults;
    collateralToken: TokenDataTypes,
    borrowToken: TokenDataTypes,
  }
  async function makeBorrowTest(
    collateralAsset: string,
    collateralHolder: string,
    borrowAsset: string,
    collateralAmountStr: string,
    badPathsParams?: IMakeBorrowOrRepayBadPathsParams
  ): Promise<IMakeBorrowTestResults> {
    const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
    const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

    const init = await AaveTwoTestUtils.prepareToBorrow(
      deployer,
      collateralToken,
      collateralHolder,
      parseUnits(collateralAmountStr, collateralToken.decimals),
      borrowToken,
      {
        targetHealthFactor2: 200,
        useMockedAavePriceOracle: badPathsParams?.useMockedAavePriceOracle,
        useAaveTwoPoolMock: badPathsParams?.useAaveTwoPoolMock
      }
    );
    const borrowResults = await AaveTwoTestUtils.makeBorrow(deployer, init, undefined, badPathsParams);
    return {
      init,
      borrowResults,
      collateralToken,
      borrowToken
    }
  }
//endregion Test impl

//region Unit tests
  describe("borrow", () => {
    const collateralAsset = MaticAddresses.DAI;
    const collateralHolder = MaticAddresses.HOLDER_DAI;
    const borrowAsset = MaticAddresses.WMATIC;

    describe("Good paths", () => {
      let results: IMakeBorrowTestResults;
      before(async function () {
        if (!await isPolygonForkInUse()) return;
        results = await makeBorrowTest(
          collateralAsset,
          collateralHolder,
          borrowAsset,
          "1999"
        );
      });
      it("should get expected status", async () => {
        if (!await isPolygonForkInUse()) return;
        const status = await results.init.aavePoolAdapterAsTC.getStatus();

        const collateralTargetHealthFactor2 = await BorrowManager__factory.connect(
          await results.init.controller.borrowManager(), deployer
        ).getTargetHealthFactor2(collateralAsset);

        const ret = [
          areAlmostEqual(parseUnits(collateralTargetHealthFactor2.toString(), 16), status.healthFactor18),
          areAlmostEqual(results.borrowResults.borrowedAmount, status.amountToPay, 4),
          status.collateralAmountLiquidated.eq(0),
          status.collateralAmount.eq(parseUnits("1999", results.init.collateralToken.decimals))
        ].join();
        const expected = [true, true, true, true].join();
        expect(ret).eq(expected);
      });
      it("should open position in debt monitor", async () => {
        if (!await isPolygonForkInUse()) return;
        const ret = await DebtMonitor__factory.connect(
          await results.init.controller.debtMonitor(),
          await DeployerUtils.startImpersonate(results.init.aavePoolAdapterAsTC.address)
        ).isPositionOpened();
        expect(ret).eq(true);
      });
      it("should transfer expected amount to the user", async () => {
        if (!await isPolygonForkInUse()) return;
        const status = await results.init.aavePoolAdapterAsTC.getStatus();
        const receivedBorrowAmount = await results.borrowToken.token.balanceOf(results.init.userContract.address);
        expect(receivedBorrowAmount.toString()).eq(results.borrowResults.borrowedAmount.toString());
      });
      it("should change collateralBalanceATokens", async () => {
        if (!await isPolygonForkInUse()) return;
        const collateralBalanceATokens = await results.init.aavePoolAdapterAsTC.collateralBalanceATokens();
        const aaveTokensBalance = await IERC20Metadata__factory.connect(
          results.init.collateralReserveInfo.aTokenAddress,
          deployer
        ).balanceOf(results.init.aavePoolAdapterAsTC.address);
        expect(collateralBalanceATokens.eq(aaveTokensBalance)).eq(true);
      });
    });
    describe("Bad paths", () => {
      it("should revert if not tetu converter", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeBorrowTest(
            collateralAsset,
            collateralHolder,
            borrowAsset,
            "1999",
            {makeOperationAsNotTc: true}
          )
        ).revertedWith("TC-8 tetu converter only"); // TETU_CONVERTER_ONLY
      });
      it("should revert if the pool doesn't send borrowed amount to pool adapter after borrowing", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeBorrowTest(
            collateralAsset,
            collateralHolder,
            borrowAsset,
            "1999",
            { useAaveTwoPoolMock: true, ignoreBorrow: true}
          )
        ).revertedWith("TC-15 wrong borrow balance"); // WRONG_BORROWED_BALANCE
      });
      it("should revert if the pool doesn't send ATokens to pool adapter after supplying", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeBorrowTest(
            collateralAsset,
            collateralHolder,
            borrowAsset,
            "1999",
            { useAaveTwoPoolMock: true, skipSendingATokens: true}
          )
        ).revertedWith("TC-14 wrong ctokens balance"); // WRONG_DERIVATIVE_TOKENS_BALANCE
      });

    });
  });

  describe("full repay", () => {
    const collateralAsset = MaticAddresses.DAI;
    const collateralHolder = MaticAddresses.HOLDER_DAI;
    const borrowAsset = MaticAddresses.WMATIC;
    const borrowHolder = MaticAddresses.HOLDER_WMATIC;

    interface IMakeFullRepayTestResults {
      init: IPrepareToBorrowResults;
      borrowResults: IBorrowResults;
      collateralToken: TokenDataTypes;
      borrowToken: TokenDataTypes;
      statusBeforeRepay: IPoolAdapterStatus;
      repayResults: IAaveTwoUserAccountDataResults;
      userBorrowAssetBalanceBeforeRepay: BigNumber;
      userBorrowAssetBalanceAfterRepay: BigNumber;

      repayResultsCollateralAmountOut: BigNumber;
      repayResultsReturnedBorrowAmountOut?: BigNumber;
    }

    interface IMakeRepayBadPathsParams {
      amountToRepayStr?: string;
      makeRepayAsNotTc?: boolean;
      closePosition?: boolean;
      useAaveTwoPoolMock?: boolean;
      grabAllBorrowAssetFromSenderOnRepay?: boolean;
      collateralPriceIsZero?: boolean;
      ignoreRepay?: boolean;
      ignoreWithdraw?: boolean;
    }

    async function makeFullRepayTest(
      collateralAmountStr: string,
      badPathsParams?: IMakeRepayBadPathsParams
    ): Promise<IMakeFullRepayTestResults> {
      const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
      const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

      const init = await AaveTwoTestUtils.prepareToBorrow(
        deployer,
        collateralToken,
        collateralHolder,
        parseUnits(collateralAmountStr, collateralToken.decimals),
        borrowToken,
        {
          targetHealthFactor2: 200,
          useAaveTwoPoolMock: badPathsParams?.useAaveTwoPoolMock,
          useMockedAavePriceOracle: badPathsParams?.collateralPriceIsZero
        }
      );
      if (badPathsParams?.useAaveTwoPoolMock) {
        if (badPathsParams?.grabAllBorrowAssetFromSenderOnRepay) {
          await AaveTwoPoolMock__factory.connect(init.aavePool.address, deployer).setGrabAllBorrowAssetFromSenderOnRepay();
        }
        if (badPathsParams?.ignoreRepay) {
          await AaveTwoPoolMock__factory.connect(init.aavePool.address, deployer).setIgnoreRepay();
        }
        if (badPathsParams?.ignoreWithdraw) {
          await AaveTwoPoolMock__factory.connect(init.aavePool.address, deployer).setIgnoreWithdraw();
        }
      }
      const borrowResults = await AaveTwoTestUtils.makeBorrow(deployer, init, undefined);

      const amountToRepay = badPathsParams?.amountToRepayStr
        ? parseUnits(badPathsParams?.amountToRepayStr, borrowToken.decimals)
        : undefined;
      await AaveTwoTestUtils.putDoubleBorrowAmountOnUserBalance(init, borrowHolder);

      const userBorrowAssetBalanceBeforeRepay = await init.borrowToken.token.balanceOf(init.userContract.address);
      const statusBeforeRepay: IPoolAdapterStatus = await init.aavePoolAdapterAsTC.getStatus();

      if (badPathsParams?.collateralPriceIsZero) {
        await AaveTwoChangePricesUtils.setAssetPrice(deployer, init.collateralToken.address, BigNumber.from(0));
        console.log("Collateral price was set to 0");
      }

      const makeRepayResults = await AaveTwoTestUtils.makeRepay(
        init,
        amountToRepay,
        badPathsParams?.closePosition,
        {
          makeOperationAsNotTc: badPathsParams?.makeRepayAsNotTc
        }
      );
      const userBorrowAssetBalanceAfterRepay = await init.borrowToken.token.balanceOf(init.userContract.address);

      return {
        init,
        borrowResults,
        collateralToken,
        borrowToken,
        statusBeforeRepay,
        repayResults: makeRepayResults.userAccountData,
        userBorrowAssetBalanceBeforeRepay,
        userBorrowAssetBalanceAfterRepay,
        repayResultsCollateralAmountOut: makeRepayResults.repayResultsCollateralAmountOut,
        repayResultsReturnedBorrowAmountOut: makeRepayResults.repayResultsReturnedBorrowAmountOut
      }
    }

    describe("Good paths", () => {
      let results: IMakeFullRepayTestResults;
      before(async function () {
        if (!await isPolygonForkInUse()) return;
        results = await makeFullRepayTest("1999");
      });
      it("should get expected status", async () => {
        if (!await isPolygonForkInUse()) return;
        const status = await results.init.aavePoolAdapterAsTC.getStatus();
        console.log("userBorrowAssetBalanceAfterRepay", results.userBorrowAssetBalanceAfterRepay);
        console.log("userBorrowAssetBalanceBeforeRepay", results.userBorrowAssetBalanceBeforeRepay);
        console.log("results.statusBeforeRepay", results.statusBeforeRepay);
        const ret = [
          status.healthFactor18.gt(parseUnits("1", 77)),
          areAlmostEqual(
            results.userBorrowAssetBalanceBeforeRepay.sub(results.userBorrowAssetBalanceAfterRepay),
            results.statusBeforeRepay.amountToPay,
            4
          ),
          status.collateralAmountLiquidated.eq(0),
          status.collateralAmount.eq(0)
        ].join();
        const expected = [true, true, true, true].join();
        expect(ret).eq(expected);
      });
      it("should close position after full repay", async () => {
        if (!await isPolygonForkInUse()) return;
        const ret = await DebtMonitor__factory.connect(
          await results.init.controller.debtMonitor(),
          await DeployerUtils.startImpersonate(results.init.aavePoolAdapterAsTC.address)
        ).isPositionOpened();
        expect(ret).eq(false);
      });
      it("should assign expected value to collateralBalanceATokens", async () => {
        if (!await isPolygonForkInUse()) return;
        const collateralBalanceATokens = await results.init.aavePoolAdapterAsTC.collateralBalanceATokens();
        const aaveTokensBalance = await IERC20Metadata__factory.connect(
          results.init.collateralReserveInfo.aTokenAddress,
          deployer
        ).balanceOf(results.init.aavePoolAdapterAsTC.address);
        expect(collateralBalanceATokens.eq(aaveTokensBalance)).eq(true);

      });
      it("should withdraw expected collateral amount", async () => {
        if (!await isPolygonForkInUse()) return;
        const status = await results.init.aavePoolAdapterAsTC.getStatus();
        const receivedCollateralAmount = await results.collateralToken.token.balanceOf(results.init.userContract.address);
        expect(areAlmostEqual(receivedCollateralAmount, results.init.collateralAmount)).eq(true);
      });
      it("should return expected collateral amount", async () => {
        if (!await isPolygonForkInUse()) return;
        expect(areAlmostEqual(results.repayResultsCollateralAmountOut, results.init.collateralAmount)).eq(true);
      });
    });
    describe("Bad paths", () => {
      it("should return exceeded amount if user tries to pay too much", async () => {
        if (!await isPolygonForkInUse()) return;
        const results = await makeFullRepayTest(
          "1999",
          {
            amountToRepayStr: "1500", // amount to repay is ~905, user has 905*2 in total
            closePosition: true
          }
        );
        const ret = areAlmostEqual(
          results.userBorrowAssetBalanceBeforeRepay.sub(results.userBorrowAssetBalanceAfterRepay),
          results.statusBeforeRepay.amountToPay,
          4
        );
        expect(ret).eq(true);
      });
      it("should revert if not tetu converter", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeFullRepayTest(
            "1999",
            {
              makeRepayAsNotTc: true,
              amountToRepayStr: "10" // it's much harder to emulate not-TC call for full repay
            }
          )
        ).revertedWith("TC-8 tetu converter only"); // TETU_CONVERTER_ONLY
      });
      it("should fail if pay too small amount and try to close the position", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeFullRepayTest(
            "1999",
            {amountToRepayStr: "1", closePosition: true}
          )
        ).revertedWith("TC-24 close position failed"); // CLOSE_POSITION_FAILED
      });
      it("should fail if the debt was completely paid but amount of the debt is still not zero in the pool", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeFullRepayTest(
            "1999",
            {
              useAaveTwoPoolMock: true,
              ignoreWithdraw: true,
              ignoreRepay: true
            }
          )
        ).revertedWith("TC-24 close position failed"); // CLOSE_POSITION_FAILED
      });
      it("should NOT revert if pool has used all amount-to-repay and hasn't sent anything back", async () => {
        if (!await isPolygonForkInUse()) return;
        const r = await makeFullRepayTest(
          "1999",
          {useAaveTwoPoolMock: true, grabAllBorrowAssetFromSenderOnRepay: true}
        );

        // We emulate a situation
        // when the pool adapter takes all amount-to-repay
        // and doesn't return any amount back
        const balanceBorrowAssetOnMock = await r.borrowToken.token.balanceOf(r.init.aavePool.address);
        expect(balanceBorrowAssetOnMock.gt(0)).eq(true);
      });
      it("should fail if collateral price is zero", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeFullRepayTest(
            "1999",
            {
              collateralPriceIsZero: true,
              amountToRepayStr: "1" // we need partial-repay mode in this test to avoid calling getStatus in makeRepayComplete
            }
          )
        ).revertedWith("TC-4 zero price"); // ZERO_PRICE
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
        {targetHealthFactor2: targetHealthFactorInitial2}
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
          ).revertedWith("TC-8 tetu converter only"); // TETU_CONVERTER_ONLY
        });
      });
      describe("Position is not registered", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            testRepayToRebalanceDaiWMatic({skipBorrow: true})
          ).revertedWith("TC-40 repay to rebalance not allowed"); // REPAY_TO_REBALANCE_NOT_ALLOWED
        });
      });
      describe("Result health factor is less min allowed one", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            testRepayToRebalanceDaiWMatic({additionalAmountCorrectionFactorDiv: 100})
          ).revertedWith("TC-3 wrong health factor");
        });
      });
      describe("Try to repay amount greater then the debt", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            testRepayToRebalanceDaiWMatic({additionalAmountCorrectionFactorMul: 100})
          ).revertedWith("TC-40 repay to rebalance not allowed"); // REPAY_TO_REBALANCE_NOT_ALLOWED
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
        {
          targetHealthFactor2: targetHealthFactorInitial2,
          useAaveTwoPoolMock: badPathsParams?.useAavePoolMock
        }
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

      // make additional borrow
      if (badPathsParams?.useAavePoolMock && badPathsParams?.aavePoolMockSkipsBorrowInBorrowToRebalance) {
        // pool doesn't make borrow and so doesn't send additional borrow asset us
        // we should get WRONG_BORROWED_BALANCE exception
        await AaveTwoPoolMock__factory.connect(d.aavePool.address, deployer).setIgnoreBorrow();
      }
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
          ).revertedWith("TC-8 tetu converter only");
        });
      });
      describe("Position is not registered", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            testDaiWMatic({skipBorrow: true})
          ).revertedWith("TC-11 position not registered");
        });
      });
      describe("Result health factor is less min allowed one", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            testDaiWMatic({additionalAmountCorrectionFactor: 10})
          ).revertedWith("TC-3 wrong health factor");
        });
      });
      describe("Dont transfer borrowed amount after borrow with WRONG_BORROWED_BALANCE", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            testDaiWMatic({
              useAavePoolMock: true,
              aavePoolMockSkipsBorrowInBorrowToRebalance: true
            })
          ).revertedWith("TC-15 wrong borrow balance"); // WRONG_BORROWED_BALANCE
        });
      });
    });
  });

  describe("initialize", () => {
    interface IInitializePoolAdapterBadPaths {
      zeroController?: boolean;
      zeroUser?: boolean;
      zeroCollateralAsset?: boolean;
      zeroBorrowAsset?: boolean;
      zeroConverter?: boolean;
      zeroPool?: boolean;
    }
    interface IMakeInitializePoolAdapterResults {
      user: string;
      converter: string;
      collateralAsset: string;
      borrowAsset: string;
      controller: Controller;
      poolAdapter: AaveTwoPoolAdapter;
    }
    async function makeInitializePoolAdapter(
      badParams?: IInitializePoolAdapterBadPaths
    ) : Promise<IMakeInitializePoolAdapterResults> {
      const user = ethers.Wallet.createRandom().address;
      const collateralAsset = (await MocksHelper.createMockedCToken(deployer)).address;
      const borrowAsset = (await MocksHelper.createMockedCToken(deployer)).address;
      const converter = ethers.Wallet.createRandom().address;

      const controller = await TetuConverterApp.createController(
        deployer,
        {tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
      );
      const poolAdapter = await AdaptersHelper.createAaveTwoPoolAdapter(deployer);

      await poolAdapter.initialize(
        badParams?.zeroController ? Misc.ZERO_ADDRESS : controller.address,
        badParams?.zeroPool ? Misc.ZERO_ADDRESS : MaticAddresses.AAVE_TWO_POOL,
        badParams?.zeroUser ? Misc.ZERO_ADDRESS : user,
        badParams?.zeroCollateralAsset ? Misc.ZERO_ADDRESS : collateralAsset,
        badParams?.zeroBorrowAsset ? Misc.ZERO_ADDRESS : borrowAsset,
        badParams?.zeroConverter ? Misc.ZERO_ADDRESS : converter
      );

      return {
        converter,
        borrowAsset,
        poolAdapter,
        user,
        collateralAsset,
        controller
      }
    }
    async function makeInitializePoolAdapterTest(
      badParams?: IInitializePoolAdapterBadPaths
    ) : Promise<{ret: string, expected: string}> {
      const d = await makeInitializePoolAdapter(badParams);
      const poolAdapterConfigAfter = await d.poolAdapter.getConfig();
      const ret = [
        poolAdapterConfigAfter.origin,
        poolAdapterConfigAfter.outUser,
        poolAdapterConfigAfter.outCollateralAsset,
        poolAdapterConfigAfter.outBorrowAsset
      ].join();
      const expected = [
        d.converter,
        d.user,
        d.collateralAsset,
        d.borrowAsset
      ].join();
      return {ret, expected};
    }

    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        const r = await makeInitializePoolAdapterTest();
        expect(r.ret).eq(r.expected);
      });
    });
    describe("Bad paths", () => {
      it("should revert on zero controller", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeInitializePoolAdapterTest({zeroController: true})
        ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
      });
      it("should revert on zero controller", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeInitializePoolAdapterTest({zeroController: true})
        ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
      });
      it("should revert on zero controller", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeInitializePoolAdapterTest({zeroController: true})
        ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
      });
      it("should revert on zero user", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeInitializePoolAdapterTest({zeroUser: true})
        ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
      });
      it("should revert on zero pool", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeInitializePoolAdapterTest({zeroPool: true})
        ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
      });
      it("should revert on zero converter", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeInitializePoolAdapterTest({zeroConverter: true})
        ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
      });
      it("should revert on zero collateral asset", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeInitializePoolAdapterTest({zeroCollateralAsset: true})
        ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
      });
      it("should revert on zero borrow asset", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeInitializePoolAdapterTest({zeroBorrowAsset: true})
        ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
      });
      it("should revert on second initialization", async () => {
        if (!await isPolygonForkInUse()) return;
        const d = await makeInitializePoolAdapter();
        await expect(
          d.poolAdapter.initialize(
            d.controller.address,
            MaticAddresses.AAVE_TWO_POOL,
            d.user,
            d.collateralAsset,
            d.borrowAsset,
            d.converter
          )
        ).revertedWith("Initializable: contract is already initialized");
      });
    });
  });

  describe("claimRewards", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        const receiver = ethers.Wallet.createRandom().address;
        const d = await AaveTwoTestUtils.prepareToBorrow(
          deployer,
          await TokenDataTypes.Build(deployer, MaticAddresses.DAI),
          MaticAddresses.HOLDER_DAI,
          undefined,
          await TokenDataTypes.Build(deployer, MaticAddresses.WMATIC),
          {targetHealthFactor2: 200}
        );
        const ret = await d.aavePoolAdapterAsTC.callStatic.claimRewards(receiver);
        expect(ret.amount.toNumber()).eq(0);
      });
    });
  });

  describe("getConversionKind", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        const d = await AaveTwoTestUtils.prepareToBorrow(
          deployer,
          await TokenDataTypes.Build(deployer, MaticAddresses.DAI),
          MaticAddresses.HOLDER_DAI,
          undefined,
          await TokenDataTypes.Build(deployer, MaticAddresses.WMATIC),
          {targetHealthFactor2: 200}
        );
        const ret = await d.aavePoolAdapterAsTC.getConversionKind();
        expect(ret).eq(2); // CONVERSION_KIND_BORROW_2
      });
    });
  });

  describe("getConfig", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        const d = await AaveTwoTestUtils.prepareToBorrow(
          deployer,
          await TokenDataTypes.Build(deployer, MaticAddresses.DAI),
          MaticAddresses.HOLDER_DAI,
          undefined,
          await TokenDataTypes.Build(deployer, MaticAddresses.WMATIC),
          {targetHealthFactor2: 200}
        );
        const r = await d.aavePoolAdapterAsTC.getConfig();
        const ret = [
          r.outCollateralAsset,
          r.outBorrowAsset,
          r.outUser,
          r.origin
        ].join();
        const expected = [
          MaticAddresses.DAI,
          MaticAddresses.WMATIC,
          d.userContract.address,
          d.converterNormal
        ].join();
        expect(ret).eq(expected);
      });
    });
  });

  describe("events", () => {
    describe("OnInitialized", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;

        const collateralAsset = MaticAddresses.DAI;
        const borrowAsset = MaticAddresses.WMATIC;

        const controller = await TetuConverterApp.createController(deployer);
        const userContract = await MocksHelper.deployBorrower(deployer.address, controller, 1000);

        const converterNormal = (await AdaptersHelper.createAaveTwoPoolAdapter(deployer)).address;
        const platformAdapter = await AdaptersHelper.createAaveTwoPlatformAdapter(
          deployer, controller.address, MaticAddresses.AAVE_TWO_POOL, converterNormal,
        );

        const tetuConverterSigner = await DeployerUtils.startImpersonate(await controller.tetuConverter());

        const borrowManager = BorrowManager__factory.connect(await controller.borrowManager(), deployer);
        await borrowManager.addAssetPairs(platformAdapter.address, [collateralAsset], [borrowAsset]);

        const bmAsTc = BorrowManager__factory.connect(await controller.borrowManager(), tetuConverterSigner);

        // we need to catch event "OnInitialized" of pool adapter ... but we don't know address of the pool adapter yet
        const tx = await bmAsTc.registerPoolAdapter(converterNormal, userContract.address, collateralAsset, borrowAsset);
        const cr = await tx.wait();

        // now, we know the address of the pool adapter...
        const aavePoolAdapterAsTC = AaveTwoPoolAdapter__factory.connect(
          await borrowManager.getPoolAdapter(converterNormal, userContract.address, collateralAsset, borrowAsset),
          tetuConverterSigner
        );

        // ... and so, we can check the event in tricky way, see how to parse event: https://github.com/ethers-io/ethers.js/issues/487
        const abi = ["event OnInitialized(address controller, address pool, address user, address collateralAsset, address borrowAsset, address originConverter)"];
        const iface = new ethers.utils.Interface(abi);
        // let's find an event with required address
        let eventIndex = 0;
        for (let i = 0; i < cr.logs.length; ++i) {
          if (cr.logs[i].address === aavePoolAdapterAsTC.address) {
            eventIndex = i;
            break;
          }
        }
        const logOnInitialized = iface.parseLog(cr.logs[2]);
        const retLog = [
          logOnInitialized.name,
          logOnInitialized.args[0],
          logOnInitialized.args[1],
          logOnInitialized.args[2],
          logOnInitialized.args[3],
          logOnInitialized.args[4],
          logOnInitialized.args[5],
        ].join();
        const expectedLog = [
          "OnInitialized",
          controller.address,
          MaticAddresses.AAVE_TWO_POOL,
          userContract.address,
          collateralAsset,
          borrowAsset,
          converterNormal
        ].join();
        expect(retLog).eq(expectedLog);
      });
    });

    describe("OnBorrow, OnRepay", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;

        const collateralAsset = MaticAddresses.DAI;
        const collateralHolder = MaticAddresses.HOLDER_DAI;
        const borrowAsset = MaticAddresses.WMATIC;
        const borrowHolder = MaticAddresses.HOLDER_WMATIC;
        const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
        const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);
        const collateralAmount = parseUnits("1000", collateralToken.decimals);

        const controller = await TetuConverterApp.createController(deployer);
        const userContract = await MocksHelper.deployBorrower(deployer.address, controller, 1000);

        const converterNormal = (await AdaptersHelper.createAaveTwoPoolAdapter(deployer)).address;
        const platformAdapter = await AdaptersHelper.createAaveTwoPlatformAdapter(
          deployer, controller.address, MaticAddresses.AAVE_TWO_POOL, converterNormal
        );

        const tetuConverterSigner = await DeployerUtils.startImpersonate(await controller.tetuConverter());

        const borrowManager = BorrowManager__factory.connect(await controller.borrowManager(), deployer);
        await borrowManager.addAssetPairs(platformAdapter.address, [collateralAsset], [borrowAsset]);

        const bmAsTc = BorrowManager__factory.connect(await controller.borrowManager(), tetuConverterSigner);

        await bmAsTc.registerPoolAdapter(converterNormal, userContract.address, collateralAsset, borrowAsset);
        const aavePoolAdapterAsTC = AaveTwoPoolAdapter__factory.connect(
          await borrowManager.getPoolAdapter(converterNormal, userContract.address, collateralAsset, borrowAsset),
          tetuConverterSigner
        );
        const targetHealthFactor2 = await controller.targetHealthFactor2();

        // TetuConverter gives infinity approve to the pool adapter after pool adapter creation (see TetuConverter.convert implementation)
        await makeInfinityApprove(tetuConverterSigner.address, aavePoolAdapterAsTC.address, collateralAsset, borrowAsset);
        await BalanceUtils.getRequiredAmountFromHolders(collateralAmount, collateralToken.token, [collateralHolder], userContract.address);
        const plan = await platformAdapter.getConversionPlan(collateralAsset, collateralAmount, borrowAsset, targetHealthFactor2, 1);
        await transferAndApprove(collateralAsset, userContract.address, tetuConverterSigner.address, collateralAmount, aavePoolAdapterAsTC.address);

        await expect(
          aavePoolAdapterAsTC.borrow(collateralAmount, plan.amountToBorrow, userContract.address)
        ).to.emit(aavePoolAdapterAsTC, "OnBorrow").withArgs(
          collateralAmount,
          plan.amountToBorrow,
          userContract.address,
          (resultHealthFactor18: BigNumber) => areAlmostEqual(
            resultHealthFactor18,
            parseUnits("1", 16).mul(targetHealthFactor2)
          ),
          (balanceATokens: BigNumber) => balanceATokens.gte(collateralAmount)
        );

        await borrowToken.token
          .connect(await DeployerUtils.startImpersonate(borrowHolder))
          .transfer(userContract.address, plan.amountToBorrow.mul(2));

        await BalanceUtils.getRequiredAmountFromHolders(
          parseUnits("1", borrowToken.decimals),
          borrowToken.token,
          [borrowHolder],
          tetuConverterSigner.address
        );

        const status0 = await aavePoolAdapterAsTC.getStatus();
        const collateralBalanceATokens = await aavePoolAdapterAsTC.collateralBalanceATokens();
        await expect(
          aavePoolAdapterAsTC.repayToRebalance(parseUnits("1", borrowToken.decimals), false)
        ).to.emit(aavePoolAdapterAsTC, "OnRepayToRebalance").withArgs(
          parseUnits("1", borrowToken.decimals),
          false,
          (newHealthFactor: BigNumber) => newHealthFactor.gt(status0.healthFactor18),
          collateralBalanceATokens
        );

        const status = await aavePoolAdapterAsTC.getStatus();
        await expect(
          userContract.makeRepayComplete(collateralAsset, borrowAsset, userContract.address)
        ).to.emit(aavePoolAdapterAsTC, "OnRepay").withArgs(
          (amountToRepay: BigNumber) => areAlmostEqual(amountToRepay, status.amountToPay, 3),
          userContract.address,
          true,
          Misc.MAX_UINT,
          parseUnits("0")
        );
      });
    });

    describe("OnBorrowToRebalance", () => {
      it("should return expected values", async () => {
        // TODO: not implemented
      });
    });
  });

  describe("getStatus", () => {
    describe("Good paths", () => {
      it("user has made a borrow, should return expected status", async () => {
        if (!await isPolygonForkInUse()) return;

        const collateralAsset = MaticAddresses.DAI;
        const collateralHolder = MaticAddresses.HOLDER_DAI;
        const borrowAsset = MaticAddresses.WMATIC;

        const results = await makeBorrowTest(
          collateralAsset,
          collateralHolder,
          borrowAsset,
          "1999"
        );
        const status = await results.init.aavePoolAdapterAsTC.getStatus();

        const collateralTargetHealthFactor2 = await BorrowManager__factory.connect(
          await results.init.controller.borrowManager(), deployer
        ).getTargetHealthFactor2(collateralAsset);

        const ret = [
          areAlmostEqual(parseUnits(collateralTargetHealthFactor2.toString(), 16), status.healthFactor18),
          areAlmostEqual(results.borrowResults.borrowedAmount, status.amountToPay, 4),
          status.collateralAmountLiquidated.eq(0),
          status.collateralAmount.eq(parseUnits("1999", results.init.collateralToken.decimals))
        ].join();
        const expected = [true, true, true, true].join();
        expect(ret).eq(expected);
      });
      it("user has not made a borrow, should return expected status", async () => {
        if (!await isPolygonForkInUse()) return;

        const collateralAsset = MaticAddresses.DAI;
        const collateralHolder = MaticAddresses.HOLDER_DAI;
        const borrowAsset = MaticAddresses.WMATIC;

        const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
        const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

        // we only prepare to borrow, but don't make a borrow
        const init = await AaveTwoTestUtils.prepareToBorrow(
          deployer,
          collateralToken,
          collateralHolder,
          parseUnits("999", collateralToken.decimals),
          borrowToken,
        );
        const status = await init.aavePoolAdapterAsTC.getStatus();

        const collateralTargetHealthFactor2 = await BorrowManager__factory.connect(
          await init.controller.borrowManager(), deployer
        ).getTargetHealthFactor2(collateralAsset);

        const ret = [
          status.healthFactor18.eq(Misc.MAX_UINT),
          status.amountToPay.eq(0),
          status.collateralAmountLiquidated.eq(0),
          status.collateralAmount.eq(0),
          status.opened
        ].join();
        const expected = [true, true, true, true, false].join();
        expect(ret).eq(expected);
      });
    });
    describe("Bad paths", () => {
      it("it should revert if collateral price is zero", async () => {
        if (!await isPolygonForkInUse()) return;

        const r = await makeBorrowTest(
          MaticAddresses.DAI,
          MaticAddresses.HOLDER_DAI,
          MaticAddresses.WMATIC,
          "1999",
          {useMockedAavePriceOracle: true}
        );
        await AaveTwoChangePricesUtils.setAssetPrice(deployer, r.init.collateralToken.address, BigNumber.from(0));
        await expect(
          r.init.aavePoolAdapterAsTC.getStatus()
        ).revertedWith("TC-4 zero price"); // ZERO_PRICE
      });
      it("it should revert if collateral price is zero", async () => {
        if (!await isPolygonForkInUse()) return;

        const r = await makeBorrowTest(
          MaticAddresses.DAI,
          MaticAddresses.HOLDER_DAI,
          MaticAddresses.WMATIC,
          "1999",
          {useMockedAavePriceOracle: true}
        );
        await AaveTwoChangePricesUtils.setAssetPrice(deployer, r.init.borrowToken.address, BigNumber.from(0));
        await expect(
          r.init.aavePoolAdapterAsTC.getStatus()
        ).revertedWith("TC-4 zero price"); // ZERO_PRICE
      });

    });
  });

  describe("updateBalance", () => {
    it("the function is callable", async () => {
      if (!await isPolygonForkInUse()) return;

      const collateralAsset = MaticAddresses.DAI;
      const collateralHolder = MaticAddresses.HOLDER_DAI;
      const borrowAsset = MaticAddresses.WMATIC;

      const results = await makeBorrowTest(
        collateralAsset,
        collateralHolder,
        borrowAsset,
        "1999"
      );

      await results.init.aavePoolAdapterAsTC.updateStatus();
      const statusAfter = await results.init.aavePoolAdapterAsTC.getStatus();

      // ensure that updateStatus doesn't revert
      expect(statusAfter.opened).eq(true);
    });
  });

  describe("getCollateralAmountToReturn", () => {
    const collateralAsset = MaticAddresses.DAI;
    const collateralHolder = MaticAddresses.HOLDER_DAI;
    const borrowAsset = MaticAddresses.WMATIC;
    let results: IMakeBorrowTestResults;
    before(async function () {
      if (!await isPolygonForkInUse()) return;
      results = await makeBorrowTest(
        collateralAsset,
        collateralHolder,
        borrowAsset,
        "1999"
      );
    });
    describe("Good paths", () => {
      describe("Full repay", () => {
        it("should return expected values", async () => {
          if (!await isPolygonForkInUse()) return;

          const status = await results.init.aavePoolAdapterAsTC.getStatus();
          const tetuConverterAsUser = ITetuConverter__factory.connect(
            await results.init.controller.tetuConverter(),
            await DeployerUtils.startImpersonate(results.init.userContract.address)
          );
          const collateralAmountOut = await tetuConverterAsUser.callStatic.quoteRepay(
            await tetuConverterAsUser.signer.getAddress(),
            results.init.collateralToken.address,
            results.init.borrowToken.address,
            status.amountToPay
          );

          const ret = collateralAmountOut.gte(status.collateralAmount);
          console.log("ret", collateralAmountOut, status.collateralAmount);
          expect(ret).eq(true);
        });
      });
      describe("Partial repay 50%", () => {
        it("should return expected values", async () => {
          if (!await isPolygonForkInUse()) return;

          const status = await results.init.aavePoolAdapterAsTC.getStatus();
          const tetuConverterAsUser = ITetuConverter__factory.connect(
            await results.init.controller.tetuConverter(),
            await DeployerUtils.startImpersonate(results.init.userContract.address)
          );
          const collateralAmountOut = await tetuConverterAsUser.callStatic.quoteRepay(
            await tetuConverterAsUser.signer.getAddress(),
            results.init.collateralToken.address,
            results.init.borrowToken.address,
            status.amountToPay.div(2) // 50%
          );

          const ret = areAlmostEqual(collateralAmountOut.mul(2), status.collateralAmount, 4);
          console.log("ret", collateralAmountOut.mul(2), status.collateralAmount);
          expect(ret).eq(true);
        });
      });
      describe("Partial repay 5%", () => {
        it("should return expected values", async () => {
          if (!await isPolygonForkInUse()) return;

          const status = await results.init.aavePoolAdapterAsTC.getStatus();
          const tetuConverterAsUser = ITetuConverter__factory.connect(
            await results.init.controller.tetuConverter(),
            await DeployerUtils.startImpersonate(results.init.userContract.address)
          );
          const collateralAmountOut = await tetuConverterAsUser.callStatic.quoteRepay(
            await tetuConverterAsUser.signer.getAddress(),
            results.init.collateralToken.address,
            results.init.borrowToken.address,
            status.amountToPay.div(20) // 5%
          );

          const ret = areAlmostEqual(collateralAmountOut.mul(20), status.collateralAmount, 4);
          console.log("ret", collateralAmountOut.mul(20), status.collateralAmount);
          expect(ret).eq(true);
        });
      });
    });
    describe("Bad paths", () => {
      it("should revert if collateral price is zero", async () => {
        if (!await isPolygonForkInUse()) return;
        const priceOracle = await AaveTwoChangePricesUtils.setupPriceOracleMock(deployer);
        await priceOracle.setPrices([results.init.collateralToken.address], [parseUnits("0")]);

        const tetuConverterAsUser = ITetuConverter__factory.connect(
          await results.init.controller.tetuConverter(),
          await DeployerUtils.startImpersonate(results.init.userContract.address)
        );
        await expect(
          tetuConverterAsUser.quoteRepay(
            await tetuConverterAsUser.signer.getAddress(),
            results.init.collateralToken.address,
            results.init.borrowToken.address,
            parseUnits("1000") // full repay, close position
          )
        ).revertedWith("TC-4 zero price"); // ZERO_PRICE
      });
    });
  });
//endregion Unit tests

});