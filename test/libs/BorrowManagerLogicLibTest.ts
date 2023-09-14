import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {BorrowManagerLogicLibFacade, MockERC20} from "../../typechain";
import {IConversionPlan} from "../baseUT/apr/aprDataTypes";
import {MocksHelper} from "../baseUT/helpers/MocksHelper";
import {Misc} from "../../scripts/utils/Misc";
import {AppConstants} from "../baseUT/AppConstants";
import {defaultAbiCoder, formatUnits, parseUnits} from "ethers/lib/utils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {expect} from "chai";

describe("BorrowManagerLogicLibTest", () => {
//region Global vars for all tests
  let snapshotRoot: string;
  let signer: SignerWithAddress;
  let facade: BorrowManagerLogicLibFacade;
  let usdc: MockERC20;
  let usdt: MockERC20;
  let dai: MockERC20;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    snapshotRoot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    signer = signers[0];
    facade = await DeployUtils.deployContract(signer, "BorrowManagerLogicLibFacade") as BorrowManagerLogicLibFacade;

    usdc = await MocksHelper.createMockedToken(signer, "usdc", 6);
    usdt = await MocksHelper.createMockedToken(signer, "usdt", 6);
    dai = await MocksHelper.createMockedToken(signer, "dai", 18);
  });

  after(async function () {
    await TimeUtils.rollback(snapshotRoot);
  });


//endregion before, after

