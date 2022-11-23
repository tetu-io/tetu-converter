import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {
  BorrowManager__factory, Controller, DebtMonitor__factory, HfPlatformAdapter, HfPoolAdapter,
  IERC20Extended__factory,
  IPoolAdapter__factory
} from "../../../typechain";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";
import {HundredFinanceHelper} from "../../../scripts/integration/helpers/HundredFinanceHelper";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {TokenDataTypes} from "../../baseUT/types/TokenDataTypes";
import {Misc} from "../../../scripts/utils/Misc";
import {IHfAccountLiquidity} from "../../baseUT/apr/aprHundredFinance";
import {areAlmostEqual} from "../../baseUT/utils/CommonUtils";
import {IPoolAdapterStatus} from "../../baseUT/types/BorrowRepayDataTypes";
import {
  IAssetsInputParamsWithCTokens,
  IMakeRepayRebalanceBadPathParams,
  IMakeRepayToRebalanceInputParamsWithCTokens
} from "../../baseUT/protocols/shared/sharedDataTypes";
import {SharedRepayToRebalanceUtils} from "../../baseUT/protocols/shared/sharedRepayToRebalanceUtils";
import {transferAndApprove} from "../../baseUT/utils/transferUtils";
import {
  HundredFinanceTestUtils, IBorrowResults, IMakeBorrowOrRepayBadPathsParams,
  IPrepareToBorrowResults
} from "../../baseUT/protocols/hundred-finance/HundredFinanceTestUtils";
import {AdaptersHelper} from "../../baseUT/helpers/AdaptersHelper";
import {TetuConverterApp} from "../../baseUT/helpers/TetuConverterApp";
import {parseUnits} from "ethers/lib/utils";

