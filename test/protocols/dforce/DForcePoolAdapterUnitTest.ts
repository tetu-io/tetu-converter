import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers, web3} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {
  BorrowManager__factory,
  ConverterController,
  DebtMonitor__factory,
  DForceControllerMock, DForceCTokenMock,
  DForcePoolAdapter, IDForceRewardDistributor__factory, IERC20__factory,
  DForcePoolAdapter__factory,
  IERC20Metadata__factory,
  IPoolAdapter__factory, ITetuConverter__factory,
  ITokenAddressProvider,
  TokenAddressProviderMock, IWmatic__factory,
} from "../../../typechain";
import { ValueReceivedEventObject } from '../../../typechain/contracts/protocols/dforce/DForcePoolAdapter';
import {expect} from "chai";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {TokenDataTypes} from "../../baseUT/types/TokenDataTypes";
import {DForceHelper} from "../../../scripts/integration/helpers/DForceHelper";
import {Misc} from "../../../scripts/utils/Misc";
import {IDForceCalcAccountEquityResults} from "../../baseUT/apr/aprDForce";
import {areAlmostEqual, toStringWithRound} from "../../baseUT/utils/CommonUtils";
import {IPoolAdapterStatus} from "../../baseUT/types/BorrowRepayDataTypes";
import {
  IAssetsInputParamsWithCTokens,
  IMakeRepayRebalanceBadPathParams,
  IMakeRepayToRebalanceInputParamsWithCTokens
} from "../../baseUT/protocols/shared/sharedDataTypes";
import {SharedRepayToRebalanceUtils} from "../../baseUT/protocols/shared/sharedRepayToRebalanceUtils";
import {transferAndApprove} from "../../baseUT/utils/transferUtils";
import {
  DForceTestUtils,
  IBorrowResults,
  IMakeBorrowOrRepayBadPathsParams,
  IPrepareToBorrowResults
} from "../../baseUT/protocols/dforce/DForceTestUtils";
import {AdaptersHelper} from "../../baseUT/helpers/AdaptersHelper";
import {TetuConverterApp} from "../../baseUT/helpers/TetuConverterApp";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {MocksHelper} from "../../baseUT/helpers/MocksHelper";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {GAS_LIMIT} from "../../baseUT/GasLimit";

describe("DForcePoolAdapterUnitTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let controllerInstance: ConverterController;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[1];
    controllerInstance = await TetuConverterApp.createController(deployer);
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

    const init = await DForceTestUtils.prepareToBorrow(
      deployer,
      controllerInstance,
      collateralToken,
      collateralHolder,
      collateralCToken,
      parseUnits(collateralAmountStr, collateralToken.decimals),
      borrowToken,
      borrowCToken,
      {
        targetHealthFactor2: 200,
        useDForceControllerMock: badPathsParams?.useDForceControllerMock
      }
    );
    const borrowResults = await DForceTestUtils.makeBorrow(deployer, init, undefined, badPathsParams);
    return {
      init,
      borrowResults,
      collateralToken,
      borrowToken
    }
  }

  interface IDForceControllerMocksSet {
    mockedComptroller: DForceControllerMock;
    mockedCollateralCToken: DForceCTokenMock;
    mockedBorrowCToken: DForceCTokenMock;
  }
  async function initializeDForceControllerMock(
    collateralAsset: string,
    collateralCToken: string,
    borrowAsset: string,
    borrowCToken: string,
  ) : Promise<IDForceControllerMocksSet> {
    const mockedCollateralCToken = await MocksHelper.getNotInitializedDForceCTokenMock(deployer);
    const mockedBorrowCToken = await MocksHelper.getNotInitializedDForceCTokenMock(deployer);

    const mockedComptroller = await MocksHelper.getDForceControllerMock(
      deployer,
      collateralAsset,
      borrowAsset,
      collateralCToken,
      borrowCToken,
      mockedCollateralCToken.address,
      mockedBorrowCToken.address
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
        const collateralCToken = MaticAddresses.dForce_iDAI;
        const collateralHolder = MaticAddresses.HOLDER_DAI;
        const borrowAsset = MaticAddresses.WMATIC;
        const borrowCToken = MaticAddresses.dForce_iMATIC;
        let results: IMakeBorrowTestResults;
        before(async function () {
          if (!await isPolygonForkInUse()) return;
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
          const status = await results.init.dfPoolAdapterTC.getStatus();

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
          if (!await isPolygonForkInUse()) return;
          const ret = await DebtMonitor__factory.connect(
            await results.init.controller.debtMonitor(),
            await DeployerUtils.startImpersonate(results.init.dfPoolAdapterTC.address)
          ).isPositionOpened();
          expect(ret).eq(true);
        });
        it("should transfer expected amount to the user", async () => {
          if (!await isPolygonForkInUse()) return;
          const receivedBorrowAmount = await results.borrowToken.token.balanceOf(results.init.userContract.address);
          expect(receivedBorrowAmount.toString()).eq(results.borrowResults.borrowedAmount.toString());
        });
        it("should change collateralBalanceATokens", async () => {
          if (!await isPolygonForkInUse()) return;
          const collateralBalanceATokens = await results.init.dfPoolAdapterTC.collateralTokensBalance();
          const aaveTokensBalance = await IERC20Metadata__factory.connect(
            collateralCToken,
            deployer
          ).balanceOf(results.init.dfPoolAdapterTC.address);
          expect(collateralBalanceATokens.gte(aaveTokensBalance)).eq(true);
        });
      });
      describe("Supply matic", () => {
        const collateralAsset = MaticAddresses.WMATIC;
        const collateralCToken = MaticAddresses.dForce_iMATIC;
        const collateralHolder = MaticAddresses.HOLDER_WMATIC;
        const borrowAsset = MaticAddresses.USDC;
        const borrowCToken = MaticAddresses.dForce_iUSDC;
        let results: IMakeBorrowTestResults;
        before(async function () {
          if (!await isPolygonForkInUse()) return;
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
          const status = await results.init.dfPoolAdapterTC.getStatus();

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
          if (!await isPolygonForkInUse()) return;
          const ret = await DebtMonitor__factory.connect(
            await results.init.controller.debtMonitor(),
            await DeployerUtils.startImpersonate(results.init.dfPoolAdapterTC.address)
          ).isPositionOpened();
          expect(ret).eq(true);
        });
        it("should transfer expected amount to the user", async () => {
          if (!await isPolygonForkInUse()) return;
          const receivedBorrowAmount = await results.borrowToken.token.balanceOf(results.init.userContract.address);
          expect(receivedBorrowAmount.toString()).eq(results.borrowResults.borrowedAmount.toString());
        });
        it("should change collateralBalanceATokens", async () => {
          if (!await isPolygonForkInUse()) return;
          const collateralBalanceATokens = await results.init.dfPoolAdapterTC.collateralTokensBalance();
          const aaveTokensBalance = await IERC20Metadata__factory.connect(
            collateralCToken,
            deployer
          ).balanceOf(results.init.dfPoolAdapterTC.address);
          expect(collateralBalanceATokens.gte(aaveTokensBalance)).eq(true);
        });
      });
      describe("Supply and borrow not-matic (CRV, USDC)", () => {
        const collateralAsset = MaticAddresses.CRV;
        const collateralCToken = MaticAddresses.dForce_iCRV;
        const collateralHolder = MaticAddresses.HOLDER_CRV;
        const borrowAsset = MaticAddresses.USDC;
        const borrowCToken = MaticAddresses.dForce_iUSDC;
        let results: IMakeBorrowTestResults;
        before(async function () {
          if (!await isPolygonForkInUse()) return;
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
          const status = await results.init.dfPoolAdapterTC.getStatus();

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
          if (!await isPolygonForkInUse()) return;
          const ret = await DebtMonitor__factory.connect(
            await results.init.controller.debtMonitor(),
            await DeployerUtils.startImpersonate(results.init.dfPoolAdapterTC.address)
          ).isPositionOpened();
          expect(ret).eq(true);
        });
        it("should transfer expected amount to the user", async () => {
          if (!await isPolygonForkInUse()) return;
          const receivedBorrowAmount = await results.borrowToken.token.balanceOf(results.init.userContract.address);
          expect(receivedBorrowAmount.toString()).eq(results.borrowResults.borrowedAmount.toString());
        });
        it("should change collateralBalanceATokens", async () => {
          if (!await isPolygonForkInUse()) return;
          const collateralBalanceATokens = await results.init.dfPoolAdapterTC.collateralTokensBalance();
          const aaveTokensBalance = await IERC20Metadata__factory.connect(
            collateralCToken,
            deployer
          ).balanceOf(results.init.dfPoolAdapterTC.address);
          expect(collateralBalanceATokens.gte(aaveTokensBalance)).eq(true);
        });
      });
      describe("Supply and borrow not-matic (WBTC:ETH)", () => {
        const collateralAsset = MaticAddresses.WBTC;
        const collateralCToken = MaticAddresses.dForce_iWBTC;
        const collateralHolder = MaticAddresses.HOLDER_WBTC;
        const borrowAsset = MaticAddresses.USDC;
        const borrowCToken = MaticAddresses.dForce_iUSDC;
        let results: IMakeBorrowTestResults;
        before(async function () {
          if (!await isPolygonForkInUse()) return;
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
          const status = await results.init.dfPoolAdapterTC.getStatus();

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
          if (!await isPolygonForkInUse()) return;
          const ret = await DebtMonitor__factory.connect(
            await results.init.controller.debtMonitor(),
            await DeployerUtils.startImpersonate(results.init.dfPoolAdapterTC.address)
          ).isPositionOpened();
          expect(ret).eq(true);
        });
        it("should transfer expected amount to the user", async () => {
          if (!await isPolygonForkInUse()) return;
          const receivedBorrowAmount = await results.borrowToken.token.balanceOf(results.init.userContract.address);
          expect(receivedBorrowAmount.toString()).eq(results.borrowResults.borrowedAmount.toString());
        });
        it("should change collateralBalanceATokens", async () => {
          if (!await isPolygonForkInUse()) return;
          const collateralBalanceATokens = await results.init.dfPoolAdapterTC.collateralTokensBalance();
          const aaveTokensBalance = await IERC20Metadata__factory.connect(
            collateralCToken,
            deployer
          ).balanceOf(results.init.dfPoolAdapterTC.address);
          expect(collateralBalanceATokens.gte(aaveTokensBalance)).eq(true);
        });
      });
    });
    describe("Bad paths", () => {
      it("should revert if not tetu converter", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeBorrowTest(
            MaticAddresses.DAI,
            MaticAddresses.dForce_iDAI,
            MaticAddresses.HOLDER_DAI,
            MaticAddresses.USDC,
            MaticAddresses.dForce_iUSDC,
            "1999",
            {makeOperationAsNotTc: true}
          )
        ).revertedWith("TC-8 tetu converter only"); // TETU_CONVERTER_ONLY
      });
      describe("Use mocked DForceController", () => {
        it("should work correctly with mocked DForceController", async () => {
          if (!await isPolygonForkInUse()) return;
          const mocksSet = await initializeDForceControllerMock(
            MaticAddresses.DAI,
            MaticAddresses.dForce_iDAI,
            MaticAddresses.USDC,
            MaticAddresses.dForce_iUSDC,
          );
          const results = await makeBorrowTest(
            MaticAddresses.DAI,
            mocksSet.mockedCollateralCToken.address,
            MaticAddresses.HOLDER_DAI,
            MaticAddresses.USDC,
            mocksSet.mockedBorrowCToken.address,
            "1999",
            {useDForceControllerMock: mocksSet.mockedComptroller}
          );
          const status = await results.init.dfPoolAdapterTC.getStatus();

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
          if (!await isPolygonForkInUse()) return;
          const mocksSet = await initializeDForceControllerMock(
            MaticAddresses.DAI,
            MaticAddresses.dForce_iDAI,
            MaticAddresses.USDC,
            MaticAddresses.dForce_iUSDC,
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
              {useDForceControllerMock: mocksSet.mockedComptroller}
            )
          ).revertedWith("TC-15 wrong borrow balance"); // WRONG_BORROWED_BALANCE
        });
        it("should revert if liquidity balance is incorrect after borrow", async () => {
          if (!await isPolygonForkInUse()) return;
          const mocksSet = await initializeDForceControllerMock(
            MaticAddresses.DAI,
            MaticAddresses.dForce_iDAI,
            MaticAddresses.USDC,
            MaticAddresses.dForce_iUSDC,
          );
          await mocksSet.mockedComptroller.setIgnoreBorrowBalanceStored();

          await expect(
            makeBorrowTest(
              MaticAddresses.DAI,
              mocksSet.mockedCollateralCToken.address,
              MaticAddresses.HOLDER_DAI,
              MaticAddresses.USDC,
              mocksSet.mockedBorrowCToken.address,
              "1999",
              {useDForceControllerMock: mocksSet.mockedComptroller}
            )
          ).revertedWith("TC-23 incorrect liquidity"); // INCORRECT_RESULT_LIQUIDITY
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
      repayResults: IDForceCalcAccountEquityResults;
      userBorrowAssetBalanceBeforeRepay: BigNumber;
      userBorrowAssetBalanceAfterRepay: BigNumber;

      repayResultsCollateralAmountOut: BigNumber;
      repayResultsReturnedBorrowAmountOut?: BigNumber;
    }

    interface IMakeRepayParams {
      amountToRepayStr?: string;
      makeRepayAsNotTc?: boolean;
      closePosition?: boolean;
      useDForceControllerMock?: DForceControllerMock;
      returnNotZeroTokenBalanceAfterRedeem?: boolean;
      returnNotZeroBorrowBalanceStoredAfterRedeem?: boolean;
      setBorrowBalance1AfterCallingBorrowBalanceCurrent?: number;
      receiver?: string;
    }

    async function makeRepayTest(
      collateralAsset: string,
      collateralCToken: string,
      collateralHolder: string,
      collateralAmountStr: string,
      borrowAsset: string,
      borrowCToken: string,
      borrowHolder: string,
      params?: IMakeRepayParams
    ): Promise<IMakeFullRepayTestResults> {
      const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
      const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

      const init = await DForceTestUtils.prepareToBorrow(
        deployer,
        controllerInstance,
        collateralToken,
        collateralHolder,
        collateralCToken,
        parseUnits(collateralAmountStr, collateralToken.decimals),
        borrowToken,
        borrowCToken,
        {
          targetHealthFactor2: 200,
          useDForceControllerMock: params?.useDForceControllerMock
        }
      );
      const borrowResults = await DForceTestUtils.makeBorrow(
        deployer,
        init,
        undefined,
        {useDForceControllerMock: params?.useDForceControllerMock}
      );

      const amountToRepay = params?.amountToRepayStr
        ? parseUnits(params?.amountToRepayStr, borrowToken.decimals)
        : undefined;
      await DForceTestUtils.putDoubleBorrowAmountOnUserBalance(init, borrowHolder);

      const userBorrowAssetBalanceBeforeRepay = await init.borrowToken.token.balanceOf(init.userContract.address);
      const statusBeforeRepay: IPoolAdapterStatus = await init.dfPoolAdapterTC.getStatus();

      if (params?.useDForceControllerMock) {
        if (params?.returnNotZeroTokenBalanceAfterRedeem) {
          await params?.useDForceControllerMock.setReturnNotZeroTokenBalanceAfterRedeem();
        }
        if (params?.returnNotZeroBorrowBalanceStoredAfterRedeem) {
          await params?.useDForceControllerMock.setReturnNotZeroBorrowBalanceStoredAfterRedeem();
        }
        if (params?.setBorrowBalance1AfterCallingBorrowBalanceCurrent) {
          await params?.useDForceControllerMock.setBorrowBalance1AfterCallingBorrowBalanceCurrent(
            params?.setBorrowBalance1AfterCallingBorrowBalanceCurrent
          );
        }
        await params.useDForceControllerMock.setBorrowBalanceCurrentValue(
          amountToRepay || (await init.dfPoolAdapterTC.getStatus()).amountToPay
        );
      }

      const makeRepayResults = await DForceTestUtils.makeRepay(
        init,
        amountToRepay,
        params?.closePosition,
        {
          makeOperationAsNotTc: params?.makeRepayAsNotTc,
          receiver: params?.receiver
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
        const collateralCToken = MaticAddresses.dForce_iMATIC;
        const collateralHolder = MaticAddresses.HOLDER_WMATIC;
        const borrowAsset = MaticAddresses.DAI;
        const borrowCToken = MaticAddresses.dForce_iDAI;
        const borrowHolder = MaticAddresses.HOLDER_DAI;
        let results: IMakeFullRepayTestResults;
        before(async function () {
          if (!await isPolygonForkInUse()) return;
          results = await makeRepayTest(
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
          if (!await isPolygonForkInUse()) return;
          const status = await results.init.dfPoolAdapterTC.getStatus();
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
            await DeployerUtils.startImpersonate(results.init.dfPoolAdapterTC.address)
          ).isPositionOpened();
          expect(ret).eq(false);
        });
        it("should assign expected value to collateralBalanceATokens", async () => {
          if (!await isPolygonForkInUse()) return;
          const collateralBalanceATokens = await results.init.dfPoolAdapterTC.collateralTokensBalance();
          const aaveTokensBalance = await IERC20Metadata__factory.connect(
            collateralCToken,
            deployer
          ).balanceOf(results.init.dfPoolAdapterTC.address);
          expect(collateralBalanceATokens.eq(aaveTokensBalance)).eq(true);

        });
        it("should withdraw expected collateral amount", async () => {
          if (!await isPolygonForkInUse()) return;
          const receivedCollateralAmount = await results.collateralToken.token.balanceOf(results.init.userContract.address);
          expect(areAlmostEqual(receivedCollateralAmount, results.init.collateralAmount)).eq(true);
        });
      });
      describe("Borrow matic", () => {
        const collateralAsset = MaticAddresses.USDC;
        const collateralCToken = MaticAddresses.dForce_iUSDC;
        const collateralHolder = MaticAddresses.HOLDER_USDC;
        const borrowAsset = MaticAddresses.WMATIC;
        const borrowCToken = MaticAddresses.dForce_iMATIC;
        const borrowHolder = MaticAddresses.HOLDER_WMATIC;
        let results: IMakeFullRepayTestResults;
        before(async function () {
          if (!await isPolygonForkInUse()) return;
          results = await makeRepayTest(
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
          if (!await isPolygonForkInUse()) return;
          const status = await results.init.dfPoolAdapterTC.getStatus();
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
            await DeployerUtils.startImpersonate(results.init.dfPoolAdapterTC.address)
          ).isPositionOpened();
          expect(ret).eq(false);
        });
        it("should assign expected value to collateralBalanceATokens", async () => {
          if (!await isPolygonForkInUse()) return;
          const collateralBalanceATokens = await results.init.dfPoolAdapterTC.collateralTokensBalance();
          const aaveTokensBalance = await IERC20Metadata__factory.connect(
            collateralCToken,
            deployer
          ).balanceOf(results.init.dfPoolAdapterTC.address);
          expect(collateralBalanceATokens.eq(aaveTokensBalance)).eq(true);

        });
        it("should withdraw expected collateral amount", async () => {
          if (!await isPolygonForkInUse()) return;
          const receivedCollateralAmount = await results.collateralToken.token.balanceOf(results.init.userContract.address);
          expect(areAlmostEqual(receivedCollateralAmount, results.init.collateralAmount)).eq(true);
        });
      });
      describe("Supply and borrow not-matic", () => {
        const collateralAsset = MaticAddresses.DAI;
        const collateralCToken = MaticAddresses.dForce_iDAI;
        const collateralHolder = MaticAddresses.HOLDER_DAI;
        const borrowAsset = MaticAddresses.USDC;
        const borrowCToken = MaticAddresses.dForce_iUSDC;
        const borrowHolder = MaticAddresses.HOLDER_USDC;

        let results: IMakeFullRepayTestResults;
        before(async function () {
          if (!await isPolygonForkInUse()) return;
          results = await makeRepayTest(
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
          if (!await isPolygonForkInUse()) return;
          const status = await results.init.dfPoolAdapterTC.getStatus();
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
            await DeployerUtils.startImpersonate(results.init.dfPoolAdapterTC.address)
          ).isPositionOpened();
          expect(ret).eq(false);
        });
        it("should assign expected value to collateralBalanceATokens", async () => {
          if (!await isPolygonForkInUse()) return;
          const collateralBalanceATokens = await results.init.dfPoolAdapterTC.collateralTokensBalance();
          const aaveTokensBalance = await IERC20Metadata__factory.connect(
            collateralCToken,
            deployer
          ).balanceOf(results.init.dfPoolAdapterTC.address);
          expect(collateralBalanceATokens.eq(aaveTokensBalance)).eq(true);

        });
        it("should withdraw expected collateral amount", async () => {
          if (!await isPolygonForkInUse()) return;
          const receivedCollateralAmount = await results.collateralToken.token.balanceOf(results.init.userContract.address);
          expect(areAlmostEqual(receivedCollateralAmount, results.init.collateralAmount)).eq(true);
        });
        it("repay() should return expected collateral amount", async () => {
          if (!await isPolygonForkInUse()) return;
          expect(areAlmostEqual(results.repayResultsCollateralAmountOut, results.init.collateralAmount)).eq(true);
        });
      });
    });
    describe("Bad paths", () => {
      const collateralAsset = MaticAddresses.DAI;
      const collateralCToken = MaticAddresses.dForce_iDAI;
      const collateralHolder = MaticAddresses.HOLDER_DAI;
      const borrowAsset = MaticAddresses.USDC;
      const borrowCToken = MaticAddresses.dForce_iUSDC;
      const borrowHolder = MaticAddresses.HOLDER_USDC;
      it("should send exceeded amount to receiver if user tries to pay too much", async () => {
        const receiver = ethers.Wallet.createRandom().address;
        const amountToPayNum = 1500;  // amount to repay is ~905, user has 905*2 in total
        const results = await makeRepayTest(
          collateralAsset,
          collateralCToken,
          collateralHolder,
          "1999",
          borrowAsset,
          borrowCToken,
          borrowHolder,
          {
            amountToRepayStr: amountToPayNum.toString(),
            closePosition: true,
            receiver
          }
        );
        const debtAmount = +formatUnits(results.statusBeforeRepay.amountToPay, results.init.borrowToken.decimals);
        const userBorrowAssetBalanceChange = +formatUnits(
          results.userBorrowAssetBalanceBeforeRepay.sub(results.userBorrowAssetBalanceAfterRepay),
          results.init.borrowToken.decimals
        );
        const receiverBalance = +formatUnits(
          await results.init.borrowToken.token.balanceOf(receiver),
          results.init.borrowToken.decimals
        );
        const poolAdapterBalance = +formatUnits(
          await results.init.borrowToken.token.balanceOf(results.init.dfPoolAdapterTC.address),
          results.init.borrowToken.decimals
        );
        console.log("poolAdapterBalance", poolAdapterBalance);
        console.log("debtAmount", debtAmount);
        console.log("userBorrowAssetBalanceChange", userBorrowAssetBalanceChange);
        console.log("receiverBalance", receiverBalance);

        // Expected :1500, Actual   :1499.999991
        expect(Math.round(1000*(debtAmount + receiverBalance))).eq(Math.round(1000*userBorrowAssetBalanceChange));
        expect(userBorrowAssetBalanceChange).eq(amountToPayNum);
      });
      it("should revert if not tetu converter", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeRepayTest(
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
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeRepayTest(
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

      /**
       * todo DForceControllerMock requires refactoring and fixing
       */
      describe.skip("Use mocked DForce controller", () => {
        it("should repay successfully", async () => {
          if (!await isPolygonForkInUse()) return;
          const mocksSet = await initializeDForceControllerMock(
            collateralAsset,
            collateralCToken,
            borrowAsset,
            borrowCToken,
          );
          const results = await makeRepayTest(
            collateralAsset,
            mocksSet.mockedCollateralCToken.address,
            collateralHolder,
            "1999",
            borrowAsset,
            mocksSet.mockedBorrowCToken.address,
            borrowHolder,
            { useDForceControllerMock: mocksSet.mockedComptroller }
          );
          const status = await results.init.dfPoolAdapterTC.getStatus();
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
        it("should revert with CLOSE_POSITION_FAILED if token balance is not zero after full repay", async () => {
          if (!await isPolygonForkInUse()) return;
          const mocksSet = await initializeDForceControllerMock(
            collateralAsset,
            collateralCToken,
            borrowAsset,
            borrowCToken,
          );
          await expect(
            makeRepayTest(
              collateralAsset,
              mocksSet.mockedCollateralCToken.address,
              collateralHolder,
              "1999",
              borrowAsset,
              mocksSet.mockedBorrowCToken.address,
              borrowHolder,
              {
                useDForceControllerMock: mocksSet.mockedComptroller,
                returnNotZeroTokenBalanceAfterRedeem: true
              }
            )
          ).revertedWith("TC-24 close position failed"); // CLOSE_POSITION_FAILED
        });
        it("should revert with CLOSE_POSITION_FAILED if borrow balance is not zero after full repay", async () => {
          if (!await isPolygonForkInUse()) return;
          const mocksSet = await initializeDForceControllerMock(
            collateralAsset,
            collateralCToken,
            borrowAsset,
            borrowCToken,
          );
          await expect(
            makeRepayTest(
              collateralAsset,
              mocksSet.mockedCollateralCToken.address,
              collateralHolder,
              "1999",
              borrowAsset,
              mocksSet.mockedBorrowCToken.address,
              borrowHolder,
              {
                useDForceControllerMock: mocksSet.mockedComptroller,
                returnNotZeroBorrowBalanceStoredAfterRedeem: true
              }
            )
          ).revertedWith("TC-24 close position failed"); // CLOSE_POSITION_FAILED

        });
        it("should revert with WRONG_BORROWED_BALANCE if amount to repay is less than borrow balance during full repay", async () => {
          if (!await isPolygonForkInUse()) return;
          const mocksSet = await initializeDForceControllerMock(
            collateralAsset,
            collateralCToken,
            borrowAsset,
            borrowCToken,
          );
          await expect(
            makeRepayTest(
              collateralAsset,
              mocksSet.mockedCollateralCToken.address,
              collateralHolder,
              "1999",
              borrowAsset,
              mocksSet.mockedBorrowCToken.address,
              borrowHolder,
              {
                useDForceControllerMock: mocksSet.mockedComptroller,
                setBorrowBalance1AfterCallingBorrowBalanceCurrent: 1,
                amountToRepayStr: "1" // we need to make a partial repay
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

    interface IMakeBorrowToRebalanceResults {
      afterBorrow: IDForceCalcAccountEquityResults;
      afterBorrowHealthFactor18: BigNumber;
      afterBorrowToRebalance: IDForceCalcAccountEquityResults;
      afterBorrowToRebalanceHealthFactor18: BigNumber;
      userBalanceAfterBorrow: BigNumber;
      userBalanceAfterBorrowToRebalance: BigNumber;
      expectedAdditionalBorrowAmount: BigNumber;
    }
    interface IMakeBorrowToRebalanceBadPathParams {
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
    async function makeBorrowToRebalance (
      collateralToken: TokenDataTypes,
      collateralHolder: string,
      collateralCTokenAddress: string,
      collateralAmount: BigNumber,
      borrowToken: TokenDataTypes,
      borrowCTokenAddress: string,
      borrowHolder: string,
      badPathsParams?: IMakeBorrowToRebalanceBadPathParams
    ) : Promise<IMakeBorrowToRebalanceResults>{
      const d = await DForceTestUtils.prepareToBorrow(
        deployer,
        controllerInstance,
        collateralToken,
        collateralHolder,
        collateralCTokenAddress,
        collateralAmount,
        borrowToken,
        borrowCTokenAddress,
        {targetHealthFactor2: targetHealthFactorInitial2}
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
          d.dfPoolAdapterTC.address
        );
        await d.dfPoolAdapterTC.borrow(d.collateralAmount, amountToBorrow, d.userContract.address, {gasLimit: GAS_LIMIT});
      }
      const afterBorrow = await d.comptroller.calcAccountEquity(d.dfPoolAdapterTC.address);
      const statusAfterBorrow = await d.dfPoolAdapterTC.getStatus();
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
        ? IPoolAdapter__factory.connect(d.dfPoolAdapterTC.address, deployer)
        : d.dfPoolAdapterTC;

      const tx = await poolAdapterSigner.borrowToRebalance(
        expectedAdditionalBorrowAmount,
        d.userContract.address // receiver
      );
      const cr = await tx.wait();
      const dfi = DForcePoolAdapter__factory.createInterface();
      for (const event of (cr.events ?? [])) {
        if (event.topics[0].toLowerCase() === dfi.getEventTopic('ValueReceived').toLowerCase()) {
          const log = (dfi.decodeEventLog(
            dfi.getEvent('ValueReceived'),
            event.data,
            event.topics,
          ) as unknown) as ValueReceivedEventObject;
          console.log('ValueReceived', log.user, log.amount);
        }
      }

      const afterBorrowToRebalance = await d.comptroller.calcAccountEquity(d.dfPoolAdapterTC.address);
      const statusAfterBorrowToRebalance = await d.dfPoolAdapterTC.getStatus();
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
      badPathParams?: IMakeBorrowToRebalanceBadPathParams
    ) : Promise<IMakeBorrowToRebalanceResults> {
      const collateralAsset = MaticAddresses.DAI;
      const collateralHolder = MaticAddresses.HOLDER_DAI;
      const collateralCTokenAddress = MaticAddresses.dForce_iDAI;

      const borrowAsset = MaticAddresses.USDC;
      const borrowCTokenAddress = MaticAddresses.dForce_iUSDC;
      const borrowHolder = MaticAddresses.HOLDER_USDC;

      const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
      const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);
      console.log("collateralToken.decimals", collateralToken.decimals);
      console.log("borrowToken.decimals", borrowToken.decimals);

      const collateralAmount = getBigNumberFrom(100_000, collateralToken.decimals);
      console.log(collateralAmount, collateralAmount);

      const r = await makeBorrowToRebalance(
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
      badPathParams?: IMakeBorrowToRebalanceBadPathParams
    ) : Promise<IMakeBorrowToRebalanceResults> {
      const collateralAsset = MaticAddresses.WMATIC;
      const collateralHolder = MaticAddresses.HOLDER_WMATIC;
      const collateralCTokenAddress = MaticAddresses.dForce_iMATIC;

      const borrowAsset = MaticAddresses.USDC;
      const borrowCTokenAddress = MaticAddresses.dForce_iUSDC;
      const borrowHolder = MaticAddresses.HOLDER_USDC;

      const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
      const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);
      console.log("collateralToken.decimals", collateralToken.decimals);
      console.log("borrowToken.decimals", borrowToken.decimals);

      const collateralAmount = parseUnits("100000", collateralToken.decimals);
      console.log(collateralAmount, collateralAmount);

      const r = await makeBorrowToRebalance(
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
      badPathParams?: IMakeBorrowToRebalanceBadPathParams
    ) : Promise<IMakeBorrowToRebalanceResults> {
      const collateralAsset = MaticAddresses.USDC;
      const collateralHolder = MaticAddresses.HOLDER_USDC;
      const collateralCTokenAddress = MaticAddresses.dForce_iUSDC;

      const borrowAsset = MaticAddresses.WMATIC;
      const borrowCTokenAddress = MaticAddresses.dForce_iMATIC;
      const borrowHolder = MaticAddresses.HOLDER_WMATIC;

      const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
      const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);
      console.log("collateralToken.decimals", collateralToken.decimals);
      console.log("borrowToken.decimals", borrowToken.decimals);

      const collateralAmount = parseUnits("100000", collateralToken.decimals);
      console.log(collateralAmount, collateralAmount);

      const r = await makeBorrowToRebalance(
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
        if (!await isPolygonForkInUse()) return;
        const r = await testDaiUSDC();
        const ret = [
          // eslint-disable-next-line @typescript-eslint/no-loss-of-precision
          Math.round(r.afterBorrowHealthFactor18.div(getBigNumberFrom(1, 15)).toNumber() / 10.),
          // eslint-disable-next-line @typescript-eslint/no-loss-of-precision
          Math.round(r.afterBorrowToRebalanceHealthFactor18.div(getBigNumberFrom(1, 15)).toNumber() / 10.),
          toStringWithRound(r.userBalanceAfterBorrow, 6),
          toStringWithRound(r.userBalanceAfterBorrowToRebalance, 6),
        ].join();
        const expected = [
          targetHealthFactorInitial2,
          targetHealthFactorUpdated2,
          toStringWithRound(r.expectedAdditionalBorrowAmount, 6), // TODO: decimals
          toStringWithRound(r.expectedAdditionalBorrowAmount.mul(2), 6), // TODO: decimals
        ].join();
        expect(ret).eq(expected);
      });
      it("should return expected values for MATIC:USDC", async () => {
        if (!await isPolygonForkInUse()) return;
        const r = await testMaticUSDC();
        const ret = [
          // eslint-disable-next-line @typescript-eslint/no-loss-of-precision
          Math.round(r.afterBorrowHealthFactor18.div(getBigNumberFrom(1, 15)).toNumber() / 10.),
          // eslint-disable-next-line @typescript-eslint/no-loss-of-precision
          Math.round(r.afterBorrowToRebalanceHealthFactor18.div(getBigNumberFrom(1, 15)).toNumber() / 10.),
          toStringWithRound(r.userBalanceAfterBorrow, 6),
          toStringWithRound(r.userBalanceAfterBorrowToRebalance, 6),
        ].join();
        const expected = [
          targetHealthFactorInitial2,
          targetHealthFactorUpdated2,
          toStringWithRound(r.expectedAdditionalBorrowAmount, 6), // TODO: decimals
          toStringWithRound(r.expectedAdditionalBorrowAmount.mul(2), 6), // TODO: decimals
        ].join();
        expect(ret).eq(expected);
      });
      it("should return expected values for USDC:MATIC", async () => {
        if (!await isPolygonForkInUse()) return;
        const r = await testUSDCMatic();
        const ret = [
          // eslint-disable-next-line @typescript-eslint/no-loss-of-precision
          Math.round(r.afterBorrowHealthFactor18.div(getBigNumberFrom(1, 15)).toNumber() / 10.),
          // eslint-disable-next-line @typescript-eslint/no-loss-of-precision
          Math.round(r.afterBorrowToRebalanceHealthFactor18.div(getBigNumberFrom(1, 15)).toNumber() / 10.),
          toStringWithRound(r.userBalanceAfterBorrow, 6),
          toStringWithRound(r.userBalanceAfterBorrowToRebalance, 6),
        ].join();
        const expected = [
          targetHealthFactorInitial2,
          targetHealthFactorUpdated2,
          toStringWithRound(r.expectedAdditionalBorrowAmount, 6), // TODO: decimals
          toStringWithRound(r.expectedAdditionalBorrowAmount.mul(2), 6), // TODO: decimals
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
          ).revertedWith("TC-8 tetu converter only");
        });
      });
      describe("Position is not registered", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            testDaiUSDC({skipBorrow: true})
          ).revertedWith("TC-11 position not registered");
        });
      });
      describe("Result health factor is less min allowed one", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            testDaiUSDC({additionalAmountCorrectionFactor: 10})
          ).revertedWith("TC-3 wrong health factor");
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
      afterBorrow: IDForceCalcAccountEquityResults;
      afterRepayToRebalance: IDForceCalcAccountEquityResults;
      afterBorrowStatus: IPoolAdapterStatus;
      afterRepayToRebalanceStatus: IPoolAdapterStatus;
      userBalanceAfterBorrow: BigNumber;
      userBalanceAfterRepayToRebalance: BigNumber;
      expectedBorrowAssetAmountToRepay: BigNumber;
      expectedCollateralAssetAmountToRepay: BigNumber;
    }

    /**
     * Prepare DForce pool adapter.
     * Set low health factors.
     * Make borrow.
     * Increase health factor twice.
     * Make repay to rebalance.
     */
    async function makeRepayToRebalance (
      p: IMakeRepayToRebalanceInputParamsWithCTokens
    ) : Promise<IMakeRepayToRebalanceResults>{
      const d = await DForceTestUtils.prepareToBorrow(
        deployer,
        controllerInstance,
        p.collateralToken,
        p.collateralHolder,
        p.collateralCTokenAddress,
        p.collateralAmount,
        p.borrowToken,
        p.borrowCTokenAddress,
        {targetHealthFactor2: targetHealthFactorInitial2}
      );
      const collateralAssetData = await DForceHelper.getCTokenData(
        deployer,
        d.comptroller,
        d.collateralCToken
      );
      console.log("collateralAssetData", collateralAssetData);
      const borrowAssetData = await DForceHelper.getCTokenData(
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
          d.dfPoolAdapterTC.address
        );
        await d.dfPoolAdapterTC.borrow(p.collateralAmount, amountToBorrow, d.userContract.address, {gasLimit: GAS_LIMIT});
      }

      const afterBorrow: IDForceCalcAccountEquityResults = await d.comptroller.calcAccountEquity(d.dfPoolAdapterTC.address);
      const userBalanceAfterBorrow = await p.borrowToken.token.balanceOf(d.userContract.address);
      const afterBorrowStatus: IPoolAdapterStatus = await d.dfPoolAdapterTC.getStatus();
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
        ? IPoolAdapter__factory.connect(d.dfPoolAdapterTC.address, deployer)
        : d.dfPoolAdapterTC;

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

      const afterBorrowToRebalance: IDForceCalcAccountEquityResults = await d.comptroller.calcAccountEquity(d.dfPoolAdapterTC.address);
      const userBalanceAfterRepayToRebalance = await p.borrowToken.token.balanceOf(d.userContract.address);
      const afterBorrowToRebalanceStatus = await d.dfPoolAdapterTC.getStatus();
      console.log("after repay to rebalance:", afterBorrowToRebalance, userBalanceAfterRepayToRebalance);

      return {
        afterBorrow,
        afterRepayToRebalance: afterBorrowToRebalance,
        userBalanceAfterBorrow,
        userBalanceAfterRepayToRebalance,
        afterBorrowStatus,
        afterRepayToRebalanceStatus: afterBorrowToRebalanceStatus,
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
          // eslint-disable-next-line @typescript-eslint/no-loss-of-precision
          getBigNumberFrom(1, 15)).toNumber() / 10.
        ),
        Math.round(r.afterRepayToRebalanceStatus.healthFactor18.div(
          // eslint-disable-next-line @typescript-eslint/no-loss-of-precision
          getBigNumberFrom(1, 15)).toNumber() / 10.
        ),
        // actual collateral amount after borrow is a bit less than the initial amount
        areAlmostEqual(r.afterBorrowStatus.collateralAmount, collateralAmount, 4),

        // total collateral amount is increased on expected amount after repay-to-rebalance
        areAlmostEqual(
          r.afterRepayToRebalanceStatus.collateralAmount,
          r.afterBorrowStatus.collateralAmount.add(r.expectedCollateralAssetAmountToRepay),
          4
        ),

        // total collateral amount was increased twice after repay-to-rebalance
        // when the repayment was made using collateral asset
        !useCollateralAssetToRepay || areAlmostEqual(r.afterRepayToRebalanceStatus.collateralAmount,
          r.afterBorrowStatus.collateralAmount.mul(2)
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
      const collateralCTokenAddress = MaticAddresses.dForce_iDAI;

      const borrowAsset = MaticAddresses.WMATIC;
      const borrowHolder = MaticAddresses.HOLDER_WMATIC;
      const borrowCTokenAddress = MaticAddresses.dForce_iMATIC;

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

    async function usdcUsdt(
      useCollateralAssetToRepay: boolean,
      badPathsParams?: IMakeRepayRebalanceBadPathParams
    ) : Promise<{ret: string, expected: string}> {
      const collateralAsset = MaticAddresses.USDC;
      const collateralHolder = MaticAddresses.HOLDER_USDC;
      const collateralCTokenAddress = MaticAddresses.dForce_iUSDC;

      const borrowAsset = MaticAddresses.USDT;
      const borrowHolder = MaticAddresses.HOLDER_USDT;
      const borrowCTokenAddress = MaticAddresses.dForce_iUSDT;

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
      const collateralCTokenAddress = MaticAddresses.dForce_iWBTC;

      const borrowAsset = MaticAddresses.WETH;
      const borrowHolder = MaticAddresses.HOLDER_WETH;
      const borrowCTokenAddress = MaticAddresses.dForce_iWETH;

      return makeRepayToRebalanceTest(
        {
          borrowCTokenAddress,
          collateralCTokenAddress,
          collateralAsset,
          borrowAsset,
          borrowHolder,
          collateralAmountStr: "1.3",
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
          ).revertedWith("TC-8 tetu converter only"); // USER_OR_TETU_CONVERTER_ONLY
        });
      });
      describe("Position is not registered", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            daiWMatic(false,{skipBorrow: true})
          ).revertedWith("TC-11 position not registered"); // BORROW_POSITION_IS_NOT_REGISTERED
        });
      });
      describe("Result health factor is less min allowed one", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            daiWMatic(false,{additionalAmountCorrectionFactorDiv: 100})
          ).revertedWith("TC-3 wrong health factor");
        });
      });
      describe("Try to repay amount greater then the debt", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            daiWMatic(false,{additionalAmountCorrectionFactorMul: 100})
          ).revertedWith("TC-40 repay to rebalance not allowed"); // REPAY_TO_REBALANCE_NOT_ALLOWED
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
      zeroTokenAddressProvider?: boolean;
      tokenAddressProviderMock?: TokenAddressProviderMock;
    }
    interface IMakeInitializePoolAdapterResults {
      user: string;
      converter: string;
      collateralAsset: string;
      borrowAsset: string;
      controller: ConverterController;
      poolAdapter: DForcePoolAdapter;
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
        {tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
      );

      const poolAdapter = await AdaptersHelper.createDForcePoolAdapter(deployer);
      const tokenAddressProvider = badParams?.tokenAddressProviderMock
        ? badParams?.tokenAddressProviderMock
        : await AdaptersHelper.createDForcePlatformAdapter(
          deployer,
          controller.address,
          MaticAddresses.DFORCE_CONTROLLER,
          converter,
          [MaticAddresses.dForce_iDAI, MaticAddresses.dForce_iUSDC]
        );

      await poolAdapter.initialize(
        badParams?.zeroController ? Misc.ZERO_ADDRESS : controller.address,
        badParams?.zeroTokenAddressProvider ? Misc.ZERO_ADDRESS : tokenAddressProvider.address,
        badParams?.zeroPool ? Misc.ZERO_ADDRESS : MaticAddresses.DFORCE_CONTROLLER,
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
      it("should revert on zero token address provider", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeInitializePoolAdapterTest({zeroTokenAddressProvider: true})
        ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
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
        ).revertedWith("Initializable: contract is already initialized");
      });
      it("should revert if token address provider returns zero cTokenCollateral", async () => {
        if (!await isPolygonForkInUse()) return;
        const tokenAddressProviderMock = await MocksHelper.createTokenAddressProviderMock(
          deployer,
          Misc.ZERO_ADDRESS, // (!)
          MaticAddresses.dForce_iMATIC
        );
        await expect(
          makeInitializePoolAdapter({tokenAddressProviderMock})
        ).revertedWith("TC-16 ctoken not found"); // C_TOKEN_NOT_FOUND
      });
      it("should revert if token address provider returns zero cTokenBorrow", async () => {
        if (!await isPolygonForkInUse()) return;
        const tokenAddressProviderMock = await MocksHelper.createTokenAddressProviderMock(
          deployer,
          MaticAddresses.dForce_iMATIC,
          Misc.ZERO_ADDRESS, // (!)
        );
        await expect(
          makeInitializePoolAdapter({tokenAddressProviderMock})
        ).revertedWith("TC-16 ctoken not found"); // C_TOKEN_NOT_FOUND
      });
    });
  });

  describe("getConversionKind", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        const d = await DForceTestUtils.prepareToBorrow(
          deployer,
          controllerInstance,
          await TokenDataTypes.Build(deployer, MaticAddresses.DAI),
          MaticAddresses.HOLDER_DAI,
          MaticAddresses.dForce_iDAI,
          undefined,
          await TokenDataTypes.Build(deployer, MaticAddresses.WMATIC),
          MaticAddresses.dForce_iMATIC,
        );
        const ret = await d.dfPoolAdapterTC.getConversionKind();
        expect(ret).eq(2); // CONVERSION_KIND_BORROW_2
      });
    });
  });

  describe("getConfig", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        const d = await DForceTestUtils.prepareToBorrow(
          deployer,
          controllerInstance,
          await TokenDataTypes.Build(deployer, MaticAddresses.DAI),
          MaticAddresses.HOLDER_DAI,
          MaticAddresses.dForce_iDAI,
          undefined,
          await TokenDataTypes.Build(deployer, MaticAddresses.WMATIC),
          MaticAddresses.dForce_iMATIC,
        );
        const r = await d.dfPoolAdapterTC.getConfig();
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
      const collateralCToken = MaticAddresses.dForce_iUSDT;
      const collateralHolder = MaticAddresses.HOLDER_USDT;
      const borrowAsset = MaticAddresses.USDC;
      const borrowCToken = MaticAddresses.dForce_iUSDC;

      const results = await makeBorrowTest(
        collateralAsset,
        collateralCToken,
        collateralHolder,
        borrowAsset,
        borrowCToken,
        "1999"
      );
      const status = await results.init.dfPoolAdapterTC.getStatus();

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
      const collateralCToken = MaticAddresses.dForce_iUSDT;
      const collateralHolder = MaticAddresses.HOLDER_USDT;
      const borrowAsset = MaticAddresses.USDC;
      const borrowCToken = MaticAddresses.dForce_iUSDC;

      const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
      const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

      // we only prepare to borrow, but don't make a borrow
      const init = await DForceTestUtils.prepareToBorrow(
        deployer,
        controllerInstance,
        collateralToken,
        collateralHolder,
        collateralCToken,
        parseUnits("999", collateralToken.decimals),
        borrowToken,
        borrowCToken
      );
      const status = await init.dfPoolAdapterTC.getStatus();

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

  describe("updateBalance", () => {
    describe("Good paths", () => {
      it("should change stored balance", async () => {
        if (!await isPolygonForkInUse()) return;

        const collateralAsset = MaticAddresses.DAI;
        const collateralCToken = MaticAddresses.dForce_iDAI;
        const collateralHolder = MaticAddresses.HOLDER_DAI;
        const borrowAsset = MaticAddresses.USDC;
        const borrowCToken = MaticAddresses.dForce_iUSDC;

        const results = await makeBorrowTest(
          collateralAsset,
          collateralCToken,
          collateralHolder,
          borrowAsset,
          borrowCToken,
          "1999"
        );
        const status0 = await results.init.dfPoolAdapterTC.getStatus();
        await TimeUtils.advanceNBlocks(100);
        const status1 = await results.init.dfPoolAdapterTC.getStatus();

        await results.init.dfPoolAdapterTC.updateStatus();
        const status2 = await results.init.dfPoolAdapterTC.getStatus();

        const ret = [
          status1.amountToPay.eq(status0.amountToPay),
          status2.amountToPay.gt(status1.amountToPay)
        ].join();
        const expected = [true, true].join();
        expect(ret).eq(expected);
      });
    });
    describe("Bad paths", () => {
      it("should revert if caller is not TetuConverter", async () => {
        if (!await isPolygonForkInUse()) return;

        const collateralAsset = MaticAddresses.DAI;
        const collateralCToken = MaticAddresses.dForce_iDAI;
        const collateralHolder = MaticAddresses.HOLDER_DAI;
        const borrowAsset = MaticAddresses.USDC;
        const borrowCToken = MaticAddresses.dForce_iUSDC;

        const results = await makeBorrowTest(
          collateralAsset,
          collateralCToken,
          collateralHolder,
          borrowAsset,
          borrowCToken,
          "1999"
        );
        await expect(
          results.init.dfPoolAdapterTC.connect(await Misc.impersonate(ethers.Wallet.createRandom().address)).updateStatus()
        ).revertedWith("TC-8 tetu converter only"); // TETU_CONVERTER_ONLY
      });
    });
  });

  describe("claimRewards", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        const receiver = ethers.Wallet.createRandom().address;
        const comptroller = await DForceHelper.getController(deployer);
        const rd = IDForceRewardDistributor__factory.connect(await comptroller.rewardDistributor(), deployer);
        const rewardToken = await rd.rewardToken();

        // make a borrow
        const r = await makeBorrowTest(
          MaticAddresses.DAI,
          MaticAddresses.dForce_iDAI,
          MaticAddresses.HOLDER_DAI,
          MaticAddresses.USDC,
          MaticAddresses.dForce_iUSDC,
          "10000"
        );
        // wait a bit and check rewards
        await TimeUtils.advanceNBlocks(100);

        const balanceRewardsBefore = await IERC20__factory.connect(rewardToken, deployer).balanceOf(receiver);
        const {rewardTokenOut, amountOut} = await r.init.dfPoolAdapterTC.callStatic.claimRewards(receiver);
        await r.init.dfPoolAdapterTC.claimRewards(receiver);

        // let's try to claim the rewards once more; now we should receive nothing
        const secondAttempt = await r.init.dfPoolAdapterTC.callStatic.claimRewards(receiver);
        const balanceRewardsAfter = await IERC20__factory.connect(rewardToken, deployer).balanceOf(receiver);

        console.log("balanceRewardsBefore", balanceRewardsBefore);
        console.log("balanceRewardsAfter", balanceRewardsAfter);
        console.log("amountOut", amountOut);
        console.log("rewardTokenOut", rewardTokenOut);

        const ret = [
          rewardTokenOut,
          amountOut.gt(0),

          // the amounts are not equal because callStatic.claimRewards gives a bit fewer values then next claimRewards
          balanceRewardsAfter.gt(amountOut),
          balanceRewardsAfter.sub(balanceRewardsBefore).eq(0),

          secondAttempt.rewardTokenOut,
          secondAttempt.amountOut.eq(0)
        ].join();
        const expected = [
          rewardToken,
          true,

          true,
          false,

          rewardToken,
          true
        ].join();
        expect(ret).eq(expected);
      });
    });
  });

  describe("getCollateralAmountToReturn", () => {
    const collateralAsset = MaticAddresses.DAI;
    const collateralCToken = MaticAddresses.dForce_iDAI;
    const collateralHolder = MaticAddresses.HOLDER_DAI;
    const borrowAsset = MaticAddresses.WMATIC;
    const borrowCToken = MaticAddresses.dForce_iMATIC;
    let results: IMakeBorrowTestResults;
    before(async function () {
      if (!await isPolygonForkInUse()) return;
      results = await makeBorrowTest(
        collateralAsset,
        collateralCToken,
        collateralHolder,
        borrowAsset,
        borrowCToken,
        "1999"
      );
    });
    describe("Good paths", () => {
      describe("Full repay", () => {
        it("should return expected values", async () => {
          if (!await isPolygonForkInUse()) return;

          const status = await results.init.dfPoolAdapterTC.getStatus();
          const tetuConverterAsUser = ITetuConverter__factory.connect(
            await results.init.controller.tetuConverter(),
            await DeployerUtils.startImpersonate(results.init.userContract.address)
          );
          const quoteRepayResults = await tetuConverterAsUser.callStatic.quoteRepay(
            await tetuConverterAsUser.signer.getAddress(),
            results.init.collateralToken.address,
            results.init.borrowToken.address,
            status.amountToPay
          );

          const ret = quoteRepayResults.collateralAmountOut.gte(status.collateralAmount);
          console.log("ret", quoteRepayResults.collateralAmountOut, status.collateralAmount);
          expect(ret).eq(true);
        });
      });
      describe("Partial repay 50%", () => {
        it("should return expected values", async () => {
          if (!await isPolygonForkInUse()) return;

          const status = await results.init.dfPoolAdapterTC.getStatus();
          const tetuConverterAsUser = ITetuConverter__factory.connect(
            await results.init.controller.tetuConverter(),
            await DeployerUtils.startImpersonate(results.init.userContract.address)
          );
          const quoteRepayResults = await tetuConverterAsUser.callStatic.quoteRepay(
            await tetuConverterAsUser.signer.getAddress(),
            results.init.collateralToken.address,
            results.init.borrowToken.address,
            status.amountToPay.div(2) // 50%
          );

          const ret = areAlmostEqual(quoteRepayResults.collateralAmountOut.mul(2), status.collateralAmount, 5);
          console.log("ret", quoteRepayResults.collateralAmountOut.mul(2), status.collateralAmount);
          expect(ret).eq(true);
        });
      });
      describe("Partial repay 5%", () => {
        it("should return expected values", async () => {
          if (!await isPolygonForkInUse()) return;

          const status = await results.init.dfPoolAdapterTC.getStatus();
          const tetuConverterAsUser = ITetuConverter__factory.connect(
            await results.init.controller.tetuConverter(),
            await DeployerUtils.startImpersonate(results.init.userContract.address)
          );
          const quoteRepayResults = await tetuConverterAsUser.callStatic.quoteRepay(
            await tetuConverterAsUser.signer.getAddress(),
            results.init.collateralToken.address,
            results.init.borrowToken.address,
            status.amountToPay.div(20) // 5%
          );

          const ret = areAlmostEqual(quoteRepayResults.collateralAmountOut.mul(20), status.collateralAmount, 5);
          console.log("ret", quoteRepayResults.collateralAmountOut.mul(20), status.collateralAmount);
          expect(ret).eq(true);
        });
      });
    });
  });

  describe("salvage", () => {
    const receiver = ethers.Wallet.createRandom().address;

    let snapshotLocal: string;
    let collateralToken: TokenDataTypes;
    let borrowToken: TokenDataTypes;
    let init: IPrepareToBorrowResults;
    let governance: string;

    before(async function () {
      snapshotLocal = await TimeUtils.snapshot();
      collateralToken = await TokenDataTypes.Build(deployer, MaticAddresses.USDC);
      borrowToken = await TokenDataTypes.Build(deployer, MaticAddresses.USDT);

      init = await DForceTestUtils.prepareToBorrow(
        deployer,
        controllerInstance,
        collateralToken,
        MaticAddresses.HOLDER_USDC,
        MaticAddresses.dForce_iUSDC,
        parseUnits("1", collateralToken.decimals),
        borrowToken,
        MaticAddresses.dForce_iUSDT,
      );
      governance = await init.controller.governance();
    });
    after(async function () {
      await TimeUtils.rollback(snapshotLocal);
    });
    async function salvageToken(tokenAddress: string, holder: string, amountNum: string, caller?: string) : Promise<number>{
      const token = await IERC20Metadata__factory.connect(tokenAddress, deployer);
      const decimals = await token.decimals();
      const amount = parseUnits(amountNum, decimals);
      await BalanceUtils.getRequiredAmountFromHolders(amount, token,[holder], init.dfPoolAdapterTC.address);
      await init.dfPoolAdapterTC.connect(await Misc.impersonate(caller || governance)).salvage(receiver, tokenAddress, amount);
      return +formatUnits(await token.balanceOf(receiver), decimals);
    }
    describe("Good paths", () => {
      it("should salvage collateral asset", async () => {
        expect(await salvageToken(MaticAddresses.USDC, MaticAddresses.HOLDER_USDC, "800")).eq(800);
      });
      it("should salvage borrow asset", async () => {
        expect(await salvageToken(MaticAddresses.USDT, MaticAddresses.HOLDER_USDT, "800")).eq(800);
      });
    });
    describe("Bad paths", () => {
      it("should revert on attempt to salvage collateral cToken", async () => {
        await expect(salvageToken(MaticAddresses.dForce_iUSDC, MaticAddresses.HOLDER_DFORCE_IUSDC, "800")).revertedWith("TC-59: unsalvageable"); // UNSALVAGEABLE
      });
      it("should revert on attempt to salvage borrow cToken", async () => {
        await expect(salvageToken(MaticAddresses.dForce_iUSDT, MaticAddresses.HOLDER_DFORCE_IUSDT, "800")).revertedWith("TC-59: unsalvageable"); // UNSALVAGEABLE
      });
      it("should revert if not governance", async () => {
        await expect(salvageToken(MaticAddresses.USDC, MaticAddresses.HOLDER_USDC, "800", receiver)).revertedWith("TC-9 governance only"); // GOVERNANCE_ONLY
      });
    });
  });

  describe("payable", () => {
    let init: IPrepareToBorrowResults;
    before(async () => {
      const collateralToken = await TokenDataTypes.Build(deployer, MaticAddresses.DAI);
      const borrowToken = await TokenDataTypes.Build(deployer, MaticAddresses.USDC);

      init = await DForceTestUtils.prepareToBorrow(
        deployer,
        controllerInstance,
        collateralToken,
        MaticAddresses.HOLDER_DAI,
        MaticAddresses.dForce_iDAI,
        parseUnits("1", collateralToken.decimals),
        borrowToken,
        MaticAddresses.dForce_iUSDC
      );
    })
    describe("Good paths", () => {
      it("WMATIC should be able to put MATIC on balance of the pool adapter", async () => {
        const amount = parseUnits("1", 18);

        const maticSource = await Misc.impersonate(ethers.Wallet.createRandom().address);
        const receiver = await Misc.impersonate(init.dfPoolAdapterTC.address);

        // const receiver = await Misc.impersonate(ethers.Wallet.createRandom().address);

        await BalanceUtils.getAmountFromHolder(MaticAddresses.WMATIC, MaticAddresses.HOLDER_WMATIC, receiver.address, amount);

        const balanceBefore = await web3.eth.getBalance(receiver.address);
        console.log('balanceBefore', balanceBefore);

        console.log("withdraw");
        const tx = await IWmatic__factory.connect(MaticAddresses.WMATIC, receiver).withdraw(amount);
        const cr = await tx.wait();
        const dfi = DForcePoolAdapter__factory.createInterface();
        for (const event of (cr.events ?? [])) {
          if (event.topics[0].toLowerCase() === dfi.getEventTopic('ValueReceived').toLowerCase()) {
            const log = (dfi.decodeEventLog(
              dfi.getEvent('ValueReceived'),
              event.data,
              event.topics,
            ) as unknown) as ValueReceivedEventObject;
            console.log('ValueReceived', log.user, log.amount);
          }
        }

        const balanceAfter = await web3.eth.getBalance(receiver.address);
        console.log('balanceAfter', balanceAfter);
      });
      it("DFORCE_MATIC should be able to put MATIC on balance of the pool adapter", async () => {

      });
    });
    describe("Bad paths", () => {
      it("revert if some other contracts put MATIC on balance of the pool adapter", async () => {

      });
    });
  });
//endregion Unit tests

});