//region Unit tests
  /**
   * For calculations of input/output amounts see getPlanWithRebalancing.xlsx
   */
  describe("_getPlanWithRebalancing", () => {
    interface IGetPlanWithRebalancingParams {
      collateralAsset: MockERC20;
      borrowAsset: MockERC20;
      /** AmountIn passed to _getPlanWithRebalancing */
      amountIn: string;
      /** Params for the internal call of platformAdapter_.getConversionPlan */
      plan: {
        expectedFinalAmountIn: string;
        collateralAmountOut: string;
        borrowAmountOut: string;
      }
      entryKind: number;

      nonUnderlyingProportions?: string; // for entry kind 1 only, default 0.5
      collateralAmountToFix?: string; // default 0
      collateralAssetLiquidationThreshold?: string; // default 0.5
      targetHealthFactor2?: number; // default 1
    }
    interface IGetPlanWithRebalancingResults {
      /** AmountIn, passed to platformAdapter_.getConversionPlan, was equal to planIn.expectedFinalAmountIn */
      isFinalAmountCorrect: boolean;
      planOut: {
        collateralAmountOut: number;
        borrowAmountOut: number;
      }
    }

    async function getPlanWithRebalancing(p: IGetPlanWithRebalancingParams): Promise<IGetPlanWithRebalancingResults> {
      const platformAdapter = await MocksHelper.createLendingPlatformMock2(signer);
      const entryData = p.entryKind === AppConstants.ENTRY_KIND_0
        ? "0x"
        : p.entryKind === AppConstants.ENTRY_KIND_1
          ? defaultAbiCoder.encode(["uint256", "uint256", "uint256"], [AppConstants.ENTRY_KIND_1, 1, 1])
          : defaultAbiCoder.encode(["uint256"], [AppConstants.ENTRY_KIND_2]);

      const decimalsCollateral = await p.collateralAsset.decimals();
      const decimalsBorrow = await p.borrowAsset.decimals();

      const amountIn = p.entryKind === AppConstants.ENTRY_KIND_2
        ? parseUnits(p.amountIn, decimalsBorrow)
        : parseUnits(p.amountIn, decimalsCollateral);
      const finalAmountIn = p.entryKind === AppConstants.ENTRY_KIND_2
        ? parseUnits(p.plan.expectedFinalAmountIn, decimalsBorrow)
        : parseUnits(p.plan.expectedFinalAmountIn, decimalsCollateral);

      const stubPlanToReturn = {
        // Platform adapter returns not-zero plan only if it receives valid input amount
        // Actual values of the plan are not important
        // We only check that this not zero plan is received, that's all
        converter: ethers.Wallet.createRandom().address,
        collateralAmount: parseUnits(p.plan.collateralAmountOut, decimalsCollateral),
        amountToBorrow: parseUnits(p.plan.borrowAmountOut, decimalsBorrow),

        amountCollateralInBorrowAsset36: 1,
        liquidationThreshold18: 1,
        ltv18: 1,
        borrowCost36: 1,
        maxAmountToBorrow: 1,
        maxAmountToSupply: 1,
        rewardsAmountInBorrowAsset36: 1,
        supplyIncomeInBorrowAsset36: 1
      }
      await platformAdapter.setupGetConversionPlan(
        {
          collateralAsset: p.collateralAsset.address,
          borrowAsset: p?.borrowAsset.address,
          user: facade.address,
          amountIn: finalAmountIn,
          entryData,
          countBlocks: 1
        },
        stubPlanToReturn
      );

      const plan = await facade._getPlanWithRebalancing(
        platformAdapter.address,
        {
          collateralAsset: p.collateralAsset.address,
          borrowAsset: p?.borrowAsset.address,
          user: facade.address,
          amountIn,
          entryData,
          countBlocks: 1
        },
        p?.targetHealthFactor2 || 100,
        parseUnits(p?.collateralAmountToFix ?? "0", decimalsCollateral)
      );

      return {
        isFinalAmountCorrect: plan.converter !== Misc.ZERO_ADDRESS,
        planOut: {
          collateralAmountOut: +formatUnits(plan.collateralAmount, decimalsCollateral),
          borrowAmountOut: +formatUnits(plan.amountToBorrow, decimalsBorrow)
        }
      }
    }

    describe("Entry kind 0", () => {
      describe("zero amount to fix", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        function getPlanWithRebalancingTest(): Promise<IGetPlanWithRebalancingResults> {
          return getPlanWithRebalancing({
            collateralAsset: usdc,
            borrowAsset: usdt,
            amountIn: "100",
            entryKind: AppConstants.ENTRY_KIND_0,
            collateralAmountToFix: "0",
            plan: {
              expectedFinalAmountIn: "100",
              collateralAmountOut: "100",
              borrowAmountOut: "80"
            }
          });
        }

        it("should return expected collateral amount in plan", async () => {
          const ret = await loadFixture(getPlanWithRebalancingTest);
          expect(ret.planOut.collateralAmountOut).eq(100);
        });
        it("should return expected borrow amount in plan", async () => {
          const ret = await loadFixture(getPlanWithRebalancingTest);
          expect(ret.planOut.borrowAmountOut).eq(80);
        });
      });

      describe("amount to fix is less than the threshold", () => {
        describe("positive amount to fix (we need to provide more collateral)", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          function getPlanWithRebalancingTest(): Promise<IGetPlanWithRebalancingResults> {
            return getPlanWithRebalancing({
              collateralAsset: usdc,
              borrowAsset: usdt,
              amountIn: "100",
              entryKind: AppConstants.ENTRY_KIND_0,
              collateralAmountToFix: "30",
              plan: {
                expectedFinalAmountIn: "70",
                collateralAmountOut: "70",
                borrowAmountOut: "56"
              }
            });
          }

          it("should return expected collateral amount in plan", async () => {
            const ret = await loadFixture(getPlanWithRebalancingTest);
            expect(ret.planOut.collateralAmountOut).eq(100);
          });
          it("should return expected borrow amount in plan", async () => {
            const ret = await loadFixture(getPlanWithRebalancingTest);
            expect(ret.planOut.borrowAmountOut).eq(56);
          });
        });
        describe("negative amount to fix (we can borrow more)", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          function getPlanWithRebalancingTest(): Promise<IGetPlanWithRebalancingResults> {
            return getPlanWithRebalancing({
              collateralAsset: usdc,
              borrowAsset: usdt,
              amountIn: "1000",
              entryKind: AppConstants.ENTRY_KIND_0,
              collateralAmountToFix: "-30",
              plan: {
                expectedFinalAmountIn: "1030",
                collateralAmountOut: "1030",
                borrowAmountOut: "1004"
              }
            });
          }

          it("should return expected collateral amount in plan", async () => {
            const ret = await loadFixture(getPlanWithRebalancingTest);
            expect(ret.planOut.collateralAmountOut).eq(1000);
          });
          it("should return expected borrow amount in plan", async () => {
            const ret = await loadFixture(getPlanWithRebalancingTest);
            expect(ret.planOut.borrowAmountOut).eq(1004);
          });
        });
      });
      describe("amount to fix exceeds threshold", () => {
        describe("positive amount to fix (we need to provide more collateral)", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          function getPlanWithRebalancingTest(): Promise<IGetPlanWithRebalancingResults> {
            return getPlanWithRebalancing({
              collateralAsset: usdc,
              borrowAsset: usdt,
              amountIn: "100", // assume the threshold is 50%, so collateralAmountToFix shouldn't exceed 100 * 50/100 = 50
              entryKind: AppConstants.ENTRY_KIND_0,
              collateralAmountToFix: "90",
              plan: {
                expectedFinalAmountIn: "50",
                collateralAmountOut: "50",
                borrowAmountOut: "40"
              }
            });
          }

          it("should return expected collateral amount in plan", async () => {
            const ret = await loadFixture(getPlanWithRebalancingTest);
            expect(ret.planOut.collateralAmountOut).eq(100);
          });
          it("should return expected borrow amount in plan", async () => {
            const ret = await loadFixture(getPlanWithRebalancingTest);
            expect(ret.planOut.borrowAmountOut).eq(40);
          });
        });
        describe("negative amount to fix (we can borrow more)", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          function getPlanWithRebalancingTest(): Promise<IGetPlanWithRebalancingResults> {
            return getPlanWithRebalancing({
              collateralAsset: usdc,
              borrowAsset: usdt,
              amountIn: "1000", // assume the threshold is 10%, so collateralAmountToFix shouldn't exceed 1000 * 10/100 = 100
              entryKind: AppConstants.ENTRY_KIND_0,
              collateralAmountToFix: "-900",
              plan: {
                expectedFinalAmountIn: "1100",
                collateralAmountOut: "1100",
                borrowAmountOut: "880"
              }
            });
          }

          it("should return expected collateral amount in plan", async () => {
            const ret = await loadFixture(getPlanWithRebalancingTest);
            expect(ret.planOut.collateralAmountOut).eq(1000);
          });
          it("should return expected borrow amount in plan", async () => {
            const ret = await loadFixture(getPlanWithRebalancingTest);
            expect(ret.planOut.borrowAmountOut).eq(880);
          });
        });
      });
    });

    describe("Entry kind 1", () => {

    });
    describe("Entry kind 2", () => {
      describe("zero amount to fix", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        function getPlanWithRebalancingTest(): Promise<IGetPlanWithRebalancingResults> {
          return getPlanWithRebalancing({
            collateralAsset: usdc,
            borrowAsset: usdt,
            amountIn: "100",
            entryKind: AppConstants.ENTRY_KIND_2,
            collateralAmountToFix: "0",
            plan: {
              expectedFinalAmountIn: "100",
              collateralAmountOut: "125",
              borrowAmountOut: "100"
            }
          });
        }

        it("should return expected collateral amount in plan", async () => {
          const ret = await loadFixture(getPlanWithRebalancingTest);
          expect(ret.planOut.collateralAmountOut).eq(125);
        });
        it("should return expected borrow amount in plan", async () => {
          const ret = await loadFixture(getPlanWithRebalancingTest);
          expect(ret.planOut.borrowAmountOut).eq(100);
        });
      });

      describe("amount to fix is less than the threshold", () => {
        describe("positive amount to fix (we need to provide more collateral)", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          function getPlanWithRebalancingTest(): Promise<IGetPlanWithRebalancingResults> {
            return getPlanWithRebalancing({
              collateralAsset: usdc,
              borrowAsset: usdt,
              amountIn: "100",
              entryKind: AppConstants.ENTRY_KIND_2,
              collateralAmountToFix: "30",
              plan: {
                expectedFinalAmountIn: "100",
                collateralAmountOut: "125",
                borrowAmountOut: "100"
              }
            });
          }

          it("should return expected collateral amount in plan", async () => {
            const ret = await loadFixture(getPlanWithRebalancingTest);
            expect(ret.planOut.collateralAmountOut).eq(155);
          });
          it("should return expected borrow amount in plan", async () => {
            const ret = await loadFixture(getPlanWithRebalancingTest);
            expect(ret.planOut.borrowAmountOut).eq(100);
          });
        });
        describe("negative amount to fix (we can borrow more)", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          function getPlanWithRebalancingTest(): Promise<IGetPlanWithRebalancingResults> {
            return getPlanWithRebalancing({
              collateralAsset: usdc,
              borrowAsset: usdt,
              amountIn: "1000",
              entryKind: AppConstants.ENTRY_KIND_2,
              collateralAmountToFix: "-30",
              plan: {
                expectedFinalAmountIn: "1000",
                collateralAmountOut: "1250",
                borrowAmountOut: "1000"
              }
            });
          }

          it("should return expected collateral amount in plan", async () => {
            const ret = await loadFixture(getPlanWithRebalancingTest);
            expect(ret.planOut.collateralAmountOut).eq(1220);
          });
          it("should return expected borrow amount in plan", async () => {
            const ret = await loadFixture(getPlanWithRebalancingTest);
            expect(ret.planOut.borrowAmountOut).eq(1000);
          });
        });
      });
      describe("amount to fix exceeds threshold", () => {
        describe("positive amount to fix (we need to provide more collateral)", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          function getPlanWithRebalancingTest(): Promise<IGetPlanWithRebalancingResults> {
            return getPlanWithRebalancing({
              collateralAsset: usdc,
              borrowAsset: usdt,
              amountIn: "100", // assume the threshold is 50%, so collateralAmountToFix shouldn't exceed 100 * 50/100 = 50
              entryKind: AppConstants.ENTRY_KIND_2,
              collateralAmountToFix: "90",
              plan: {
                expectedFinalAmountIn: "100",
                collateralAmountOut: "125",
                borrowAmountOut: "100"
              }
            });
          }

          it("should return expected collateral amount in plan", async () => {
            const ret = await loadFixture(getPlanWithRebalancingTest);
            expect(ret.planOut.collateralAmountOut).eq(135);
          });
          it("should return expected borrow amount in plan", async () => {
            const ret = await loadFixture(getPlanWithRebalancingTest);
            expect(ret.planOut.borrowAmountOut).eq(100);
          });
        });
        describe("negative amount to fix (we can borrow more)", () => {
          let snapshot: string;
          before(async function () {
            snapshot = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          function getPlanWithRebalancingTest(): Promise<IGetPlanWithRebalancingResults> {
            return getPlanWithRebalancing({
              collateralAsset: usdc,
              borrowAsset: usdt,
              amountIn: "1000", // assume the threshold is 10%, so collateralAmountToFix shouldn't exceed 1000 * 10/100 = 100
              entryKind: 0,
              collateralAmountToFix: "-900",
              plan: {
                expectedFinalAmountIn: "1000",
                collateralAmountOut: "1250",
                borrowAmountOut: "1000"
              }
            });
          }

          it("should return expected collateral amount in plan", async () => {
            const ret = await loadFixture(getPlanWithRebalancingTest);
            expect(ret.planOut.collateralAmountOut).eq(1000);
          });
          it("should return expected borrow amount in plan", async () => {
            const ret = await loadFixture(getPlanWithRebalancingTest);
            expect(ret.planOut.borrowAmountOut).eq(1240);
          });
        });
      });
    });
  });

//endregion Unit tests

});
