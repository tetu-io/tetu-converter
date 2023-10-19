import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {
  BorrowManager__factory,
  ConverterController,
  DebtMonitor__factory, HfComptrollerMock, HfCTokenMock,
  HfPoolAdapter,
  IERC20Metadata__factory,
  IPoolAdapter__factory, ITetuConverter__factory,
  ITokenAddressProvider,
  TokenAddressProviderMock
} from "../../../../typechain";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../../scripts/utils/NumberUtils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {HundredFinanceHelper} from "../../../../scripts/integration/hundred-finance/HundredFinanceHelper";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {TokenDataTypes} from "../../../baseUT/types/TokenDataTypes";
import {Misc} from "../../../../scripts/utils/Misc";
import {IHfAccountLiquidity} from "../../../baseUT/protocols/hundred-finance/aprHundredFinance";
import {areAlmostEqual} from "../../../baseUT/utils/CommonUtils";
import {IPoolAdapterStatus} from "../../../baseUT/types/BorrowRepayDataTypes";
import {
  IAssetsInputParamsWithCTokens,
  IMakeRepayRebalanceBadPathParams,
  IMakeRepayToRebalanceInputParamsWithCTokens
} from "../../../baseUT/protocols/shared/sharedDataTypes";
import {SharedRepayToRebalanceUtils} from "../../../baseUT/protocols/shared/sharedRepayToRebalanceUtils";
import {transferAndApprove} from "../../../baseUT/utils/transferUtils";
import {
  HundredFinanceTestUtils, IBorrowResults, IMakeBorrowOrRepayBadPathsParams,
  IPrepareToBorrowResults
} from "../../../baseUT/protocols/hundred-finance/HundredFinanceTestUtils";
import {parseUnits} from "ethers/lib/utils";
import {HardhatUtils, POLYGON_NETWORK_ID} from "../../../../scripts/utils/HardhatUtils";
import {TetuConverterApp} from "../../../baseUT/app/TetuConverterApp";
import {AdaptersHelper} from "../../../baseUT/app/AdaptersHelper";
import {MocksHelper} from "../../../baseUT/app/MocksHelper";