describe("Hundred Finance unit tests, pool adapter", () => {

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
    collateralCToken: string,
    collateralHolder: string,
    borrowAsset: string,
    borrowCToken: string,
    collateralAmountStr: string,
    badPathsParams?: IMakeBorrowOrRepayBadPathsParams
  ): Promise<IMakeBorrowTestResults> {
    const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
    const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

    const init = await HundredFinanceTestUtils.prepareToBorrow(
      deployer,
      collateralToken,
      collateralHolder,
      collateralCToken,
      parseUnits(collateralAmountStr, collateralToken.decimals),
      borrowToken,
      borrowCToken,
      200
    );
    const borrowResults = await HundredFinanceTestUtils.makeBorrow(deployer, init, undefined, badPathsParams);
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
    describe("Good paths", () => {
      describe("Borrow matic", () => {
        const collateralAsset = MaticAddresses.DAI;
        const collateralCToken = MaticAddresses.hDAI;
        const collateralHolder = MaticAddresses.HOLDER_DAI;
        const borrowAsset = MaticAddresses.WMATIC;
        const borrowCToken = MaticAddresses.hMATIC;
        let results: IMakeBorrowTestResults;
        before(async function () {
          results = await makeBorrowTest(
            collateralAsset,
            collateralCToken,
            collateralHolder,
            borrowAsset,
            borrowCToken,
            "1999"
          );
        });
        it("should return expected status", async () => {
          if (!await isPolygonForkInUse()) return;
          const status = await results.init.hfPoolAdapterTC.getStatus();

          const collateralTargetHealthFactor2 = await BorrowManager__factory.connect(
            await results.init.controller.borrowManager(), deployer
          ).getTargetHealthFactor2(collateralAsset);

          console.log(status);

          const ret = [
            areAlmostEqual(parseUnits(collateralTargetHealthFactor2.toString(), 16), status.healthFactor18),
            areAlmostEqual(results.borrowResults.borrowedAmount, status.amountToPay, 4),
            status.collateralAmountLiquidated.eq(0),
            areAlmostEqual(status.collateralAmount, parseUnits("1999", results.init.collateralToken.decimals), 4)
          ].join();
          const expected = [true, true, true, true].join();
          expect(ret).eq(expected);

        });
        it("should open position in debt monitor", async () => {
          const ret = await DebtMonitor__factory.connect(
            await results.init.controller.debtMonitor(),
            await DeployerUtils.startImpersonate(results.init.hfPoolAdapterTC.address)
          ).isPositionOpened();
          expect(ret).eq(true);
        });
        it("should transfer expected amount to the user", async () => {
          const status = await results.init.hfPoolAdapterTC.getStatus();
          const receivedBorrowAmount = await results.borrowToken.token.balanceOf(results.init.userContract.address);
          expect(receivedBorrowAmount.toString()).eq(results.borrowResults.borrowedAmount.toString());
        });
        it("should change collateralBalanceATokens", async () => {
          const collateralBalanceATokens = await results.init.hfPoolAdapterTC.collateralTokensBalance();
          const aaveTokensBalance = await IERC20Extended__factory.connect(
            collateralCToken,
            deployer
          ).balanceOf(results.init.hfPoolAdapterTC.address);
          expect(collateralBalanceATokens.gte(aaveTokensBalance)).eq(true);
        });
      });
      describe("Supply matic", () => {
        const collateralAsset = MaticAddresses.WMATIC;
        const collateralCToken = MaticAddresses.hMATIC;
        const collateralHolder = MaticAddresses.HOLDER_WMATIC;
        const borrowAsset = MaticAddresses.USDC;
        const borrowCToken = MaticAddresses.hUSDC;
        let results: IMakeBorrowTestResults;
        before(async function () {
          results = await makeBorrowTest(
            collateralAsset,
            collateralCToken,
            collateralHolder,
            borrowAsset,
            borrowCToken,
            "1999"
          );
        });
        it("should return expected status", async () => {
          if (!await isPolygonForkInUse()) return;
          const status = await results.init.hfPoolAdapterTC.getStatus();

          const collateralTargetHealthFactor2 = await BorrowManager__factory.connect(
            await results.init.controller.borrowManager(), deployer
          ).getTargetHealthFactor2(collateralAsset);

          const ret = [
            areAlmostEqual(parseUnits(collateralTargetHealthFactor2.toString(), 16), status.healthFactor18),
            areAlmostEqual(results.borrowResults.borrowedAmount, status.amountToPay, 4),
            status.collateralAmountLiquidated.eq(0),
            areAlmostEqual(status.collateralAmount, parseUnits("1999", results.init.collateralToken.decimals), 4)
          ].join();
          console.log(status);
          const expected = [true, true, true, true].join();
          expect(ret).eq(expected);
        });
        it("should open position in debt monitor", async () => {
          const ret = await DebtMonitor__factory.connect(
            await results.init.controller.debtMonitor(),
            await DeployerUtils.startImpersonate(results.init.hfPoolAdapterTC.address)
          ).isPositionOpened();
          expect(ret).eq(true);
        });
        it("should transfer expected amount to the user", async () => {
          const status = await results.init.hfPoolAdapterTC.getStatus();
          const receivedBorrowAmount = await results.borrowToken.token.balanceOf(results.init.userContract.address);
          expect(receivedBorrowAmount.toString()).eq(results.borrowResults.borrowedAmount.toString());
        });
        it("should change collateralBalanceATokens", async () => {
          const collateralBalanceATokens = await results.init.hfPoolAdapterTC.collateralTokensBalance();
          const aaveTokensBalance = await IERC20Extended__factory.connect(
            collateralCToken,
            deployer
          ).balanceOf(results.init.hfPoolAdapterTC.address);
          expect(collateralBalanceATokens.gte(aaveTokensBalance)).eq(true);
        });
      });
      describe("Supply and borrow not-matic (CRV, USDC)", () => {
        const collateralAsset = MaticAddresses.CHAIN_LINK;
        const collateralCToken = MaticAddresses.hLINK;
        const collateralHolder = MaticAddresses.HOLDER_CHAIN_LINK;
        const borrowAsset = MaticAddresses.USDC;
        const borrowCToken = MaticAddresses.hUSDC;
        let results: IMakeBorrowTestResults;
        before(async function () {
          results = await makeBorrowTest(
            collateralAsset,
            collateralCToken,
            collateralHolder,
            borrowAsset,
            borrowCToken,
            "1999"
          );
        });
        it("should return expected status", async () => {
          if (!await isPolygonForkInUse()) return;
          const status = await results.init.hfPoolAdapterTC.getStatus();

          const collateralTargetHealthFactor2 = await BorrowManager__factory.connect(
            await results.init.controller.borrowManager(), deployer
          ).getTargetHealthFactor2(collateralAsset);

          console.log(status);

          const ret = [
            areAlmostEqual(parseUnits(collateralTargetHealthFactor2.toString(), 16), status.healthFactor18),
            areAlmostEqual(results.borrowResults.borrowedAmount, status.amountToPay, 4),
            status.collateralAmountLiquidated.eq(0),
            areAlmostEqual(status.collateralAmount, parseUnits("1999", results.init.collateralToken.decimals), 4)
          ].join();
          const expected = [true, true, true, true].join();
          expect(ret).eq(expected);

        });
        it("should open position in debt monitor", async () => {
          const ret = await DebtMonitor__factory.connect(
            await results.init.controller.debtMonitor(),
            await DeployerUtils.startImpersonate(results.init.hfPoolAdapterTC.address)
          ).isPositionOpened();
          expect(ret).eq(true);
        });
        it("should transfer expected amount to the user", async () => {
          const status = await results.init.hfPoolAdapterTC.getStatus();
          const receivedBorrowAmount = await results.borrowToken.token.balanceOf(results.init.userContract.address);
          expect(receivedBorrowAmount.toString()).eq(results.borrowResults.borrowedAmount.toString());
        });
        it("should change collateralBalanceATokens", async () => {
          const collateralBalanceATokens = await results.init.hfPoolAdapterTC.collateralTokensBalance();
          const aaveTokensBalance = await IERC20Extended__factory.connect(
            collateralCToken,
            deployer
          ).balanceOf(results.init.hfPoolAdapterTC.address);
          expect(collateralBalanceATokens.gte(aaveTokensBalance)).eq(true);
        });
      });
      describe("Supply and borrow not-matic (WBTC:ETH)", () => {
        const collateralAsset = MaticAddresses.WBTC;
        const collateralCToken = MaticAddresses.hWBTC;
        const collateralHolder = MaticAddresses.HOLDER_WBTC;
        const borrowAsset = MaticAddresses.USDC;
        const borrowCToken = MaticAddresses.hUSDC;
        let results: IMakeBorrowTestResults;
        before(async function () {
          results = await makeBorrowTest(
            collateralAsset,
            collateralCToken,
            collateralHolder,
            borrowAsset,
            borrowCToken,
            "1.999"
          );
        });
        it("should return expected status", async () => {
          if (!await isPolygonForkInUse()) return;
          const status = await results.init.hfPoolAdapterTC.getStatus();

          const collateralTargetHealthFactor2 = await BorrowManager__factory.connect(
            await results.init.controller.borrowManager(), deployer
          ).getTargetHealthFactor2(collateralAsset);

          console.log(status);

          const ret = [
            areAlmostEqual(parseUnits(collateralTargetHealthFactor2.toString(), 16), status.healthFactor18),
            areAlmostEqual(results.borrowResults.borrowedAmount, status.amountToPay, 4),
            status.collateralAmountLiquidated.eq(0),
            areAlmostEqual(status.collateralAmount, parseUnits("1.999", results.init.collateralToken.decimals), 4)
          ].join();
          const expected = [true, true, true, true].join();
          expect(ret).eq(expected);

        });
        it("should open position in debt monitor", async () => {
          const ret = await DebtMonitor__factory.connect(
            await results.init.controller.debtMonitor(),
            await DeployerUtils.startImpersonate(results.init.hfPoolAdapterTC.address)
          ).isPositionOpened();
          expect(ret).eq(true);
        });
        it("should transfer expected amount to the user", async () => {
          const status = await results.init.hfPoolAdapterTC.getStatus();
          const receivedBorrowAmount = await results.borrowToken.token.balanceOf(results.init.userContract.address);
          expect(receivedBorrowAmount.toString()).eq(results.borrowResults.borrowedAmount.toString());
        });
        it("should change collateralBalanceATokens", async () => {
          const collateralBalanceATokens = await results.init.hfPoolAdapterTC.collateralTokensBalance();
          const aaveTokensBalance = await IERC20Extended__factory.connect(
            collateralCToken,
            deployer
          ).balanceOf(results.init.hfPoolAdapterTC.address);
          expect(collateralBalanceATokens.gte(aaveTokensBalance)).eq(true);
        });
      });
    });
    describe("Bad paths", () => {
      it("should revert if not tetu converter", async () => {
        const collateralAsset = MaticAddresses.DAI;
        const collateralCToken = MaticAddresses.hDAI;
        const collateralHolder = MaticAddresses.HOLDER_DAI;
        const borrowAsset = MaticAddresses.USDC;
        const borrowCToken = MaticAddresses.hUSDC;
        await expect(
          makeBorrowTest(
            collateralAsset,
            collateralCToken,
            collateralHolder,
            borrowAsset,
            borrowCToken,
            "1999",
            {makeOperationAsNotTc: true}
          )
        ).revertedWith("TC-8"); // TETU_CONVERTER_ONLY
      });
    });
  });

  describe("full repay", () => {
    interface IMakeFullRepayTestResults {
      init: IPrepareToBorrowResults;
      borrowResults: IBorrowResults;
      collateralToken: TokenDataTypes;
      borrowToken: TokenDataTypes;
      statusBeforeRepay: IPoolAdapterStatus;
      repayResults: IHfAccountLiquidity;
      userBorrowAssetBalanceBeforeRepay: BigNumber;
      userBorrowAssetBalanceAfterRepay: BigNumber;
    }

    interface IMakeRepayBadPathsParams {
      amountToRepayStr?: string;
      makeRepayAsNotTc?: boolean;
      closePosition?: boolean;
    }

    async function makeFullRepayTest(
      collateralAsset: string,
      collateralCToken: string,
      collateralHolder: string,
      collateralAmountStr: string,
      borrowAsset: string,
      borrowCToken: string,
      borrowHolder: string,
      badPathsParams?: IMakeRepayBadPathsParams
    ): Promise<IMakeFullRepayTestResults> {
      const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
      const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

      const init = await HundredFinanceTestUtils.prepareToBorrow(
        deployer,
        collateralToken,
        collateralHolder,
        collateralCToken,
        parseUnits(collateralAmountStr, collateralToken.decimals),
        borrowToken,
        borrowCToken,
        200
      );
      const borrowResults = await HundredFinanceTestUtils.makeBorrow(deployer, init, undefined);

      const amountToRepay = badPathsParams?.amountToRepayStr
        ? parseUnits(badPathsParams?.amountToRepayStr, borrowToken.decimals)
        : undefined;
      await HundredFinanceTestUtils.putDoubleBorrowAmountOnUserBalance(init, borrowHolder);

      const userBorrowAssetBalanceBeforeRepay = await init.borrowToken.token.balanceOf(init.userContract.address);
      const statusBeforeRepay: IPoolAdapterStatus = await init.hfPoolAdapterTC.getStatus();

      const repayResults = await HundredFinanceTestUtils.makeRepay(
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
        repayResults,
        userBorrowAssetBalanceBeforeRepay,
        userBorrowAssetBalanceAfterRepay
      }
    }

    describe("Good paths", () => {
      describe("Supply matic", () => {
        const collateralAsset = MaticAddresses.WMATIC;
        const collateralCToken = MaticAddresses.hMATIC;
        const collateralHolder = MaticAddresses.HOLDER_WMATIC;
        const borrowAsset = MaticAddresses.DAI;
        const borrowCToken = MaticAddresses.hDAI;
        const borrowHolder = MaticAddresses.HOLDER_DAI;
        let results: IMakeFullRepayTestResults;
        before(async function () {
          results = await makeFullRepayTest(
            collateralAsset,
            collateralCToken,
            collateralHolder,
            "1999",
            borrowAsset,
            borrowCToken,
            borrowHolder
          );
        });
        it("should get expected status", async () => {
          const status = await results.init.hfPoolAdapterTC.getStatus();
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
          const ret = await DebtMonitor__factory.connect(
            await results.init.controller.debtMonitor(),
            await DeployerUtils.startImpersonate(results.init.hfPoolAdapterTC.address)
          ).isPositionOpened();
          expect(ret).eq(false);
        });
        it("should assign expected value to collateralBalanceATokens", async () => {
          const collateralBalanceATokens = await results.init.hfPoolAdapterTC.collateralTokensBalance();
          const aaveTokensBalance = await IERC20Extended__factory.connect(
            collateralCToken,
            deployer
          ).balanceOf(results.init.hfPoolAdapterTC.address);
          expect(collateralBalanceATokens.eq(aaveTokensBalance)).eq(true);

        });
        it("should withdraw expected collateral amount", async () => {
          const status = await results.init.hfPoolAdapterTC.getStatus();
          const receivedCollateralAmount = await results.collateralToken.token.balanceOf(results.init.userContract.address);
          expect(areAlmostEqual(receivedCollateralAmount, results.init.collateralAmount)).eq(true);
        });
      });
      describe("Borrow matic", () => {
        const collateralAsset = MaticAddresses.USDC;
        const collateralCToken = MaticAddresses.hUSDC;
        const collateralHolder = MaticAddresses.HOLDER_USDC;
        const borrowAsset = MaticAddresses.WMATIC;
        const borrowCToken = MaticAddresses.hMATIC;
        const borrowHolder = MaticAddresses.HOLDER_WMATIC;
        let results: IMakeFullRepayTestResults;
        before(async function () {
          results = await makeFullRepayTest(
            collateralAsset,
            collateralCToken,
            collateralHolder,
            "1999",
            borrowAsset,
            borrowCToken,
            borrowHolder
          );
        });
        it("should get expected status", async () => {
          const status = await results.init.hfPoolAdapterTC.getStatus();
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
          const ret = await DebtMonitor__factory.connect(
            await results.init.controller.debtMonitor(),
            await DeployerUtils.startImpersonate(results.init.hfPoolAdapterTC.address)
          ).isPositionOpened();
          expect(ret).eq(false);
        });
        it("should assign expected value to collateralBalanceATokens", async () => {
          const collateralBalanceATokens = await results.init.hfPoolAdapterTC.collateralTokensBalance();
          const aaveTokensBalance = await IERC20Extended__factory.connect(
            collateralCToken,
            deployer
          ).balanceOf(results.init.hfPoolAdapterTC.address);
          expect(collateralBalanceATokens.eq(aaveTokensBalance)).eq(true);

        });
        it("should withdraw expected collateral amount", async () => {
          const status = await results.init.hfPoolAdapterTC.getStatus();
          const receivedCollateralAmount = await results.collateralToken.token.balanceOf(results.init.userContract.address);
          expect(areAlmostEqual(receivedCollateralAmount, results.init.collateralAmount)).eq(true);
        });
      });
      describe("Supply and borrow not-matic", () => {
        const collateralAsset = MaticAddresses.DAI;
        const collateralCToken = MaticAddresses.hDAI;
        const collateralHolder = MaticAddresses.HOLDER_DAI;
        const borrowAsset = MaticAddresses.USDC;
        const borrowCToken = MaticAddresses.hUSDC;
        const borrowHolder = MaticAddresses.HOLDER_USDC;

        let results: IMakeFullRepayTestResults;
        before(async function () {
          results = await makeFullRepayTest(
            collateralAsset,
            collateralCToken,
            collateralHolder,
            "1999",
            borrowAsset,
            borrowCToken,
            borrowHolder
          );
        });
        it("should get expected status", async () => {
          const status = await results.init.hfPoolAdapterTC.getStatus();
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
          const ret = await DebtMonitor__factory.connect(
            await results.init.controller.debtMonitor(),
            await DeployerUtils.startImpersonate(results.init.hfPoolAdapterTC.address)
          ).isPositionOpened();
          expect(ret).eq(false);
        });
        it("should assign expected value to collateralBalanceATokens", async () => {
          const collateralBalanceATokens = await results.init.hfPoolAdapterTC.collateralTokensBalance();
          const aaveTokensBalance = await IERC20Extended__factory.connect(
            collateralCToken,
            deployer
          ).balanceOf(results.init.hfPoolAdapterTC.address);
          expect(collateralBalanceATokens.eq(aaveTokensBalance)).eq(true);

        });
        it("should withdraw expected collateral amount", async () => {
          const status = await results.init.hfPoolAdapterTC.getStatus();
          const receivedCollateralAmount = await results.collateralToken.token.balanceOf(results.init.userContract.address);
          expect(areAlmostEqual(receivedCollateralAmount, results.init.collateralAmount)).eq(true);
        });
      });
    });
    describe("Bad paths", () => {
      const collateralAsset = MaticAddresses.DAI;
      const collateralCToken = MaticAddresses.hDAI;
      const collateralHolder = MaticAddresses.HOLDER_DAI;
      const borrowAsset = MaticAddresses.USDC;
      const borrowCToken = MaticAddresses.hUSDC;
      const borrowHolder = MaticAddresses.HOLDER_USDC;
      /**
       * Exceeded amount is returned by aave adapters
       * because AAVE-pool adapter takes a bit more amount than necessary
       * to cover possible dust. There is no such problem in DForce, so
       * DForce pool-adapter doesn't check and doesn't return
       * exceeded amount.
       */
      it.skip("should return exceeded amount if user tries to pay too much", async () => {
        const results = await makeFullRepayTest(
          collateralAsset,
          collateralCToken,
          collateralHolder,
          "1999",
          borrowAsset,
          borrowCToken,
          borrowHolder,
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
        await expect(
          makeFullRepayTest(
            collateralAsset,
            collateralCToken,
            collateralHolder,
            "1999",
            borrowAsset,
            borrowCToken,
            borrowHolder,
            {
              makeRepayAsNotTc: true,
              amountToRepayStr: "10" // it's much harder to emulate not-TC call for full repay
            }
          )
        ).revertedWith("TC-8"); // TETU_CONVERTER_ONLY
      });
      it("should fail if pay too small amount and try to close the position", async () => {
        await expect(
          makeFullRepayTest(
            collateralAsset,
            collateralCToken,
            collateralHolder,
            "1999",
            borrowAsset,
            borrowCToken,
            borrowHolder,
            {amountToRepayStr: "1", closePosition: true}
          )
        ).revertedWith("TC-24"); // CLOSE_POSITION_FAILED
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
      const d = await HundredFinanceTestUtils.prepareToBorrow(
        deployer,
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
        await transferAndApprove(
          collateralToken.address,
          d.userContract.address,
          await d.controller.tetuConverter(),
          d.collateralAmount,
          d.hfPoolAdapterTC.address
        );

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
          ).revertedWith("TC-11"); // BORROW_POSITION_IS_NOT_REGISTERED
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
      const d = await HundredFinanceTestUtils.prepareToBorrow(
        deployer,
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
        await transferAndApprove(
          p.collateralToken.address,
          d.userContract.address,
          await d.controller.tetuConverter(),
          d.collateralAmount,
          d.hfPoolAdapterTC.address
        );
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

      const collateralAmount = parseUnits(assets.collateralAmountStr, collateralToken.decimals);
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
          collateralAmountStr: "1000",
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
          collateralAmountStr: "100000",
          collateralHolder
        },
        useCollateralAssetToRepay,
        badPathsParams
      );
    }

    async function wbtcWETH(
      useCollateralAssetToRepay: boolean,
      badPathsParams?: IMakeRepayRebalanceBadPathParams
    ) : Promise<{ret: string, expected: string}> {
      const collateralAsset = MaticAddresses.WBTC;
      const collateralHolder = MaticAddresses.HOLDER_WBTC;
      const collateralCTokenAddress = MaticAddresses.hWBTC;

      const borrowAsset = MaticAddresses.WETH;
      const borrowHolder = MaticAddresses.HOLDER_WETH;
      const borrowCTokenAddress = MaticAddresses.hETH;

      return makeRepayToRebalanceTest(
        {
          borrowCTokenAddress,
          collateralCTokenAddress,
          collateralAsset,
          borrowAsset,
          borrowHolder,
          collateralAmountStr: "0.01",
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
        describe("WBTC : WETH", () => {
          it("should return expected values", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await wbtcWETH(false);

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
        describe("WBTC : WETH", () => {
          it("should return expected values", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await wbtcWETH(true);

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
          ).revertedWith("TC-8"); // TETU_CONVERTER_ONLY
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

  describe("updateBalance", () => {
    it("should return expected values", async () => {
      if (!await isPolygonForkInUse()) return;

      const collateralAsset = MaticAddresses.DAI;
      const collateralCToken = MaticAddresses.hDAI;
      const collateralHolder = MaticAddresses.HOLDER_DAI;
      const borrowAsset = MaticAddresses.WMATIC;
      const borrowCToken = MaticAddresses.hMATIC;

      const results = await makeBorrowTest(
        collateralAsset,
        collateralCToken,
        collateralHolder,
        borrowAsset,
        borrowCToken,
        "1999"
      );

      await results.init.hfPoolAdapterTC.updateStatus();
      const statusAfter = await results.init.hfPoolAdapterTC.getStatus();

      // ensure that updateStatus doesn't revert
      expect(statusAfter.opened).eq(true);
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
      zeroTokenAddressProvider?: boolean;
    }
    interface IMakeInitializePoolAdapterResults {
      user: string;
      converter: string;
      collateralAsset: string;
      borrowAsset: string;
      controller: Controller;
      poolAdapter: HfPoolAdapter;
      tokenAddressProvider: HfPlatformAdapter;
    }
    async function makeInitializePoolAdapter(
      badParams?: IInitializePoolAdapterBadPaths
    ) : Promise<IMakeInitializePoolAdapterResults> {
      const user = ethers.Wallet.createRandom().address;
      const converter = ethers.Wallet.createRandom().address;
      const collateralAsset = MaticAddresses.DAI;
      const borrowAsset = MaticAddresses.USDC;

      const controller = await TetuConverterApp.createController(
        deployer,
        {tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
      );
      const poolAdapter = await AdaptersHelper.createHundredFinancePoolAdapter(deployer);
      const tokenAddressProvider = await AdaptersHelper.createHundredFinancePlatformAdapter(
        deployer,
        controller.address,
        MaticAddresses.HUNDRED_FINANCE_COMPTROLLER,
        converter,
        [MaticAddresses.hDAI, MaticAddresses.hUSDC]
      );

      await poolAdapter.initialize(
        badParams?.zeroController ? Misc.ZERO_ADDRESS : controller.address,
        badParams?.zeroTokenAddressProvider ? Misc.ZERO_ADDRESS : tokenAddressProvider.address,
        badParams?.zeroPool ? Misc.ZERO_ADDRESS : MaticAddresses.HUNDRED_FINANCE_COMPTROLLER,
        badParams?.zeroUser ? Misc.ZERO_ADDRESS : user,
        badParams?.zeroCollateralAsset ? Misc.ZERO_ADDRESS : collateralAsset,
        badParams?.zeroBorrowAsset ? Misc.ZERO_ADDRESS : borrowAsset,
        badParams?.zeroConverter ? Misc.ZERO_ADDRESS : converter
      );

      return {
        poolAdapter,
        borrowAsset,
        converter,
        user,
        collateralAsset,
        controller,
        tokenAddressProvider
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
        poolAdapterConfigAfter.outCollateralAsset.toLowerCase(),
        poolAdapterConfigAfter.outBorrowAsset.toLowerCase()
      ].join("\n");
      const expected = [
        d.converter,
        d.user,
        d.collateralAsset.toLowerCase(),
        d.borrowAsset.toLowerCase()
      ].join("\n");
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
        ).revertedWith("TC-1"); // ZERO_ADDRESS
      });
      it("should revert on zero controller", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeInitializePoolAdapterTest({zeroController: true})
        ).revertedWith("TC-1"); // ZERO_ADDRESS
      });
      it("should revert on zero controller", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeInitializePoolAdapterTest({zeroController: true})
        ).revertedWith("TC-1"); // ZERO_ADDRESS
      });
      it("should revert on zero user", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeInitializePoolAdapterTest({zeroUser: true})
        ).revertedWith("TC-1"); // ZERO_ADDRESS
      });
      it("should revert on zero pool", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeInitializePoolAdapterTest({zeroPool: true})
        ).revertedWith("TC-1"); // ZERO_ADDRESS
      });
      it("should revert on zero converter", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeInitializePoolAdapterTest({zeroConverter: true})
        ).revertedWith("TC-1"); // ZERO_ADDRESS
      });
      it("should revert on zero collateral asset", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeInitializePoolAdapterTest({zeroCollateralAsset: true})
        ).revertedWith("TC-1"); // ZERO_ADDRESS
      });
      it("should revert on zero borrow asset", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeInitializePoolAdapterTest({zeroBorrowAsset: true})
        ).revertedWith("TC-1"); // ZERO_ADDRESS
      });
      it("should revert on zero token address provider", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeInitializePoolAdapterTest({zeroTokenAddressProvider: true})
        ).revertedWith("TC-1"); // ZERO_ADDRESS
      });
      it("should revert on second initialization", async () => {
        if (!await isPolygonForkInUse()) return;
        const d = await makeInitializePoolAdapter();
        await expect(
          d.poolAdapter.initialize(
            d.controller.address,
            d.tokenAddressProvider.address,
            MaticAddresses.DFORCE_CONTROLLER,
            d.user,
            d.collateralAsset,
            d.borrowAsset,
            d.converter
          )
        ).revertedWithCustomError(d.poolAdapter, "ErrorAlreadyInitialized");
      });
    });
  });

  describe("claimRewards", () => {
    it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        const receiver = ethers.Wallet.createRandom().address;
        const d = await HundredFinanceTestUtils.prepareToBorrow(
          deployer,
          await TokenDataTypes.Build(deployer, MaticAddresses.DAI),
          MaticAddresses.HOLDER_DAI,
          MaticAddresses.hDAI,
          undefined,
          await TokenDataTypes.Build(deployer, MaticAddresses.WMATIC),
          MaticAddresses.hMATIC,
        );
        const ret = await d.hfPoolAdapterTC.callStatic.claimRewards(receiver);
        expect(ret.amount.toNumber()).eq(0);
      });
  });

  describe("getConversionKind", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        const d = await HundredFinanceTestUtils.prepareToBorrow(
          deployer,
          await TokenDataTypes.Build(deployer, MaticAddresses.DAI),
          MaticAddresses.HOLDER_DAI,
          MaticAddresses.hDAI,
          undefined,
          await TokenDataTypes.Build(deployer, MaticAddresses.WMATIC),
          MaticAddresses.hMATIC,
        );
        const ret = await d.hfPoolAdapterTC.getConversionKind();
        expect(ret).eq(2); // CONVERSION_KIND_BORROW_2
      });
    });
  });

  describe("getConfig", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        const d = await HundredFinanceTestUtils.prepareToBorrow(
          deployer,
          await TokenDataTypes.Build(deployer, MaticAddresses.DAI),
          MaticAddresses.HOLDER_DAI,
          MaticAddresses.hDAI,
          undefined,
          await TokenDataTypes.Build(deployer, MaticAddresses.WMATIC),
          MaticAddresses.hMATIC,
        );
        const r = await d.hfPoolAdapterTC.getConfig();
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

  describe("getStatus", () => {
    it("user has made a borrow, should return expected status", async () => {
      if (!await isPolygonForkInUse()) return;

      const collateralAsset = MaticAddresses.USDT;
      const collateralCToken = MaticAddresses.hUSDT;
      const collateralHolder = MaticAddresses.HOLDER_USDT;
      const borrowAsset = MaticAddresses.USDC;
      const borrowCToken = MaticAddresses.hUSDC;

      const results = await makeBorrowTest(
        collateralAsset,
        collateralCToken,
        collateralHolder,
        borrowAsset,
        borrowCToken,
        "1999"
      );
      const status = await results.init.hfPoolAdapterTC.getStatus();

      const collateralTargetHealthFactor2 = await BorrowManager__factory.connect(
        await results.init.controller.borrowManager(), deployer
      ).getTargetHealthFactor2(collateralAsset);

      const ret = [
        areAlmostEqual(parseUnits(collateralTargetHealthFactor2.toString(), 16), status.healthFactor18),
        areAlmostEqual(results.borrowResults.borrowedAmount, status.amountToPay, 4),
        status.collateralAmountLiquidated.eq(0),
        areAlmostEqual(status.collateralAmount, parseUnits("1999", results.init.collateralToken.decimals), 4)
      ].join();
      const expected = [true, true, true, true].join();
      expect(ret).eq(expected);
    });
    it("user has not made a borrow, should return expected status", async () => {
      if (!await isPolygonForkInUse()) return;

      const collateralAsset = MaticAddresses.USDT;
      const collateralCToken = MaticAddresses.hUSDT;
      const collateralHolder = MaticAddresses.HOLDER_USDT;
      const borrowAsset = MaticAddresses.USDC;
      const borrowCToken = MaticAddresses.hUSDC;

      const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
      const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

      // we only prepare to borrow, but don't make a borrow
      const init = await HundredFinanceTestUtils.prepareToBorrow(
        deployer,
        collateralToken,
        collateralHolder,
        collateralCToken,
        parseUnits("999", collateralToken.decimals),
        borrowToken,
        borrowCToken
      );
      const status = await init.hfPoolAdapterTC.getStatus();

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

  describe("TODO:getAPR18 - for next versions", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        // expect.fail("TODO");
      });
    });
    describe("Bad paths", () => {
      describe("", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          // expect.fail("TODO");
        });
      });
    });
  });

//endregion Unit tests

});