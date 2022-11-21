import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {
  Aave3PoolAdapter__factory,
  DebtMonitor__factory,
  BorrowManager__factory,
  IERC20Extended__factory, IPoolAdapter__factory
} from "../../../typechain";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";
import {IAave3ReserveInfo} from "../../../scripts/integration/helpers/Aave3Helper";
import {BalanceUtils, IUserBalances} from "../../baseUT/utils/BalanceUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {TokenDataTypes} from "../../baseUT/types/TokenDataTypes";
import {Misc} from "../../../scripts/utils/Misc";
import {IAave3UserAccountDataResults} from "../../baseUT/apr/aprAave3";
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
import {
  Aave3TestUtils,
  IPrepareToBorrowResults,
  IBorrowResults,
  IMakeBorrowOrRepayBadPathsParams
} from "../../baseUT/protocols/aave3/Aave3TestUtils";
import {AdaptersHelper} from "../../baseUT/helpers/AdaptersHelper";
import {TetuConverterApp} from "../../baseUT/helpers/TetuConverterApp";
import {MocksHelper} from "../../baseUT/helpers/MocksHelper";
import {parseUnits} from "ethers/lib/utils";
import {IConversionPlan} from "../../baseUT/apr/aprDataTypes";
import {areAlmostEqual} from "../../baseUT/utils/CommonUtils";
import {IPoolAdapterStatus} from "../../baseUT/types/BorrowRepayDataTypes";