describe.skip("HfPoolAdapterUnitTest", () => {

//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[1];
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
      {
        targetHealthFactor2: 200,
        useHfComptrollerMock: badPathsParams?.useHfComptrollerMock
      }
    );
    const borrowResults = await HundredFinanceTestUtils.makeBorrow(deployer, init, undefined, badPathsParams);
    return {
      init,
      borrowResults,
      collateralToken,
      borrowToken
    }
  }

  interface IHfComptrollerMockSet {
    mockedComptroller: HfComptrollerMock;
    mockedCollateralCToken: HfCTokenMock;
    mockedBorrowCToken: HfCTokenMock;
  }
  async function initializeHfComptrollerMock(
    collateralAsset: string,
    collateralCToken: string,
    borrowAsset: string,
    borrowCToken: string,
  ) : Promise<IHfComptrollerMockSet> {
    const mockedCollateralCToken = await MocksHelper.getNotInitializedHfCTokenMock(deployer);
    const mockedBorrowCToken = await MocksHelper.getNotInitializedHfCTokenMock(deployer);

    const mockedComptroller = await MocksHelper.getHfComptrollerMock(
      deployer,
      collateralAsset,
      borrowAsset,
      collateralCToken,
      borrowCToken,
      mockedCollateralCToken.address,
      mockedBorrowCToken.address,
      MaticAddresses.HUNDRED_FINANCE_COMPTROLLER
    );

    await mockedCollateralCToken.init(mockedComptroller.address, collateralAsset, collateralCToken);
    await mockedBorrowCToken.init(mockedComptroller.address, borrowAsset, borrowCToken);

    return {
      mockedBorrowCToken,
      mockedCollateralCToken,
      mockedComptroller
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
        let snapshotLocal: string;
        before(async function () {
          snapshotLocal = await TimeUtils.snapshot();
          results = await makeBorrowTest(
            collateralAsset,
            collateralCToken,
            collateralHolder,
            borrowAsset,
            borrowCToken,
            "1999"
          );
        });
        after(async function () {
          await TimeUtils.rollback(snapshotLocal);
        });

        it("should return expected status", async () => {
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
          const receivedBorrowAmount = await results.borrowToken.token.balanceOf(results.init.userContract.address);
          expect(receivedBorrowAmount.toString()).eq(results.borrowResults.borrowedAmount.toString());
        });
        it("should change collateralBalanceATokens", async () => {
          const collateralBalanceATokens = await results.init.hfPoolAdapterTC.collateralTokensBalance();
          const aaveTokensBalance = await IERC20Metadata__factory.connect(
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
        let snapshotLocal: string;
        before(async function () {
          snapshotLocal = await TimeUtils.snapshot();
          results = await makeBorrowTest(
            collateralAsset,
            collateralCToken,
            collateralHolder,
            borrowAsset,
            borrowCToken,
            "1999"
          );
        });
        after(async function () {
          await TimeUtils.rollback(snapshotLocal);
        });
        it("should return expected status", async () => {
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
          const receivedBorrowAmount = await results.borrowToken.token.balanceOf(results.init.userContract.address);
          expect(receivedBorrowAmount.toString()).eq(results.borrowResults.borrowedAmount.toString());
        });
        it("should change collateralBalanceATokens", async () => {
          const collateralBalanceATokens = await results.init.hfPoolAdapterTC.collateralTokensBalance();
          const aaveTokensBalance = await IERC20Metadata__factory.connect(
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
        let snapshotLocal: string;
        before(async function () {
          snapshotLocal = await TimeUtils.snapshot();
          results = await makeBorrowTest(
            collateralAsset,
            collateralCToken,
            collateralHolder,
            borrowAsset,
            borrowCToken,
            "1.9"
          );
        });
        after(async function () {
          await TimeUtils.rollback(snapshotLocal);
        });
        it("should return expected status", async () => {
          const status = await results.init.hfPoolAdapterTC.getStatus();

          const collateralTargetHealthFactor2 = await BorrowManager__factory.connect(
            await results.init.controller.borrowManager(), deployer
          ).getTargetHealthFactor2(collateralAsset);

          console.log(status);

          const ret = [
            areAlmostEqual(parseUnits(collateralTargetHealthFactor2.toString(), 16), status.healthFactor18, 5),
            areAlmostEqual(results.borrowResults.borrowedAmount, status.amountToPay, 4),
            status.collateralAmountLiquidated.eq(0),
            status.collateralAmount.lte(parseUnits("1.9", results.init.collateralToken.decimals))
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
          const receivedBorrowAmount = await results.borrowToken.token.balanceOf(results.init.userContract.address);
          expect(receivedBorrowAmount.toString()).eq(results.borrowResults.borrowedAmount.toString());
        });
        it("should change collateralBalanceATokens", async () => {
          const collateralBalanceATokens = await results.init.hfPoolAdapterTC.collateralTokensBalance();
          const aaveTokensBalance = await IERC20Metadata__factory.connect(
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
        let snapshotLocal: string;
        before(async function () {
          snapshotLocal = await TimeUtils.snapshot();
          results = await makeBorrowTest(
            collateralAsset,
            collateralCToken,
            collateralHolder,
            borrowAsset,
            borrowCToken,
            "1.999"
          );
        });
        after(async function () {
          await TimeUtils.rollback(snapshotLocal);
        });
        it("should return expected status", async () => {
          const status = await results.init.hfPoolAdapterTC.getStatus();

          const collateralTargetHealthFactor2 = await BorrowManager__factory.connect(
            await results.init.controller.borrowManager(), deployer
          ).getTargetHealthFactor2(collateralAsset);

          console.log(status);

          const ret = [
            areAlmostEqual(parseUnits(collateralTargetHealthFactor2.toString(), 16), status.healthFactor18),
            areAlmostEqual(results.borrowResults.borrowedAmount, status.amountToPay, 4),
            status.collateralAmountLiquidated.eq(0),
            status.collateralAmount.lte(parseUnits("1.999", results.init.collateralToken.decimals))
          ].join();
          const expected = [true, true, true, true].join();

          console.log("collateralTargetHealthFactor2", collateralTargetHealthFactor2.toString());
          console.log("healthFactor18", status.healthFactor18);
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
          const receivedBorrowAmount = await results.borrowToken.token.balanceOf(results.init.userContract.address);
          expect(receivedBorrowAmount.toString()).eq(results.borrowResults.borrowedAmount.toString());
        });
        it("should change collateralBalanceATokens", async () => {
          const collateralBalanceATokens = await results.init.hfPoolAdapterTC.collateralTokensBalance();
          const aaveTokensBalance = await IERC20Metadata__factory.connect(
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
        ).revertedWith("TC-8 tetu converter only"); // TETU_CONVERTER_ONLY
      });
      describe("Use mocked HfComptroller", () => {
        it("normal borrow should work correctly", async () => {
          const mocksSet = await initializeHfComptrollerMock(
            MaticAddresses.DAI,
            MaticAddresses.hDAI,
            MaticAddresses.USDC,
            MaticAddresses.hUSDC,
          );
          const results = await makeBorrowTest(
            MaticAddresses.DAI,
            mocksSet.mockedCollateralCToken.address,
            MaticAddresses.HOLDER_DAI,
            MaticAddresses.USDC,
            mocksSet.mockedBorrowCToken.address,
            "1999",
            {useHfComptrollerMock: mocksSet.mockedComptroller}
          );
          const status = await results.init.hfPoolAdapterTC.getStatus();

          const collateralTargetHealthFactor2 = await BorrowManager__factory.connect(
            await results.init.controller.borrowManager(), deployer
          ).getTargetHealthFactor2(MaticAddresses.DAI);

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
        it("should revert if comptroller doesn't return borrowed amount", async () => {
          const mocksSet = await initializeHfComptrollerMock(
            MaticAddresses.DAI,
            MaticAddresses.hDAI,
            MaticAddresses.USDC,
            MaticAddresses.hUSDC,
          );
          await mocksSet.mockedComptroller.setIgnoreBorrow();

          await expect(
            makeBorrowTest(
              MaticAddresses.DAI,
              mocksSet.mockedCollateralCToken.address,
              MaticAddresses.HOLDER_DAI,
              MaticAddresses.USDC,
              mocksSet.mockedBorrowCToken.address,
              "1999",
              {useHfComptrollerMock: mocksSet.mockedComptroller}
            )
          ).revertedWith("TC-15 wrong borrow balance"); // WRONG_BORROWED_BALANCE
        });
        it("should revert if fail to get liquidity balance after borrow", async () => {
          const mocksSet = await initializeHfComptrollerMock(
            MaticAddresses.DAI,
            MaticAddresses.hDAI,
            MaticAddresses.USDC,
            MaticAddresses.hUSDC,
          );
          await mocksSet.mockedComptroller.setGetAccountLiquidityFails();

          await expect(
            makeBorrowTest(
              MaticAddresses.DAI,
              mocksSet.mockedCollateralCToken.address,
              MaticAddresses.HOLDER_DAI,
              MaticAddresses.USDC,
              mocksSet.mockedBorrowCToken.address,
              "1999",
              {useHfComptrollerMock: mocksSet.mockedComptroller}
            )
          ).revertedWith("TC-22 liquidity failed"); // CTOKEN_GET_ACCOUNT_LIQUIDITY_FAILED
        });
        it("should revert if liquidity balance is incorrect after borrow", async () => {
          const mocksSet = await initializeHfComptrollerMock(
            MaticAddresses.DAI,
            MaticAddresses.hDAI,
            MaticAddresses.USDC,
            MaticAddresses.hUSDC,
          );
          await mocksSet.mockedComptroller.setGetAccountLiquidityReturnsIncorrectLiquidity();

          await expect(
            makeBorrowTest(
              MaticAddresses.DAI,
              mocksSet.mockedCollateralCToken.address,
              MaticAddresses.HOLDER_DAI,
              MaticAddresses.USDC,
              mocksSet.mockedBorrowCToken.address,
              "1999",
              {useHfComptrollerMock: mocksSet.mockedComptroller}
            )
          ).revertedWith("TC-23 incorrect liquidity"); // INCORRECT_RESULT_LIQUIDITY
        });
        it("should revert if mint fails", async () => {
          const mocksSet = await initializeHfComptrollerMock(
            MaticAddresses.DAI,
            MaticAddresses.hDAI,
            MaticAddresses.USDC,
            MaticAddresses.hUSDC,
          );
          await mocksSet.mockedComptroller.setMintFails();

          await expect(
            makeBorrowTest(
              MaticAddresses.DAI,
              mocksSet.mockedCollateralCToken.address,
              MaticAddresses.HOLDER_DAI,
              MaticAddresses.USDC,
              mocksSet.mockedBorrowCToken.address,
              "1999",
              {useHfComptrollerMock: mocksSet.mockedComptroller}
            )
          ).revertedWith("TC-17 mint failed"); // MINT_FAILED
        });
        it("should revert if borrow fails", async () => {
          const mocksSet = await initializeHfComptrollerMock(
            MaticAddresses.DAI,
            MaticAddresses.hDAI,
            MaticAddresses.USDC,
            MaticAddresses.hUSDC,
          );
          await mocksSet.mockedComptroller.setBorrowFails();

          await expect(
            makeBorrowTest(
              MaticAddresses.DAI,
              mocksSet.mockedCollateralCToken.address,
              MaticAddresses.HOLDER_DAI,
              MaticAddresses.USDC,
              mocksSet.mockedBorrowCToken.address,
              "1999",
              {useHfComptrollerMock: mocksSet.mockedComptroller}
            )
          ).revertedWith("TC-20 borrow failed"); // BORROW_FAILED
        });
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

      repayResultsCollateralAmountOut: BigNumber;
      repayResultsReturnedBorrowAmountOut?: BigNumber;
    }

    interface IMakeRepayBadPathsParams {
      amountToRepayStr?: string;
      makeRepayAsNotTc?: boolean;
      closePosition?: boolean;
      useHfComptrollerMock?: HfComptrollerMock;
      returnNotZeroTokenBalanceAfterRedeem?: boolean;
      returnNotZeroBorrowBalanceAfterRedeem?: boolean;
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
        {
          targetHealthFactor2: 200,
          useHfComptrollerMock: badPathsParams?.useHfComptrollerMock
        }
      );
      const borrowResults = await HundredFinanceTestUtils.makeBorrow(deployer, init, undefined);

      const amountToRepay = badPathsParams?.amountToRepayStr
        ? parseUnits(badPathsParams?.amountToRepayStr, borrowToken.decimals)
        : undefined;
      await HundredFinanceTestUtils.putDoubleBorrowAmountOnUserBalance(init, borrowHolder);

      const userBorrowAssetBalanceBeforeRepay = await init.borrowToken.token.balanceOf(init.userContract.address);
      const statusBeforeRepay: IPoolAdapterStatus = await init.hfPoolAdapterTC.getStatus();

      if (badPathsParams?.useHfComptrollerMock) {
        if (badPathsParams?.returnNotZeroTokenBalanceAfterRedeem) {
          await badPathsParams?.useHfComptrollerMock.setReturnNotZeroTokenBalanceAfterRedeem();
        }
        if (badPathsParams?.returnNotZeroBorrowBalanceAfterRedeem) {
          await badPathsParams?.useHfComptrollerMock.setReturnNotZeroBorrowBalanceAfterRedeem();
        }
      }
      const makeRepayResults = await HundredFinanceTestUtils.makeRepay(
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
      describe("Supply matic", () => {
        const collateralAsset = MaticAddresses.WMATIC;
        const collateralCToken = MaticAddresses.hMATIC;
        const collateralHolder = MaticAddresses.HOLDER_WMATIC;
        const borrowAsset = MaticAddresses.DAI;
        const borrowCToken = MaticAddresses.hDAI;
        const borrowHolder = MaticAddresses.HOLDER_DAI;
        let results: IMakeFullRepayTestResults;
        let snapshotLocal: string;
        before(async function () {
          snapshotLocal = await TimeUtils.snapshot();
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
        after(async function () {
          await TimeUtils.rollback(snapshotLocal);
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
          const aaveTokensBalance = await IERC20Metadata__factory.connect(
            collateralCToken,
            deployer
          ).balanceOf(results.init.hfPoolAdapterTC.address);
          expect(collateralBalanceATokens.eq(aaveTokensBalance)).eq(true);

        });
        it("should withdraw expected collateral amount", async () => {
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
        let snapshotLocal: string;
        before(async function () {
          snapshotLocal = await TimeUtils.snapshot();
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
        after(async function () {
          await TimeUtils.rollback(snapshotLocal);
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
          const aaveTokensBalance = await IERC20Metadata__factory.connect(
            collateralCToken,
            deployer
          ).balanceOf(results.init.hfPoolAdapterTC.address);
          expect(collateralBalanceATokens.eq(aaveTokensBalance)).eq(true);

        });
        it("should withdraw expected collateral amount", async () => {
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
        let snapshotLocal: string;
        before(async function () {
          snapshotLocal = await TimeUtils.snapshot();
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
        after(async function () {
          await TimeUtils.rollback(snapshotLocal);
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
          const aaveTokensBalance = await IERC20Metadata__factory.connect(
            collateralCToken,
            deployer
          ).balanceOf(results.init.hfPoolAdapterTC.address);
          expect(collateralBalanceATokens.eq(aaveTokensBalance)).eq(true);

        });
        it("should withdraw expected collateral amount", async () => {
          const receivedCollateralAmount = await results.collateralToken.token.balanceOf(results.init.userContract.address);
          expect(areAlmostEqual(receivedCollateralAmount, results.init.collateralAmount)).eq(true);
        });
        it("repay() should return expected collateral amount", async () => {
          expect(areAlmostEqual(results.repayResultsCollateralAmountOut, results.init.collateralAmount)).eq(true);
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
        ).revertedWith("TC-8 tetu converter only"); // TETU_CONVERTER_ONLY
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
        ).revertedWith("TC-55 close position not allowed"); // CLOSE_POSITION_PARTIAL
      });
      describe("Use mocked HfComptroller", () => {
        it("normal repay should work correctly", async () => {
          const results = await makeFullRepayTest(
            collateralAsset,
            collateralCToken,
            collateralHolder,
            "1999",
            borrowAsset,
            borrowCToken,
            borrowHolder
          );
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
        it("should revert if repayBorrow fails", async () => {
          const mocksSet = await initializeHfComptrollerMock(collateralAsset, collateralCToken, borrowAsset, borrowCToken);
          await mocksSet.mockedComptroller.setRepayBorrowFails();
          await expect(
            makeFullRepayTest(
              collateralAsset,
              mocksSet.mockedCollateralCToken.address,
              collateralHolder,
              "1999",
              borrowAsset,
              mocksSet.mockedBorrowCToken.address,
              borrowHolder,
              {
                makeRepayAsNotTc: true,
                useHfComptrollerMock: mocksSet.mockedComptroller
              }
            )
          ).revertedWith("TC-27 repay failed"); // REPAY_FAILED
        });
        it("should revert if redeem fails", async () => {
          const mocksSet = await initializeHfComptrollerMock(collateralAsset, collateralCToken, borrowAsset, borrowCToken);

          await mocksSet.mockedComptroller.setRedeemFails();
          await expect(
            makeFullRepayTest(
              collateralAsset,
              mocksSet.mockedCollateralCToken.address,
              collateralHolder,
              "1999",
              borrowAsset,
              mocksSet.mockedBorrowCToken.address,
              borrowHolder,
              {
                makeRepayAsNotTc: true,
                useHfComptrollerMock: mocksSet.mockedComptroller
              }
            )
          ).revertedWith("TC-26 redeem failed"); // REDEEM_FAILED
        });
        it("should revert if getAccountSnapshot for collateral fails", async () => {
          const mocksSet = await initializeHfComptrollerMock(collateralAsset, collateralCToken, borrowAsset, borrowCToken);

          await mocksSet.mockedBorrowCToken.setCollateralTokenGetAccountSnapshotFailsAfterCallingBorrowBalanceCurrent(3);
          await expect(
            makeFullRepayTest(
              collateralAsset,
              mocksSet.mockedCollateralCToken.address,
              collateralHolder,
              "1999",
              borrowAsset,
              mocksSet.mockedBorrowCToken.address,
              borrowHolder,
              {
                makeRepayAsNotTc: true,
                useHfComptrollerMock: mocksSet.mockedComptroller,
              }
            )
          ).revertedWith("TC-21 snapshot failed"); // CTOKEN_GET_ACCOUNT_SNAPSHOT_FAILED
        });
        it("should revert if getAccountSnapshot for borrow fails", async () => {
          const mocksSet = await initializeHfComptrollerMock(collateralAsset, collateralCToken, borrowAsset, borrowCToken);

          await mocksSet.mockedBorrowCToken.setBorrowTokenGetAccountSnapshotFailsAfterCallingBorrowBalanceCurrent(3);
          await expect(
            makeFullRepayTest(
              collateralAsset,
              mocksSet.mockedCollateralCToken.address,
              collateralHolder,
              "1999",
              borrowAsset,
              mocksSet.mockedBorrowCToken.address,
              borrowHolder,
              {
                makeRepayAsNotTc: true,
                useHfComptrollerMock: mocksSet.mockedComptroller
              }
            )
          ).revertedWith("TC-21 snapshot failed"); // CTOKEN_GET_ACCOUNT_SNAPSHOT_FAILED
        });
        it("should revert with CLOSE_POSITION_FAILED if token balance is not zero after full repay", async () => {
          const mocksSet = await initializeHfComptrollerMock(collateralAsset, collateralCToken, borrowAsset, borrowCToken);

          await expect(
            makeFullRepayTest(
              collateralAsset,
              mocksSet.mockedCollateralCToken.address,
              collateralHolder,
              "1999",
              borrowAsset,
              mocksSet.mockedBorrowCToken.address,
              borrowHolder,
              {
                useHfComptrollerMock: mocksSet.mockedComptroller,
                returnNotZeroTokenBalanceAfterRedeem: true
              }
            )
          ).revertedWith("TC-24 close position failed"); // CLOSE_POSITION_FAILED
        });
        it("should revert with CLOSE_POSITION_FAILED if borrow balance is not zero after full repay", async () => {
          const mocksSet = await initializeHfComptrollerMock(collateralAsset, collateralCToken, borrowAsset, borrowCToken);

          await expect(
            makeFullRepayTest(
              collateralAsset,
              mocksSet.mockedCollateralCToken.address,
              collateralHolder,
              "1999",
              borrowAsset,
              mocksSet.mockedBorrowCToken.address,
              borrowHolder,
              {
                useHfComptrollerMock: mocksSet.mockedComptroller,
                returnNotZeroBorrowBalanceAfterRedeem: true
              }
            )
          ).revertedWith("TC-24 close position failed"); // CLOSE_POSITION_FAILED

        });
        it("should revert with WRONG_BORROWED_BALANCE if amount to repay is less than borrow balance during full repay", async () => {
          const mocksSet = await initializeHfComptrollerMock(collateralAsset, collateralCToken, borrowAsset, borrowCToken);

          await mocksSet.mockedBorrowCToken.setReturnBorrowBalance1AfetCallingBorrowBalanceCurrent();
          await expect(
            makeFullRepayTest(
              collateralAsset,
              mocksSet.mockedCollateralCToken.address,
              collateralHolder,
              "1999",
              borrowAsset,
              mocksSet.mockedBorrowCToken.address,
              borrowHolder,
              {
                useHfComptrollerMock: mocksSet.mockedComptroller,
                amountToRepayStr: "10" // we need to make a partial repay
              }
            )
          ).revertedWith("TC-15 wrong borrow balance"); // WRONG_BORROWED_BALANCE

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
      useHfComptrollerMock?: HfComptrollerMock;
      ignoreBorrowAtRebalance?: boolean;
      borrowFails?: boolean;
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
        {
          targetHealthFactor2: targetHealthFactorInitial2,
          useHfComptrollerMock: badPathsParams?.useHfComptrollerMock
        }
      );

      // This test requires two borrow: initial and borrow-to-rebalance
      // If market has too few amount, we cannot borrow all max allowed amount initially
      // because we need some part of the amount to rebalance. So, in this case we need to reduce initial amounts.
      const finalAmountToBorrow = d.amountToBorrow.eq(d.plan.maxAmountToBorrow)
        ? d.amountToBorrow.div(10)
        : d.amountToBorrow;
      const finalCollateralAmount = d.amountToBorrow.eq(d.plan.maxAmountToBorrow)
        ? d.collateralAmount.div(10)
        : d.collateralAmount;

      // setup high values for all health factors
      await d.controller.setMaxHealthFactor2(maxHealthFactorInitial2);
      await d.controller.setTargetHealthFactor2(targetHealthFactorInitial2);
      await d.controller.setMinHealthFactor2(minHealthFactorInitial2);

      // make borrow
      if (! badPathsParams?.skipBorrow) {
        await transferAndApprove(
          collateralToken.address,
          d.userContract.address,
          await d.controller.tetuConverter(),
          finalCollateralAmount,
          d.hfPoolAdapterTC.address
        );

        await d.hfPoolAdapterTC.borrow(
          finalCollateralAmount,
          finalAmountToBorrow,
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

      const expectedAdditionalBorrowAmount = finalAmountToBorrow.mul(
        badPathsParams?.additionalAmountCorrectionFactor
          ? badPathsParams.additionalAmountCorrectionFactor
          : 1
      );
      console.log("expectedAdditionalBorrowAmount", expectedAdditionalBorrowAmount);

      // make additional borrow
      const poolAdapterSigner = badPathsParams?.makeBorrowToRebalanceAsDeployer
        ? IPoolAdapter__factory.connect(d.hfPoolAdapterTC.address, deployer)
        : d.hfPoolAdapterTC;
      if (badPathsParams?.ignoreBorrowAtRebalance && badPathsParams.useHfComptrollerMock) {
        badPathsParams.useHfComptrollerMock?.setIgnoreBorrow();
      }
      if (badPathsParams?.borrowFails && badPathsParams.useHfComptrollerMock) {
        badPathsParams.useHfComptrollerMock?.setBorrowFails();
      }
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

      const collateralAmount = parseUnits("100000", collateralToken.decimals);
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
    async function testMaticUSDC(
      badPathParams?: IMakeTestBorrowToRebalanceBadPathParams
    ) : Promise<IMakeTestBorrowToRebalanceResults> {
      const collateralAsset = MaticAddresses.WMATIC;
      const collateralHolder = MaticAddresses.HOLDER_WMATIC;
      const collateralCTokenAddress = MaticAddresses.hMATIC;

      const borrowAsset = MaticAddresses.USDC;
      const borrowCTokenAddress = MaticAddresses.hUSDC;
      const borrowHolder = MaticAddresses.HOLDER_USDC;

      const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
      const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);
      console.log("collateralToken.decimals", collateralToken.decimals);
      console.log("borrowToken.decimals", borrowToken.decimals);

      const collateralAmount = parseUnits("100000", collateralToken.decimals);
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
    async function testUSDCMatic(
      badPathParams?: IMakeTestBorrowToRebalanceBadPathParams
    ) : Promise<IMakeTestBorrowToRebalanceResults> {
      const collateralAsset = MaticAddresses.USDC;
      const collateralHolder = MaticAddresses.HOLDER_USDC;
      const collateralCTokenAddress = MaticAddresses.hUSDC;

      const borrowAsset = MaticAddresses.WMATIC;
      const borrowCTokenAddress = MaticAddresses.hMATIC;
      const borrowHolder = MaticAddresses.HOLDER_WMATIC;

      const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
      const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);
      console.log("collateralToken.decimals", collateralToken.decimals);
      console.log("borrowToken.decimals", borrowToken.decimals);

      const collateralAmount = parseUnits("1000", collateralToken.decimals);
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
      it("should return expected values for DAI:USDC", async () => {
        const r = await testDaiUSDC();
        const ret = [
          // eslint-disable-next-line @typescript-eslint/no-loss-of-precision
          Math.round(r.afterBorrowHealthFactor18.div(getBigNumberFrom(1, 15)).toNumber() / 10.),
          // eslint-disable-next-line @typescript-eslint/no-loss-of-precision
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
      it("should return expected values for MATIC:USDC", async () => {
        const r = await testMaticUSDC();
        const ret = [
          // eslint-disable-next-line @typescript-eslint/no-loss-of-precision
          Math.round(r.afterBorrowHealthFactor18.div(getBigNumberFrom(1, 15)).toNumber() / 10.),
          // eslint-disable-next-line @typescript-eslint/no-loss-of-precision
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
      it("should return expected values for USDC:MATIC", async () => {
        const r = await testUSDCMatic();
        const ret = [
          // eslint-disable-next-line @typescript-eslint/no-loss-of-precision
          Math.round(r.afterBorrowHealthFactor18.div(getBigNumberFrom(1, 15)).toNumber() / 10.),
          // eslint-disable-next-line @typescript-eslint/no-loss-of-precision
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
          await expect(
            testDaiUSDC({makeBorrowToRebalanceAsDeployer: true})
          ).revertedWith("TC-8 tetu converter only");
        });
      });
      describe("Position is not registered", () => {
        it("should revert", async () => {
          await expect(
            testDaiUSDC({skipBorrow: true})
          ).revertedWith("TC-11 position not registered"); // BORROW_POSITION_IS_NOT_REGISTERED
        });
      });
      describe("Result health factor is less min allowed one", () => {
        it("should revert", async () => {
          await expect(
            testDaiUSDC({additionalAmountCorrectionFactor: 3})
          ).revertedWith("TC-3 wrong health factor"); // WRONG_HEALTH_FACTOR
        });
      });
      describe("Use mocked HfComptroller", () => {
        it("should revert if comptroller doesn't return borrowed amount", async () => {
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

          const collateralAmount = parseUnits("100000", collateralToken.decimals);
          console.log(collateralAmount, collateralAmount);

          const mocksSet = await initializeHfComptrollerMock(
            collateralAsset,
            collateralCTokenAddress,
            borrowAsset,
            borrowCTokenAddress,
          );

          await expect(
            makeTestBorrowToRebalance(
              collateralToken,
              collateralHolder,
              mocksSet.mockedCollateralCToken.address,
              collateralAmount,
              borrowToken,
              mocksSet.mockedBorrowCToken.address,
              borrowHolder,
              {
                useHfComptrollerMock: mocksSet.mockedComptroller,
                ignoreBorrowAtRebalance: true
              }
            )
          ).revertedWith("TC-15 wrong borrow balance"); // WRONG_BORROWED_BALANCE
        });
        it("should revert if borrow fails", async () => {
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

          const collateralAmount = parseUnits("100000", collateralToken.decimals);
          console.log(collateralAmount, collateralAmount);

          const mocksSet = await initializeHfComptrollerMock(
            collateralAsset,
            collateralCTokenAddress,
            borrowAsset,
            borrowCTokenAddress,
          );

          await expect(
            makeTestBorrowToRebalance(
              collateralToken,
              collateralHolder,
              mocksSet.mockedCollateralCToken.address,
              collateralAmount,
              borrowToken,
              mocksSet.mockedBorrowCToken.address,
              borrowHolder,
              {
                useHfComptrollerMock: mocksSet.mockedComptroller,
                ignoreBorrowAtRebalance: true,
                borrowFails: true
              }
            )
          ).revertedWith("TC-15 wrong borrow balance"); // WRONG_BORROWED_BALANCE
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

    interface IHfMakeRepayToRebalanceInputParamsWithCTokens extends IMakeRepayToRebalanceInputParamsWithCTokens {
      useHfComptrollerMock?: HfComptrollerMock;
    }

    /**
     * Prepare HundredFinance pool adapter.
     * Set low health factors.
     * Make borrow.
     * Increase health factor twice.
     * Make repay to rebalance.
     */
    async function makeRepayToRebalance (
      p: IHfMakeRepayToRebalanceInputParamsWithCTokens
    ) : Promise<IMakeRepayToRebalanceResults>{
      const d = await HundredFinanceTestUtils.prepareToBorrow(
        deployer,
        p.collateralToken,
        p.collateralHolder,
        p.collateralCTokenAddress,
        p.collateralAmount,
        p.borrowToken,
        p.borrowCTokenAddress,
        {
          targetHealthFactor2: targetHealthFactorInitial2,
          useHfComptrollerMock: p?.useHfComptrollerMock
        }
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
      const afterChangeHealthFactorStatus = await d.hfPoolAdapterTC.getStatus();
      console.log("after borrow:", afterChangeHealthFactorStatus);

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

      if (p?.useHfComptrollerMock && p.badPathsParams?.repayBorrowFails) {
        p?.useHfComptrollerMock.setRepayBorrowFails();
      }

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
      badPathsParams?: IMakeRepayRebalanceBadPathParams,
      useHfComptrollerMock?: HfComptrollerMock
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
        borrowCTokenAddress: assets.borrowCTokenAddress,
        useHfComptrollerMock
      });

      console.log(r);

      const ret = [
        Math.round(r.afterBorrowStatus.healthFactor18.div(
          // eslint-disable-next-line @typescript-eslint/no-loss-of-precision
          getBigNumberFrom(1, 15)).toNumber() / 10.
        ),
        Math.round(r.afterRepayToRebalanceStatus.healthFactor18.div(
          // eslint-disable-next-line @typescript-eslint/no-loss-of-precision
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
          collateralAmountStr: "10000",
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
            const r = await daiWMatic(false);

            expect(r.ret).eq(r.expected);
          });
        });
        describe("USDC : USDT", () => {
          it("should return expected values", async () => {
            const r = await usdcUsdt(false);

            expect(r.ret).eq(r.expected);
          });
        });
        describe("WBTC : WETH", () => {
          it("should return expected values", async () => {
            const r = await wbtcWETH(false);

            expect(r.ret).eq(r.expected);
          });
        });
      });
      describe("Use collateral asset to repay", () => {
        describe("Dai : WMatic", () => {
          it("should return expected values", async () => {
            const r = await daiWMatic(true);

            expect(r.ret).eq(r.expected);
          });
        });
        describe("USDC : USDT", () => {
          it("should return expected values", async () => {
            const r = await usdcUsdt(true);

            expect(r.ret).eq(r.expected);
          });
        });
        describe("WBTC : WETH", () => {
          it("should return expected values", async () => {
            const r = await wbtcWETH(true);

            expect(r.ret).eq(r.expected);
          });
        });
      });
    });

    describe("Bad paths", () => {
      describe("Not TetuConverter and not user", () => {
        it("should revert", async () => {
          await expect(
            daiWMatic(false,{makeRepayToRebalanceAsDeployer: true})
          ).revertedWith("TC-8 tetu converter only"); // TETU_CONVERTER_ONLY
        });
      });
      describe("Position is not registered", () => {
        it("should revert", async () => {
          await expect(
            daiWMatic(false,{skipBorrow: true})
          ).revertedWith("TC-11 position not registered");
        });
      });
      describe("Result health factor is less min allowed one", () => {
        it("should revert", async () => {
          await expect(
            daiWMatic(false,{additionalAmountCorrectionFactorDiv: 100})
          ).revertedWith("TC-3 wrong health factor"); // WRONG_HEALTH_FACTOR
        });
      });
      describe("Try to repay amount greater then the debt", () => {
        it("should revert", async () => {
          await expect(
            daiWMatic(false,{additionalAmountCorrectionFactorMul: 100})
          ).revertedWith("TC-40 repay to rebalance not allowed"); // REPAY_TO_REBALANCE_NOT_ALLOWED
        });
      });
      describe("Use mocked HfComptroller", () => {
        it("should revert if repayBorrow fails", async () => {
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

          const collateralAmount = parseUnits("100000", collateralToken.decimals);
          console.log(collateralAmount, collateralAmount);

          const mocksSet = await initializeHfComptrollerMock(
            collateralAsset,
            collateralCTokenAddress,
            borrowAsset,
            borrowCTokenAddress,
          );

          await expect(
            makeRepayToRebalanceTest(
              {
                borrowCTokenAddress: mocksSet.mockedBorrowCToken.address,
                collateralCTokenAddress: mocksSet.mockedCollateralCToken.address,
                collateralAsset,
                borrowAsset,
                borrowHolder,
                collateralAmountStr: "1000",
                collateralHolder
              },
              false, // repay using borrow asset
              {
                repayBorrowFails: true
              },
              mocksSet.mockedComptroller
            )
          ).revertedWith("TC-27 repay failed"); // REPAY_FAILED
        });
      });
    });
  });

  describe("updateBalance", () => {
    it("should return expected values", async () => {
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
      tokenAddressProviderMock?: TokenAddressProviderMock;
    }
    interface IMakeInitializePoolAdapterResults {
      user: string;
      converter: string;
      collateralAsset: string;
      borrowAsset: string;
      controller: ConverterController;
      poolAdapter: HfPoolAdapter;
      tokenAddressProvider: ITokenAddressProvider;
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
        {networkId: POLYGON_NETWORK_ID, tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
      );
      const poolAdapter = await AdaptersHelper.createHundredFinancePoolAdapter(deployer);
      const tokenAddressProvider = badParams?.tokenAddressProviderMock
        ? badParams.tokenAddressProviderMock
        : await AdaptersHelper.createHundredFinancePlatformAdapter(
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
        const r = await makeInitializePoolAdapterTest();
        expect(r.ret).eq(r.expected);
      });
    });
    describe("Bad paths", () => {
      it("should revert on zero controller", async () => {
        await expect(
          makeInitializePoolAdapterTest({zeroController: true})
        ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
      });
      it("should revert on zero user", async () => {
        await expect(
          makeInitializePoolAdapterTest({zeroUser: true})
        ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
      });
      it("should revert on zero pool", async () => {
        await expect(
          makeInitializePoolAdapterTest({zeroPool: true})
        ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
      });
      it("should revert on zero converter", async () => {
        await expect(
          makeInitializePoolAdapterTest({zeroConverter: true})
        ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
      });
      it("should revert on zero collateral asset", async () => {
        await expect(
          makeInitializePoolAdapterTest({zeroCollateralAsset: true})
        ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
      });
      it("should revert on zero borrow asset", async () => {
        await expect(
          makeInitializePoolAdapterTest({zeroBorrowAsset: true})
        ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
      });
      it("should revert on zero token address provider", async () => {
        await expect(
          makeInitializePoolAdapterTest({zeroTokenAddressProvider: true})
        ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
      });
      it("should revert on second initialization", async () => {
        const d = await makeInitializePoolAdapter();
        await expect(
          d.poolAdapter.initialize(
            d.controller.address,
            d.tokenAddressProvider.address,
            MaticAddresses.HUNDRED_FINANCE_COMPTROLLER,
            d.user,
            d.collateralAsset,
            d.borrowAsset,
            d.converter
          )
        ).revertedWith("Initializable: contract is already initialized");
      });
      it("should revert if token address provider returns zero cTokenCollateral", async () => {
        const tokenAddressProviderMock = await MocksHelper.createTokenAddressProviderMock(
          deployer,
          Misc.ZERO_ADDRESS, // (!)
          MaticAddresses.hMATIC
        );
        await expect(
          makeInitializePoolAdapter({tokenAddressProviderMock})
        ).revertedWith("TC-16 ctoken not found"); // C_TOKEN_NOT_FOUND
      });
      it("should revert if token address provider returns zero cTokenBorrow", async () => {
        const tokenAddressProviderMock = await MocksHelper.createTokenAddressProviderMock(
          deployer,
          MaticAddresses.hMATIC,
          Misc.ZERO_ADDRESS, // (!)
        );
        await expect(
          makeInitializePoolAdapter({tokenAddressProviderMock})
        ).revertedWith("TC-16 ctoken not found"); // C_TOKEN_NOT_FOUND
      });
    });
  });

  describe("claimRewards", () => {
    it("should return expected values", async () => {
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
    describe("Good paths", () => {
      it("user has made a borrow, should return expected status", async () => {
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
    describe("Bad paths", () => {
      it("should revert if getAccountSnapshot for collateral fails", async () => {
        const collateralAsset = MaticAddresses.USDT;
        const collateralCToken = MaticAddresses.hUSDT;
        const collateralHolder = MaticAddresses.HOLDER_USDT;
        const borrowAsset = MaticAddresses.USDC;
        const borrowCToken = MaticAddresses.hUSDC;

        const mocksSet = await initializeHfComptrollerMock(collateralAsset, collateralCToken, borrowAsset, borrowCToken);

        const results = await makeBorrowTest(
          collateralAsset,
          mocksSet.mockedCollateralCToken.address,
          collateralHolder,
          borrowAsset,
          mocksSet.mockedBorrowCToken.address,
          "1999",
          {
            useHfComptrollerMock: mocksSet.mockedComptroller
          }
        );
        await mocksSet.mockedCollateralCToken.setGetAccountSnapshotFails();
        await expect(
          results.init.hfPoolAdapterTC.getStatus()
        ).revertedWith("TC-21 snapshot failed"); // CTOKEN_GET_ACCOUNT_SNAPSHOT_FAILED
      });
      it("should revert if getAccountSnapshot for borrow fails", async () => {
        const collateralAsset = MaticAddresses.USDT;
        const collateralCToken = MaticAddresses.hUSDT;
        const collateralHolder = MaticAddresses.HOLDER_USDT;
        const borrowAsset = MaticAddresses.USDC;
        const borrowCToken = MaticAddresses.hUSDC;

        const mocksSet = await initializeHfComptrollerMock(collateralAsset, collateralCToken, borrowAsset, borrowCToken);

        const results = await makeBorrowTest(
          collateralAsset,
          mocksSet.mockedCollateralCToken.address,
          collateralHolder,
          borrowAsset,
          mocksSet.mockedBorrowCToken.address,
          "1999",
          {
            useHfComptrollerMock: mocksSet.mockedComptroller
          }
        );

        await mocksSet.mockedBorrowCToken.setGetAccountSnapshotFails();

        await expect(
          results.init.hfPoolAdapterTC.getStatus()
        ).revertedWith("TC-21 snapshot failed"); // CTOKEN_GET_ACCOUNT_SNAPSHOT_FAILED
      });
    });
  });

  describe("getCollateralAmountToReturn", () => {
    const collateralAsset = MaticAddresses.DAI;
    const collateralCToken = MaticAddresses.hDAI;
    const collateralHolder = MaticAddresses.HOLDER_DAI;
    const borrowAsset = MaticAddresses.WMATIC;
    const borrowCToken = MaticAddresses.hMATIC;
    let results: IMakeBorrowTestResults;
    let snapshotLocal: string;
    before(async function () {
      snapshotLocal = await TimeUtils.snapshot();
      results = await makeBorrowTest(
        collateralAsset,
        collateralCToken,
        collateralHolder,
        borrowAsset,
        borrowCToken,
        "1999"
      );
    });
    after(async function () {
      await TimeUtils.rollback(snapshotLocal);
    });
    describe("Good paths", () => {
      describe("Full repay", () => {
        it("should return expected values", async () => {
          const status = await results.init.hfPoolAdapterTC.getStatus();
          const tetuConverterAsUser = ITetuConverter__factory.connect(
            await results.init.controller.tetuConverter(),
            await DeployerUtils.startImpersonate(results.init.userContract.address)
          );
          const {collateralAmountOut} = await tetuConverterAsUser.callStatic.quoteRepay(
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
          const status = await results.init.hfPoolAdapterTC.getStatus();
          const tetuConverterAsUser = ITetuConverter__factory.connect(
            await results.init.controller.tetuConverter(),
            await DeployerUtils.startImpersonate(results.init.userContract.address)
          );
          const {collateralAmountOut} = await tetuConverterAsUser.callStatic.quoteRepay(
            await tetuConverterAsUser.signer.getAddress(),
            results.init.collateralToken.address,
            results.init.borrowToken.address,
            status.amountToPay.div(2) // 50%
          );

          const ret = areAlmostEqual(collateralAmountOut.mul(2), status.collateralAmount, 5);
          console.log("ret", collateralAmountOut.mul(2), status.collateralAmount);
          expect(ret).eq(true);
        });
      });
      describe("Partial repay 5%", () => {
        it("should return expected values", async () => {
          const status = await results.init.hfPoolAdapterTC.getStatus();
          const tetuConverterAsUser = ITetuConverter__factory.connect(
            await results.init.controller.tetuConverter(),
            await DeployerUtils.startImpersonate(results.init.userContract.address)
          );
          const {collateralAmountOut} = await tetuConverterAsUser.callStatic.quoteRepay(
            await tetuConverterAsUser.signer.getAddress(),
            results.init.collateralToken.address,
            results.init.borrowToken.address,
            status.amountToPay.div(20) // 5%
          );

          const ret = areAlmostEqual(collateralAmountOut.mul(20), status.collateralAmount, 5);
          console.log("ret", collateralAmountOut.mul(20), status.collateralAmount);
          expect(ret).eq(true);
        });
      });
    });
  });
//endregion Unit tests

});