describe("Aave3PoolAdapterUnitTest", () => {
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

    const init = await Aave3TestUtils.prepareToBorrow(
      deployer,
      collateralToken,
      [collateralHolder],
      parseUnits(collateralAmountStr, collateralToken.decimals),
      borrowToken,
      false
    );
    const borrowResults = await Aave3TestUtils.makeBorrow(deployer, init, undefined, badPathsParams);
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
        results = await makeBorrowTest(
          collateralAsset,
          collateralHolder,
          borrowAsset,
          "1999"
        );
      });
      it("should get expected status", async () => {
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
        const ret = await DebtMonitor__factory.connect(
          await results.init.controller.debtMonitor(),
          await DeployerUtils.startImpersonate(results.init.aavePoolAdapterAsTC.address)
        ).isPositionOpened();
        expect(ret).eq(true);
      });
      it("should transfer expected amount to the user", async () => {
        const status = await results.init.aavePoolAdapterAsTC.getStatus();
        const receivedBorrowAmount = await results.borrowToken.token.balanceOf(results.init.userContract.address);
        expect(receivedBorrowAmount.toString()).eq(results.borrowResults.borrowedAmount.toString());
      });
      it("should change collateralBalanceATokens", async () => {
        const collateralBalanceATokens = await results.init.aavePoolAdapterAsTC.collateralBalanceATokens();
        const aaveTokensBalance = await IERC20Extended__factory.connect(
          results.init.collateralReserveInfo.aTokenAddress,
          deployer
        ).balanceOf(results.init.aavePoolAdapterAsTC.address);
        expect(collateralBalanceATokens.eq(aaveTokensBalance)).eq(true);
      });
    });
    describe("Bad paths", () => {
      it("should revert if not tetu converter", async () => {
        await expect(
          makeBorrowTest(
            collateralAsset,
            collateralHolder,
            borrowAsset,
            "1999",
            {makeOperationAsNotTc: true}
          )
        ).revertedWith("TC-8"); // TETU_CONVERTER_ONLY
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
      repayResults: IAave3UserAccountDataResults;
      userBorrowAssetBalanceBeforeRepay: BigNumber;
      userBorrowAssetBalanceAfterRepay: BigNumber;
    }

    interface IMakeRepayBadPathsParams {
      amountToRepayStr?: string;
      makeRepayAsNotTc?: boolean;
      closePosition?: boolean;
    }

    async function makeFullRepayTest(
      collateralAmountStr: string,
      badPathsParams?: IMakeRepayBadPathsParams
    ): Promise<IMakeFullRepayTestResults> {
      const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
      const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

      const init = await Aave3TestUtils.prepareToBorrow(
        deployer,
        collateralToken,
        [collateralHolder],
        parseUnits(collateralAmountStr, collateralToken.decimals),
        borrowToken,
        false
      );
      const borrowResults = await Aave3TestUtils.makeBorrow(deployer, init, undefined);

      const amountToRepay = badPathsParams?.amountToRepayStr
        ? parseUnits(badPathsParams?.amountToRepayStr, borrowToken.decimals)
        : undefined;
      await Aave3TestUtils.putDoubleBorrowAmountOnUserBalance(init, borrowHolder);

      const userBorrowAssetBalanceBeforeRepay = await init.borrowToken.token.balanceOf(init.userContract.address);
      const statusBeforeRepay: IPoolAdapterStatus = await init.aavePoolAdapterAsTC.getStatus();

      const repayResults = await Aave3TestUtils.makeRepay(
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
      let results: IMakeFullRepayTestResults;
      before(async function () {
        results = await makeFullRepayTest("1999");
      });
      it("should get expected status", async () => {
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
        const ret = await DebtMonitor__factory.connect(
          await results.init.controller.debtMonitor(),
          await DeployerUtils.startImpersonate(results.init.aavePoolAdapterAsTC.address)
        ).isPositionOpened();
        expect(ret).eq(false);
      });
      it("should assign expected value to collateralBalanceATokens", async () => {
        const collateralBalanceATokens = await results.init.aavePoolAdapterAsTC.collateralBalanceATokens();
        const aaveTokensBalance = await IERC20Extended__factory.connect(
          results.init.collateralReserveInfo.aTokenAddress,
          deployer
        ).balanceOf(results.init.aavePoolAdapterAsTC.address);
        expect(collateralBalanceATokens.eq(aaveTokensBalance)).eq(true);

      });
      it("should withdraw expected collateral amount", async () => {
        const status = await results.init.aavePoolAdapterAsTC.getStatus();
        const receivedCollateralAmount = await results.collateralToken.token.balanceOf(results.init.userContract.address);
        expect(areAlmostEqual(receivedCollateralAmount, results.init.collateralAmount)).eq(true);
      });
    });
    describe("Bad paths", () => {
      it("should return exceeded amount if user tries to pay too much", async () => {
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
        await expect(
          makeFullRepayTest(
            "1999",
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
          "1999",
          {amountToRepayStr: "1", closePosition: true}
          )
        ).revertedWith("TC-24"); // CLOSE_POSITION_FAILED
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
     * Prepare aave3 pool adapter.
     * Set low health factors.
     * Make borrow.
     * Increase health factor twice.
     * Make repay to rebalance.
     */
    async function makeRepayToRebalance (
      p: IMakeRepayToRebalanceInputParams,
      useEMode: boolean = false
    ) : Promise<IMakeRepayToRebalanceResults>{
      const d = await Aave3TestUtils.prepareToBorrow(deployer,
        p.collateralToken,
        [p.collateralHolder],
        p.collateralAmount,
        p.borrowToken,
        useEMode,
        {targetHealthFactor2: targetHealthFactorInitial2}
      );
      const collateralAssetData = await d.h.getReserveInfo(deployer, d.aavePool, d.dataProvider, p.collateralToken.address);
      console.log("collateralAssetData", collateralAssetData);
      const borrowAssetData = await d.h.getReserveInfo(deployer, d.aavePool, d.dataProvider, p.borrowToken.address);
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

      const afterBorrow: IAave3UserAccountDataResults = await d.aavePool.getUserAccountData(
        d.aavePoolAdapterAsTC.address
      );
      const userBorrowAssetBalanceAfterBorrow = await p.borrowToken.token.balanceOf(d.userContract.address);
      const userCollateralAssetBalanceAfterBorrow = await p.collateralToken.token.balanceOf(d.userContract.address);
      const statusAfterBorrow = await d.aavePoolAdapterAsTC.getStatus();
      console.log("after borrow:",
        afterBorrow,
        userBorrowAssetBalanceAfterBorrow,
        userCollateralAssetBalanceAfterBorrow,
        statusAfterBorrow
      );

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

      console.log("signer is", await poolAdapterSigner.signer.getAddress());
      console.log("amountsToRepay.useCollateral", amountsToRepay.useCollateral);
      console.log("amountsToRepay.amountCollateralAsset", amountsToRepay.amountCollateralAsset);
      await poolAdapterSigner.repayToRebalance(
        amountsToRepay.useCollateral
          ? amountsToRepay.amountCollateralAsset
          : amountsToRepay.amountBorrowAsset,
        amountsToRepay.useCollateral
      );

      const afterBorrowToRebalance: IAave3UserAccountDataResults = await d.aavePool.getUserAccountData(
        d.aavePoolAdapterAsTC.address
      );
      const userBorrowAssetBalanceAfterRepayToRebalance = await p.borrowToken.token.balanceOf(d.userContract.address);
      const userCollateralAssetBalanceAfterRepayToRebalance = await p.collateralToken.token.balanceOf(d.userContract.address);
      const statusAfterRepay = await d.aavePoolAdapterAsTC.getStatus();
      console.log("after repay to rebalance:",
        afterBorrowToRebalance,
        userBorrowAssetBalanceAfterRepayToRebalance,
        userCollateralAssetBalanceAfterRepayToRebalance,
        statusAfterRepay
      );

      const userAccountCollateralBalanceAfterBorrow = afterBorrow.totalCollateralBase
        .mul(getBigNumberFrom(1, p.collateralToken.decimals))
        .div(prices[0]);
      const userAccountCollateralBalanceAfterRepayToRebalance = afterBorrowToRebalance.totalCollateralBase
        .mul(getBigNumberFrom(1, p.collateralToken.decimals))
        .div(prices[0]);
      const userAccountBorrowBalanceAfterBorrow = afterBorrow.totalDebtBase
        .mul(getBigNumberFrom(1, p.borrowToken.decimals))
        .div(prices[1]);
      const userAccountBorrowBalanceAfterRepayToRebalance = afterBorrowToRebalance.totalDebtBase
        .mul(getBigNumberFrom(1, p.borrowToken.decimals))
        .div(prices[1]);

      return {
        afterBorrow,
        afterBorrowToRebalance,
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
              async (p) => makeRepayToRebalance(p, true),
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
              async (p) => makeRepayToRebalance(p, true),
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
      describe("Not TetuConverter", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            testRepayToRebalanceDaiWMatic({makeRepayToRebalanceAsDeployer: true})
          ).revertedWith("TC-8");
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
      const d = await Aave3TestUtils.prepareToBorrow(deployer,
        collateralToken,
        [collateralHolder],
        collateralAmount,
        borrowToken,
        false,
        {targetHealthFactor2: targetHealthFactorInitial2}
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

  describe("initialize", () => {
    interface IInitializePoolAdapterBadPaths {
      makeSecondInitialization?: boolean;
      zeroController?: boolean;
      zeroUser?: boolean;
      zeroCollateralAsset?: boolean;
      zeroBorrowAsset?: boolean;
      zeroConverter?: boolean;
      zeroPool?: boolean;
    }
    async function makeInitializePoolAdapterTest(
      useEMode: boolean,
      badParams?: IInitializePoolAdapterBadPaths
    ) : Promise<{ret: string, expected: string}> {
      const user = ethers.Wallet.createRandom().address;
      const collateralAsset = (await MocksHelper.createMockedCToken(deployer)).address;
      const borrowAsset = (await MocksHelper.createMockedCToken(deployer)).address;
      const converter = ethers.Wallet.createRandom().address;

      const controller = await TetuConverterApp.createController(
        deployer,
        {tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
      );
      const poolAdapter = useEMode
        ? await AdaptersHelper.createAave3PoolAdapterEMode(deployer)
        : await AdaptersHelper.createAave3PoolAdapter(deployer);

      const countInitializationCalls = badParams?.makeSecondInitialization ? 2 : 1;
      for (let i = 0; i < countInitializationCalls; ++i) {
        await poolAdapter.initialize(
          badParams?.zeroController ? Misc.ZERO_ADDRESS : controller.address,
          badParams?.zeroPool ? Misc.ZERO_ADDRESS : MaticAddresses.AAVE_V3_POOL,
          badParams?.zeroUser ? Misc.ZERO_ADDRESS : user,
          badParams?.zeroCollateralAsset ? Misc.ZERO_ADDRESS : collateralAsset,
          badParams?.zeroBorrowAsset ? Misc.ZERO_ADDRESS : borrowAsset,
          badParams?.zeroConverter ? Misc.ZERO_ADDRESS : converter
        );
      }

      const poolAdapterConfigAfter = await poolAdapter.getConfig();
      const ret = [
        poolAdapterConfigAfter.origin,
        poolAdapterConfigAfter.outUser,
        poolAdapterConfigAfter.outCollateralAsset,
        poolAdapterConfigAfter.outBorrowAsset
      ].join();
      const expected = [
        converter,
        user,
        collateralAsset,
        borrowAsset
      ].join();
      return {ret, expected};
    }

    describe("Good paths", () => {
      it("Normal mode: should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        const r = await makeInitializePoolAdapterTest(false);
        expect(r.ret).eq(r.expected);
      });
      it("EMode: should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        const r = await makeInitializePoolAdapterTest(false);
        expect(r.ret).eq(r.expected);
      });
    });
    describe("Bad paths", () => {
      it("should revert on zero controller", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeInitializePoolAdapterTest(
            false,
            {zeroController: true}
          )
        ).revertedWith("TC-1"); // ZERO_ADDRESS
      });
      it("should revert on zero controller", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeInitializePoolAdapterTest(
            false,
            {zeroController: true}
          )
        ).revertedWith("TC-1"); // ZERO_ADDRESS
      });
      it("should revert on zero controller", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeInitializePoolAdapterTest(
            false,
            {zeroController: true}
          )
        ).revertedWith("TC-1"); // ZERO_ADDRESS
      });
      it("should revert on zero user", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeInitializePoolAdapterTest(
            false,
            {zeroUser: true}
          )
        ).revertedWith("TC-1"); // ZERO_ADDRESS
      });
      it("should revert on zero pool", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeInitializePoolAdapterTest(
            false,
            {zeroPool: true}
          )
        ).revertedWith("TC-1"); // ZERO_ADDRESS
      });
      it("should revert on zero converter", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeInitializePoolAdapterTest(
            false,
            {zeroConverter: true}
          )
        ).revertedWith("TC-1"); // ZERO_ADDRESS
      });
      it("should revert on zero collateral asset", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeInitializePoolAdapterTest(
            false,
            {zeroCollateralAsset: true}
          )
        ).revertedWith("TC-1"); // ZERO_ADDRESS
      });
      it("should revert on zero borrow asset", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeInitializePoolAdapterTest(
            false,
            {zeroBorrowAsset: true}
          )
        ).revertedWith("TC-1"); // ZERO_ADDRESS
      });
      it("should revert on second initialization", async () => {
        if (!await isPolygonForkInUse()) return;

        // we need an instance of aave3-pool-adapter to pass to revertedWithCustomError
        const aave3poolAdapterContract = await AdaptersHelper.createAave3PoolAdapter(deployer);

        await expect(
          makeInitializePoolAdapterTest(
            false,
            {makeSecondInitialization: true}
          )
        ).revertedWithCustomError(aave3poolAdapterContract, "ErrorAlreadyInitialized");
      });
    });
  });

  describe("claimRewards", () => {
    it("should return expected values", async () => {
      if (!await isPolygonForkInUse()) return;
      const receiver = ethers.Wallet.createRandom().address;
      const d = await Aave3TestUtils.prepareToBorrow(deployer,
        await TokenDataTypes.Build(deployer, MaticAddresses.DAI),
        [MaticAddresses.HOLDER_DAI],
        undefined,
        await TokenDataTypes.Build(deployer, MaticAddresses.WMATIC),
        false
      );
      const ret = await d.aavePoolAdapterAsTC.claimRewards(receiver);
      expect(ret.amount.toNumber()).eq(0);
    });
  });

  describe("getConversionKind", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        const d = await Aave3TestUtils.prepareToBorrow(deployer,
          await TokenDataTypes.Build(deployer, MaticAddresses.DAI),
          [MaticAddresses.HOLDER_DAI],
          undefined,
          await TokenDataTypes.Build(deployer, MaticAddresses.WMATIC),
          false
        );
        const ret = await d.aavePoolAdapterAsTC.getConversionKind();
        expect(ret).eq(2); // CONVERSION_KIND_BORROW_2
      });
    });
  });

  describe("getConfig", () => {
    async function getConfigTest(
      collateralAsset: string,
      holderCollateralAsset: string,
      borrowAsset: string,
      useEMode: boolean
    ): Promise<{ret: string, expected: string}> {
      const d = await Aave3TestUtils.prepareToBorrow(deployer,
        await TokenDataTypes.Build(deployer, collateralAsset),
        [holderCollateralAsset],
        undefined,
        await TokenDataTypes.Build(deployer, borrowAsset),
        useEMode
      );
      const r = await d.aavePoolAdapterAsTC.getConfig();
      const ret = [
        r.outCollateralAsset,
        r.outBorrowAsset,
        r.outUser,
        r.origin
      ].join().toLowerCase();
      const expected = [
        collateralAsset,
        borrowAsset,
        d.userContract.address,
        useEMode ? d.converterEMode : d.converterNormal
      ].join().toLowerCase();
      return {ret, expected};
    }
    describe("Good paths", () => {
      it("normal mode: should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        const r = await getConfigTest(
          MaticAddresses.DAI,
          MaticAddresses.HOLDER_DAI,
          MaticAddresses.WMATIC,
          false
        );
        expect(r.ret).eq(r.expected);
      });
      it("emode: should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        const r = await getConfigTest(
          MaticAddresses.USDC,
          MaticAddresses.HOLDER_USDC,
          MaticAddresses.USDT,
          true
        );
        expect(r.ret).eq(r.expected);
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

        const converterNormal = (await AdaptersHelper.createAave3PoolAdapter(deployer)).address;
        const platformAdapter = await AdaptersHelper.createAave3PlatformAdapter(
          deployer, controller.address, MaticAddresses.AAVE_V3_POOL,
          converterNormal,
          (await AdaptersHelper.createAave3PoolAdapterEMode(deployer)).address
        );

        const tetuConverterSigner = await DeployerUtils.startImpersonate(await controller.tetuConverter());

        const borrowManager = BorrowManager__factory.connect(await controller.borrowManager(), deployer);
        await borrowManager.addAssetPairs(platformAdapter.address, [collateralAsset], [borrowAsset]);

        const bmAsTc = BorrowManager__factory.connect(await controller.borrowManager(), tetuConverterSigner);

        // we need to catch event "OnInitialized" of pool adapter ... but we don't know address of the pool adapter yet
        const tx = await bmAsTc.registerPoolAdapter(converterNormal, userContract.address, collateralAsset, borrowAsset);
        const cr = await tx.wait();

        // now, we know the address of the pool adapter...
        const aavePoolAdapterAsTC = Aave3PoolAdapter__factory.connect(
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
          MaticAddresses.AAVE_V3_POOL,
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

        const converterNormal = (await AdaptersHelper.createAave3PoolAdapter(deployer)).address;
        const platformAdapter = await AdaptersHelper.createAave3PlatformAdapter(
          deployer, controller.address, MaticAddresses.AAVE_V3_POOL,
          converterNormal,
          (await AdaptersHelper.createAave3PoolAdapterEMode(deployer)).address
        );

        const tetuConverterSigner = await DeployerUtils.startImpersonate(await controller.tetuConverter());

        const borrowManager = BorrowManager__factory.connect(await controller.borrowManager(), deployer);
        await borrowManager.addAssetPairs(platformAdapter.address, [collateralAsset], [borrowAsset]);

        const bmAsTc = BorrowManager__factory.connect(await controller.borrowManager(), tetuConverterSigner);

        await bmAsTc.registerPoolAdapter(converterNormal, userContract.address, collateralAsset, borrowAsset);
        const aavePoolAdapterAsTC = Aave3PoolAdapter__factory.connect(
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
          (collateralBalance: BigNumber) => collateralBalance.gte(collateralAmount)
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
      const init = await Aave3TestUtils.prepareToBorrow(
        deployer,
        collateralToken,
        [collateralHolder],
        parseUnits("999", collateralToken.decimals),
        borrowToken,
        false
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

  describe("TODO:getAPR18 (next versions)", () => {
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