import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {
  BorrowManagerLogicLibFacade,
  LendingPlatformMock2,
  MockERC20
} from "../../typechain";
import {MocksHelper} from "../baseUT/helpers/MocksHelper";
import {Misc} from "../../scripts/utils/Misc";
import {AppConstants} from "../baseUT/AppConstants";
import {defaultAbiCoder, formatUnits, parseUnits} from "ethers/lib/utils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {expect} from "chai";
import {HARDHAT_NETWORK_ID, HardhatUtils} from "../../scripts/utils/HardhatUtils";
import {BorrowManagerLogicLib} from "../../typechain/contracts/tests/facades/BorrowManagerLogicLibFacade";
import {BigNumber} from "ethers";

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
    await HardhatUtils.setupBeforeTest(HARDHAT_NETWORK_ID);

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
  interface IConversionPlan {
    expectedFinalAmountIn: string;
    collateralAmountOut?: string;
    borrowAmountOut: string;
    maxAmountToSupplyOut?: string; // default MAX_INT
    maxAmountToBorrowOut?: string; // default MAX_INT

    // amounts required to calculate apr

    amountCollateralInBorrowAsset36?: string; // default 1
    borrowCost36?: string; // default 1
    supplyIncomeInBorrowAsset36?: string; // default 1
  }

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

        maxAmountToSupply: Misc.MAX_UINT,
        maxAmountToBorrow: parseUnits(p.plan.borrowAmountOut, decimalsBorrow),

        amountCollateralInBorrowAsset36: 1,
        liquidationThreshold18: 1,
        ltv18: 1,
        borrowCost36: 1,
        rewardsAmountInBorrowAsset36: 1,
        supplyIncomeInBorrowAsset36: 1
      }
      await platformAdapter.setupGetConversionPlan(
        {
          collateralAsset: p.collateralAsset.address,
          borrowAsset: p?.borrowAsset.address,
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
          amountIn,
          entryData,
          countBlocks: 1
        },
        p?.targetHealthFactor2 || 100,
        [AppConstants.THRESHOLD_REBALANCE_TOO_HEALTHY, AppConstants.THRESHOLD_REBALANCE_UNHEALTHY],
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
            collateralAsset: dai,
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
              collateralAsset: dai,
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
              borrowAsset: dai,
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
            entryKind: AppConstants.ENTRY_KIND_1,
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
              amountIn: "300",
              entryKind: AppConstants.ENTRY_KIND_1,
              collateralAmountToFix: "15",
              plan: {
                expectedFinalAmountIn: "285",
                collateralAmountOut: "190",
                borrowAmountOut: "95"
              }
            });
          }

          it("should return expected collateral amount in plan", async () => {
            const ret = await loadFixture(getPlanWithRebalancingTest);
            expect(ret.planOut.collateralAmountOut).eq(190 + 15);
          });
          it("should return expected borrow amount in plan", async () => {
            const ret = await loadFixture(getPlanWithRebalancingTest);
            expect(ret.planOut.borrowAmountOut).eq(95);
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
              amountIn: "300",
              entryKind: AppConstants.ENTRY_KIND_1,
              collateralAmountToFix: "-15",
              plan: {
                expectedFinalAmountIn: "315",
                collateralAmountOut: "210",
                borrowAmountOut: "105"
              }
            });
          }

          it("should return expected collateral amount in plan", async () => {
            const ret = await loadFixture(getPlanWithRebalancingTest);
            expect(ret.planOut.collateralAmountOut).eq(210-15);
          });
          it("should return expected borrow amount in plan", async () => {
            const ret = await loadFixture(getPlanWithRebalancingTest);
            expect(ret.planOut.borrowAmountOut).eq(105);
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
              amountIn: "300",
              entryKind: AppConstants.ENTRY_KIND_1,
              collateralAmountToFix: "200", // we assume that 300/2 is max allowed delta
              plan: {
                expectedFinalAmountIn: "150",
                collateralAmountOut: "100",
                borrowAmountOut: "50"
              }
            });
          }

          it("should return expected collateral amount in plan", async () => {
            const ret = await loadFixture(getPlanWithRebalancingTest);
            expect(ret.planOut.collateralAmountOut).eq(100 + 150);
          });
          it("should return expected borrow amount in plan", async () => {
            const ret = await loadFixture(getPlanWithRebalancingTest);
            expect(ret.planOut.borrowAmountOut).eq(50);
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
              amountIn: "300",
              entryKind: AppConstants.ENTRY_KIND_1,
              collateralAmountToFix: "-300", // we assume that -30 is max allowed delta
              plan: {
                expectedFinalAmountIn: "330",
                collateralAmountOut: "220",
                borrowAmountOut: "110"
              }
            });
          }

          it("should return expected collateral amount in plan", async () => {
            const ret = await loadFixture(getPlanWithRebalancingTest);
            expect(ret.planOut.collateralAmountOut).eq(220-30);
          });
          it("should return expected borrow amount in plan", async () => {
            const ret = await loadFixture(getPlanWithRebalancingTest);
            expect(ret.planOut.borrowAmountOut).eq(110);
          });
        });
      });
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
            expect(ret.planOut.collateralAmountOut).eq(125/2 + 125);
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
              entryKind: AppConstants.ENTRY_KIND_2,
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
            expect(ret.planOut.collateralAmountOut).eq(1000+1250/10);
          });
          it("should return expected borrow amount in plan", async () => {
            const ret = await loadFixture(getPlanWithRebalancingTest);
            expect(ret.planOut.borrowAmountOut).eq(1000);
          });
        });
      });
    });
  });

  describe("_prepareOutput", () => {
    interface IBorrowCandidate {
      collateralAmount: string;
      amountToBorrow: string;
      apr: string;
      healthFactor?: string;
    }
    interface IPrepareOutputParams {
      collateralAsset?: MockERC20; // usdc by default
      borrowAsset?: MockERC20; // usdt by default
      data: IBorrowCandidate[];
      countDebts?: number; // 0 by defaults
    }
    interface IPrepareOutputResults {
      convertersIndices: number[];
      collateralAmounts: number[];
      borrowAmounts: number[];
      aprs: number[];
    }

    async function callPrepareOutput(p: IPrepareOutputParams): Promise<IPrepareOutputResults> {
      const decimalsCollateral = await (p.collateralAsset ?? usdc).decimals();
      const decimalsBorrow = await (p.borrowAsset ?? usdt).decimals();

      const converters = p.data.map(x => ethers.Wallet.createRandom().address);
      const bcc: BorrowManagerLogicLib.BorrowCandidateStruct[] = p.data.map(
        (d, index) => ({
          apr18: parseUnits(p.data[index].apr, 18),
          converter: converters[index],
          collateralAmount: parseUnits(p.data[index].collateralAmount, decimalsCollateral),
          amountToBorrow: parseUnits(p.data[index].amountToBorrow, decimalsBorrow),
          healthFactor18: parseUnits(p.data[index].healthFactor || "1", 18),
        })
      );
      const ret = await facade._prepareOutput(p.countDebts ?? 0, p.data.length, bcc);

      return {
        aprs: ret.aprs18.map(x => +formatUnits(x, 18)),
        collateralAmounts: ret.collateralAmounts.map(x => +formatUnits(x, decimalsCollateral)),
        borrowAmounts: ret.borrowAmounts.map(x => +formatUnits(x, decimalsBorrow)),
        convertersIndices: ret.converters.map(x => converters.findIndex(value => x === value))
      }
    }

    describe("Only new items", () => {
      let snapshot: string;
      before(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot);
      });

      async function prepareOutputTest() : Promise<IPrepareOutputResults> {
        return callPrepareOutput({
          data: [
            {apr: "1", collateralAmount: "11", amountToBorrow: "111"},
            {apr: "3", collateralAmount: "33", amountToBorrow: "333"},
            {apr: "2", collateralAmount: "22", amountToBorrow: "222"},
          ]
        });
      }

      it("should return expected converters", async() => {
        const ret = await loadFixture(prepareOutputTest);
        expect(ret.convertersIndices.join()).eq([0, 2, 1].join());
      });
      it("should return expected collateral amounts", async() => {
        const ret = await loadFixture(prepareOutputTest);
        expect(ret.collateralAmounts.join()).eq([11, 22, 33].join());
      });
      it("should return expected borrow amounts", async() => {
        const ret = await loadFixture(prepareOutputTest);
        expect(ret.borrowAmounts.join()).eq([111, 222, 333].join());
      });
      it("should return ordered aprs", async() => {
        const ret = await loadFixture(prepareOutputTest);
        expect(ret.aprs.join()).eq([1, 2, 3].join());
      });
    });
    describe("Only exist debts", () => {
      describe("Same health factor", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function prepareOutputTest(): Promise<IPrepareOutputResults> {
          return callPrepareOutput({
            countDebts: 3,
            data: [
              {apr: "3", collateralAmount: "33", amountToBorrow: "333"},
              {apr: "1", collateralAmount: "11", amountToBorrow: "111"},
              {apr: "2", collateralAmount: "22", amountToBorrow: "222"},
            ]
          });
        }

        it("should return expected converters", async () => {
          const ret = await loadFixture(prepareOutputTest);
          expect(ret.convertersIndices.join()).eq([0, 1, 2].join());
        });
        it("should return expected collateral amounts", async () => {
          const ret = await loadFixture(prepareOutputTest);
          expect(ret.collateralAmounts.join()).eq([33, 11, 22].join());
        });
        it("should return expected borrow amounts", async () => {
          const ret = await loadFixture(prepareOutputTest);
          expect(ret.borrowAmounts.join()).eq([333, 111, 222].join());
        });
        it("should return expected aprs", async () => {
          const ret = await loadFixture(prepareOutputTest);
          expect(ret.aprs.join()).eq([3, 1, 2].join());
        });
      });
      describe("Different health factors", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function prepareOutputTest(): Promise<IPrepareOutputResults> {
          return callPrepareOutput({
            countDebts: 3,
            data: [
              {apr: "3", collateralAmount: "33", amountToBorrow: "333", healthFactor: "7"},
              {apr: "1", collateralAmount: "11", amountToBorrow: "111", healthFactor: "1"},
              {apr: "2", collateralAmount: "22", amountToBorrow: "222", healthFactor: "4"},
            ]
          });
        }

        it("should return expected converters", async () => {
          const ret = await loadFixture(prepareOutputTest);
          expect(ret.convertersIndices.join()).eq([1, 2, 0].join());
        });
        it("should return expected collateral amounts", async () => {
          const ret = await loadFixture(prepareOutputTest);
          expect(ret.collateralAmounts.join()).eq([11, 22, 33].join());
        });
        it("should return expected borrow amounts", async () => {
          const ret = await loadFixture(prepareOutputTest);
          expect(ret.borrowAmounts.join()).eq([111, 222, 333].join());
        });
        it("should return expected aprs", async () => {
          const ret = await loadFixture(prepareOutputTest);
          expect(ret.aprs.join()).eq([1, 2, 3].join());
        });
      });
    });
    describe("New and exit debts", () => {
      let snapshot: string;
      before(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot);
      });

      async function prepareOutputTest() : Promise<IPrepareOutputResults> {
        return callPrepareOutput({
          countDebts: 2,
          data: [
            {apr: "4", collateralAmount: "44", amountToBorrow: "444", healthFactor: "5"},
            {apr: "1", collateralAmount: "11", amountToBorrow: "111", healthFactor: "50"},
            {apr: "3", collateralAmount: "33", amountToBorrow: "333"},
            {apr: "2", collateralAmount: "22", amountToBorrow: "222"},
          ]
        });
      }

      it("should return expected converters", async() => {
        const ret = await loadFixture(prepareOutputTest);
        expect(ret.convertersIndices.join()).eq([0, 1, 3, 2].join());
      });
      it("should return expected collateral amounts", async() => {
        const ret = await loadFixture(prepareOutputTest);
        expect(ret.collateralAmounts.join()).eq([44, 11, 22, 33].join());
      });
      it("should return expected borrow amounts", async() => {
        const ret = await loadFixture(prepareOutputTest);
        expect(ret.borrowAmounts.join()).eq([444, 111, 222, 333].join());
      });
      it("should return expected aprs", async() => {
        const ret = await loadFixture(prepareOutputTest);
        expect(ret.aprs.join()).eq([4, 1, 2, 3].join());
      });
    });
  });

  describe("_getExistValidPoolAdapter", () => {
    interface IGetExistValidPoolAdapterParams {
      countPlatformAdapters: number;
      index0: number;

      poolAdapterPosition?: number; // default undefined (there is no exist debt)
      poolAdapterHealthFactor?: string; // default 1.0

      minHealthFactor?: string; // default 1.0
    }

    interface IGetExistValidPoolAdapterResults {
      indexPlatformAdapter: number;
      poolAdapterExpected: boolean;
      healthFactor: number;
    }

    async function getExistValidPoolAdapter(p: IGetExistValidPoolAdapterParams): Promise<IGetExistValidPoolAdapterResults> {
      const user = ethers.Wallet.createRandom().address;
      const collateralAsset = ethers.Wallet.createRandom().address;
      const borrowAsset = ethers.Wallet.createRandom().address;

      const targetConverter = ethers.Wallet.createRandom().address;
      const platformAdapters = await Promise.all([...Array(p.countPlatformAdapters).keys()].map(
        async (x, index) => MocksHelper.createPlatformAdapterStub(
          signer,
          [
            ethers.Wallet.createRandom().address,
            index === p.poolAdapterPosition
              ? targetConverter
              : ethers.Wallet.createRandom().address
          ]
        )
      ));

      const poolAdapter = await MocksHelper.createPoolAdapterMock2(signer);
      await poolAdapter.setStatus(
        0, // not used here
        0, // not used here
        parseUnits(p.poolAdapterHealthFactor ?? "1", 18),
        true, // not used here
        0, // not used here
        false // not used here
      );

      const borrowManager = await MocksHelper.createBorrowManagerMock(signer);
      await borrowManager.setupGetPoolAdapter(targetConverter, user, collateralAsset, borrowAsset, poolAdapter.address);

      const minHealthFactor2 = parseUnits(p.minHealthFactor ?? "1", 2);

      const ret = await facade._getExistValidPoolAdapter(
        platformAdapters.map(x => x.address),
        p.index0,
        user,
        collateralAsset,
        borrowAsset,
        borrowManager.address,
        minHealthFactor2
      );

      return {
        indexPlatformAdapter: ret.indexPlatformAdapter.toNumber(),
        poolAdapterExpected: ret.poolAdapter === poolAdapter.address,
        healthFactor: +formatUnits(ret.healthFactor18, 18)
      }
    }

    describe("there are no exist debts", () => {
      let snapshot: string;
      before(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot);
      });

      async function getExistValidPoolAdapterTest(): Promise<IGetExistValidPoolAdapterResults> {
        return getExistValidPoolAdapter({
          index0: 0,
          countPlatformAdapters: 2
        });
      }

      it("should return expected indexPlatformAdapter", async () => {
        const ret = await loadFixture(getExistValidPoolAdapterTest);
        expect(ret.indexPlatformAdapter).eq(2);
      });
      it("should return zero address of the pool adapter", async () => {
        const ret = await loadFixture(getExistValidPoolAdapterTest);
        expect(ret.poolAdapterExpected).eq(false);
      });
      it("should return zero health factor", async () => {
        const ret = await loadFixture(getExistValidPoolAdapterTest);
        expect(ret.healthFactor).eq(0);
      });
    });

    describe("there is exist debts in the search range", () => {
      let snapshot: string;
      before(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot);
      });

      async function getExistValidPoolAdapterTest(): Promise<IGetExistValidPoolAdapterResults> {
        return getExistValidPoolAdapter({
          index0: 0,
          countPlatformAdapters: 3,
          poolAdapterPosition: 1,
          poolAdapterHealthFactor: "1.5",
          minHealthFactor: "1.03"
        });
      }

      it("should return expected indexPlatformAdapter", async () => {
        const ret = await loadFixture(getExistValidPoolAdapterTest);
        expect(ret.indexPlatformAdapter).eq(1);
      });
      it("should return expected address of the pool adapter", async () => {
        const ret = await loadFixture(getExistValidPoolAdapterTest);
        expect(ret.poolAdapterExpected).eq(true);
      });
      it("should return expected health factor", async () => {
        const ret = await loadFixture(getExistValidPoolAdapterTest);
        expect(ret.healthFactor).eq(1.5);
      });
    });

    describe("there is no exist debts in the search range", () => {
      let snapshot: string;
      before(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot);
      });

      async function getExistValidPoolAdapterTest(): Promise<IGetExistValidPoolAdapterResults> {
        return getExistValidPoolAdapter({
          index0: 2,
          countPlatformAdapters: 5,
          poolAdapterPosition: 1,
          poolAdapterHealthFactor: "1.5",
          minHealthFactor: "1.03"
        });
      }

      it("should return expected indexPlatformAdapter", async () => {
        const ret = await loadFixture(getExistValidPoolAdapterTest);
        expect(ret.indexPlatformAdapter).eq(5);
      });
      it("should return zero address of the pool adapter", async () => {
        const ret = await loadFixture(getExistValidPoolAdapterTest);
        expect(ret.poolAdapterExpected).eq(false);
      });
      it("should return zero health factor", async () => {
        const ret = await loadFixture(getExistValidPoolAdapterTest);
        expect(ret.healthFactor).eq(0);
      });
    });

    describe("Exist debt is dirty", () => {
      let snapshot: string;
      before(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot);
      });

      async function getExistValidPoolAdapterTest(): Promise<IGetExistValidPoolAdapterResults> {
        return getExistValidPoolAdapter({
          index0: 0,
          countPlatformAdapters: 5,
          poolAdapterPosition: 1,
          poolAdapterHealthFactor: "0.9", // dirty
          minHealthFactor: "1.03"
        });
      }

      it("should return expected indexPlatformAdapter", async () => {
        const ret = await loadFixture(getExistValidPoolAdapterTest);
        expect(ret.indexPlatformAdapter).eq(5);
      });
      it("should return zero address of the pool adapter", async () => {
        const ret = await loadFixture(getExistValidPoolAdapterTest);
        expect(ret.poolAdapterExpected).eq(false);
      });
      it("should return zero health factor", async () => {
        const ret = await loadFixture(getExistValidPoolAdapterTest);
        expect(ret.healthFactor).eq(0);
      });
    });
  });

  describe("_findConversionStrategyForExistDebt", () => {
    interface IFindConversionStrategyParams {
      collateralAsset?: MockERC20; // usdc by default
      borrowAsset?: MockERC20; // usdt by default

      /** AmountIn passed to _getPlanWithRebalancing */
      amountIn: string;

      targetHealthFactor?: string; // default 1

      /** Params for the internal call of platformAdapter_.getConversionPlan */
      plan: {
        converter?: string;
        expectedFinalAmountIn: string;
        collateralAmountOut: string;
        borrowAmountOut: string;
        maxAmountToSupplyOut?: string; // default MAX_INT
        maxAmountToBorrowOut?: string; // default MAX_INT

        // amounts required to calculate apr

        amountCollateralInBorrowAsset36?: string; // default 1
        borrowCost36?: string; // default 1
        supplyIncomeInBorrowAsset36?: string; // default 1
      }

      poolAdapterStatus: {
        collateralAmount: string;
        amountToPay: string;
        healthFactor18: string;
      }
    }
    interface IFindConversionStrategyResults {
      partialBorrow: boolean;
      borrowCandidate: {
        converter: string;
        collateralAmount: number;
        amountToBorrow: number;
        apr: number;
        healthFactor: number;
      }
      originConverter: string;
    }

    async function findConversionStrategyForExistDebt(p: IFindConversionStrategyParams): Promise<IFindConversionStrategyResults> {
      const platformAdapter = await MocksHelper.createLendingPlatformMock2(signer);
      const poolAdapter = await MocksHelper.createPoolAdapterMock2(signer);

      const collateralAsset = (p.collateralAsset || usdc);
      const borrowAsset = (p.borrowAsset || usdt);
      const decimalsCollateral = await collateralAsset.decimals();
      const decimalsBorrow = await borrowAsset.decimals();

      const entryData = "0x";
      const amountIn = parseUnits(p.amountIn, decimalsCollateral);
      const finalAmountIn= parseUnits(p.plan.expectedFinalAmountIn, decimalsCollateral);

      const rewardsFactor = parseUnits("1", 18);
      const targetHealthFactor2 = parseUnits(p.targetHealthFactor ?? "1", 2);

      // set up pool adapter
      await poolAdapter.setStatus(
        parseUnits(p.poolAdapterStatus.collateralAmount, decimalsCollateral),
        parseUnits(p.poolAdapterStatus.amountToPay, decimalsBorrow),
        parseUnits(p.poolAdapterStatus.healthFactor18, 18),
        true,
        0,
        true
      );

      // set up _getPlanWithRebalancing
      const planOut = {
        // Platform adapter returns not-zero plan only if it receives valid input amount
        // Actual values of the plan are not important
        // We only check that this not zero plan is received, that's all
        converter: p.plan.converter || ethers.Wallet.createRandom().address,
        collateralAmount: parseUnits(p.plan.collateralAmountOut, decimalsCollateral),
        amountToBorrow: parseUnits(p.plan.borrowAmountOut, decimalsBorrow),

        maxAmountToBorrow: p.plan.maxAmountToBorrowOut
          ? parseUnits(p.plan.maxAmountToBorrowOut, decimalsBorrow)
          : Misc.MAX_UINT,
        maxAmountToSupply: p.plan.maxAmountToSupplyOut
          ? parseUnits(p.plan.maxAmountToSupplyOut, decimalsCollateral)
          : Misc.MAX_UINT,

        borrowCost36: parseUnits(p.plan.borrowCost36 ?? "1", 36),
        amountCollateralInBorrowAsset36: parseUnits(p.plan.amountCollateralInBorrowAsset36 ?? "1", 36),
        supplyIncomeInBorrowAsset36: parseUnits(p.plan.supplyIncomeInBorrowAsset36 ?? "1", 36),

        liquidationThreshold18: 1,
        ltv18: 1,
        rewardsAmountInBorrowAsset36: 1,
      }
      await platformAdapter.setupGetConversionPlan(
        {
          collateralAsset: collateralAsset.address,
          borrowAsset: borrowAsset.address,
          amountIn: finalAmountIn,
          entryData,
          countBlocks: 1
        },
        planOut
      );

      const ret = await facade._findConversionStrategyForExistDebt(
        poolAdapter.address,
        platformAdapter.address,
        {
          collateralAsset: collateralAsset.address,
          borrowAsset: borrowAsset.address,
          amountIn,
          entryData,
          countBlocks: 1
        },
        {
          controller: ethers.Wallet.createRandom().address, // not used
          rewardsFactor,
          targetHealthFactor2,
          thresholds: [AppConstants.THRESHOLD_REBALANCE_TOO_HEALTHY, AppConstants.THRESHOLD_REBALANCE_UNHEALTHY],
        }
      )

      return {
        partialBorrow: ret.partialBorrow,
        borrowCandidate: {
          converter: ret.dest.converter,
          collateralAmount: +formatUnits(ret.dest.collateralAmount, decimalsCollateral),
          amountToBorrow: +formatUnits(ret.dest.amountToBorrow, decimalsBorrow),
          apr: +formatUnits(ret.dest.apr18, 18),
          healthFactor: +formatUnits(ret.dest.healthFactor18, 18),
        },
        originConverter: p.plan.converter ?? Misc.ZERO_ADDRESS
      }
    }

    describe("Exist debt, health factor doesn't need any correction", () => {
      describe("New borrow is not possible, collateralAmountToFix is zero", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function findConversionStrategyForExistDebtTest(): Promise<IFindConversionStrategyResults> {
          return findConversionStrategyForExistDebt({
            amountIn: "100",
            plan: {
              expectedFinalAmountIn: "100",
              collateralAmountOut: "0",
              converter: Misc.ZERO_ADDRESS,
              maxAmountToSupplyOut: "0",
              borrowAmountOut: "0",
              maxAmountToBorrowOut: "0",
            },
            poolAdapterStatus: {
              collateralAmount: "200",
              amountToPay: "200",
              healthFactor18: "1"
            }
          });
        }

        it("should return zero converter", async () => {
          const ret = await loadFixture(findConversionStrategyForExistDebtTest);
          expect(ret.borrowCandidate.converter).eq(Misc.ZERO_ADDRESS);
        });
      });
      describe("Full borrow", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function findConversionStrategyForExistDebtTest(): Promise<IFindConversionStrategyResults> {
          return findConversionStrategyForExistDebt({
            amountIn: "107",
            targetHealthFactor: "2",
            plan: {
              expectedFinalAmountIn: "107",
              collateralAmountOut: "107",
              converter: ethers.Wallet.createRandom().address,
              maxAmountToSupplyOut: "107000",
              borrowAmountOut: "53",
              maxAmountToBorrowOut: "53000",

              // amounts required to calculate apr

              borrowCost36: "14",
              amountCollateralInBorrowAsset36: "3",
              supplyIncomeInBorrowAsset36: "2"

            },
            poolAdapterStatus: {
              collateralAmount: "200",
              amountToPay: "100",
              healthFactor18: "2"
            },
          });
        }

        it("should return expected converter", async () => {
          const ret = await loadFixture(findConversionStrategyForExistDebtTest);
          expect(ret.borrowCandidate.converter).eq(ret.originConverter);
        });
        it("should return expected amountToBorrow", async () => {
          const ret = await loadFixture(findConversionStrategyForExistDebtTest);
          expect(ret.borrowCandidate.amountToBorrow).eq(53);
        });
        it("should return expected collateralAmount", async () => {
          const ret = await loadFixture(findConversionStrategyForExistDebtTest);
          expect(ret.borrowCandidate.collateralAmount).eq(107);
        });
        it("should return expected apr", async () => {
          const ret = await loadFixture(findConversionStrategyForExistDebtTest);
          expect(ret.borrowCandidate.apr).eq((14 - 2) / 3);
        });
        it("should return current health factor", async () => {
          const ret = await loadFixture(findConversionStrategyForExistDebtTest);
          expect(ret.borrowCandidate.healthFactor).eq(2);
        });
        it("should return not-partial borrow", async () => {
          const ret = await loadFixture(findConversionStrategyForExistDebtTest);
          expect(ret.partialBorrow).eq(false);
        });
      });
      describe("Partial borrow because of maxAmountToBorrow", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function findConversionStrategyForExistDebtTest(): Promise<IFindConversionStrategyResults> {
          return findConversionStrategyForExistDebt({
            amountIn: "107",
            targetHealthFactor: "2",
            plan: {
              expectedFinalAmountIn: "107",
              collateralAmountOut: "107",
              converter: ethers.Wallet.createRandom().address,
              maxAmountToSupplyOut: "107000",
              borrowAmountOut: "53",
              maxAmountToBorrowOut: "53", // (!)

              // amounts required to calculate apr

              borrowCost36: "14",
              amountCollateralInBorrowAsset36: "3",
              supplyIncomeInBorrowAsset36: "2"

            },
            poolAdapterStatus: {
              collateralAmount: "200",
              amountToPay: "100",
              healthFactor18: "2"
            },
          });
        }

        it("should return expected converter", async () => {
          const ret = await loadFixture(findConversionStrategyForExistDebtTest);
          expect(ret.borrowCandidate.converter).eq(ret.originConverter);
        });
        it("should return partial borrow", async () => {
          const ret = await loadFixture(findConversionStrategyForExistDebtTest);
          expect(ret.partialBorrow).eq(true);
        });
      });
      describe("Partial borrow because of maxAmountToSupply", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function findConversionStrategyForExistDebtTest(): Promise<IFindConversionStrategyResults> {
          return findConversionStrategyForExistDebt({
            amountIn: "107",
            targetHealthFactor: "2",
            plan: {
              expectedFinalAmountIn: "107",
              collateralAmountOut: "107",
              converter: ethers.Wallet.createRandom().address,
              maxAmountToSupplyOut: "107", // (1)
              borrowAmountOut: "53",
              maxAmountToBorrowOut: "530000",

              // amounts required to calculate apr

              borrowCost36: "14",
              amountCollateralInBorrowAsset36: "3",
              supplyIncomeInBorrowAsset36: "2"

            },
            poolAdapterStatus: {
              collateralAmount: "200",
              amountToPay: "100",
              healthFactor18: "2"
            },
          });
        }

        it("should return expected converter", async () => {
          const ret = await loadFixture(findConversionStrategyForExistDebtTest);
          expect(ret.borrowCandidate.converter).eq(ret.originConverter);
        });
        it("should return partial borrow", async () => {
          const ret = await loadFixture(findConversionStrategyForExistDebtTest);
          expect(ret.partialBorrow).eq(true);
        });
      });
    });
  });

  describe('_findCandidatesForExistDebts', () => {
    interface IPlatformParams {
      /** Params for the internal call of platformAdapter_.getConversionPlan */
      plan: IConversionPlan;

      poolAdapterStatus?: {
        collateralAmount: string;
        amountToPay: string;
        healthFactor18: string;
      }
    }

    interface IBorrowCandidate {
      collateralAmount: number;
      amountToBorrow: number;
      apr: number;
      healthFactor: number;
    }

    interface IFindCandidatesForExistDebtsParams {
      /** AmountIn passed to _getPlanWithRebalancing */
      amountIn: string;
      targetHealthFactor?: string; // default 1
      platforms: IPlatformParams[];
    }
    interface IFindCandidatesForExistDebtsResults {
      count: number;
      needMore: boolean;
      dest: IBorrowCandidate[];
    }
    async function findCandidatesForExistDebts(p: IFindCandidatesForExistDebtsParams): Promise<IFindCandidatesForExistDebtsResults> {
      const collateralAsset = usdc;
      const borrowAsset = usdt;
      const decimalsCollateral = await collateralAsset.decimals();
      const decimalsBorrow = await borrowAsset.decimals();

      const rewardsFactor = parseUnits("1", 18);
      const targetHealthFactor2 = parseUnits(p.targetHealthFactor ?? "1", 2);

      const amountIn = parseUnits(p.amountIn, decimalsCollateral);

      // set up controller and borrow manager
      const controller = await MocksHelper.createConverterControllerMock(signer);
      await controller.setupMinHealthFactor2(1);

      const borrowMananger = await MocksHelper.createBorrowManagerMock(signer);
      await controller.setupBorrowManager(borrowMananger.address);

      // set up platform adapters
      const platformAdapters: LendingPlatformMock2[] = [];
      for (const pp of p.platforms) {
        const converter = ethers.Wallet.createRandom().address; // for simplicity there is only one converter per platform
        // set up platform adapter
        const platformAdapter = await MocksHelper.createLendingPlatformMock2(signer);
        platformAdapters.push(platformAdapter);

        await platformAdapter.setupConverters([converter]);

        const finalAmountIn = parseUnits(pp.plan.expectedFinalAmountIn, decimalsCollateral);

        // set up _getPlanWithRebalancing
        const planOut = {
          // Platform adapter returns not-zero plan only if it receives valid input amount
          // Actual values of the plan are not important
          // We only check that this not zero plan is received, that's all
          converter,
          collateralAmount: parseUnits(pp.plan.collateralAmountOut || pp.plan.expectedFinalAmountIn, decimalsCollateral),
          amountToBorrow: parseUnits(pp.plan.borrowAmountOut, decimalsBorrow),

          maxAmountToBorrow: pp.plan.maxAmountToBorrowOut
            ? parseUnits(pp.plan.maxAmountToBorrowOut, decimalsBorrow)
            : Misc.MAX_UINT,
          maxAmountToSupply: pp.plan.maxAmountToSupplyOut
            ? parseUnits(pp.plan.maxAmountToSupplyOut, decimalsCollateral)
            : Misc.MAX_UINT,

          borrowCost36: parseUnits(pp.plan.borrowCost36 ?? "1", 36),
          amountCollateralInBorrowAsset36: parseUnits(pp.plan.amountCollateralInBorrowAsset36 ?? "1", 36),
          supplyIncomeInBorrowAsset36: parseUnits(pp.plan.supplyIncomeInBorrowAsset36 ?? "1", 36),

          liquidationThreshold18: 1,
          ltv18: 1,
          rewardsAmountInBorrowAsset36: 1,
        }

        await platformAdapter.setupGetConversionPlan(
          {
            collateralAsset: collateralAsset.address,
            borrowAsset: borrowAsset.address,
            amountIn: finalAmountIn,
            entryData: "0x",
            countBlocks: 1
          },
          planOut
        );

        // set up pool adapter (exist debt)
        if (pp.poolAdapterStatus) {
          const poolAdapter = await MocksHelper.createPoolAdapterMock2(signer);

          // set up pool adapter
          await poolAdapter.setStatus(
            parseUnits(pp.poolAdapterStatus.collateralAmount, decimalsCollateral),
            parseUnits(pp.poolAdapterStatus.amountToPay, decimalsBorrow),
            parseUnits(pp.poolAdapterStatus.healthFactor18, 18),
            true,
            0,
            true
          );

          await borrowMananger.setupGetPoolAdapter(
            converter,
            facade.address,
            collateralAsset.address,
            borrowAsset.address,
            poolAdapter.address
          );
        }
      }

      const ret = await facade._findCandidatesForExistDebts(
        platformAdapters.map(x => x.address),
        {
          collateralAsset: collateralAsset.address,
          borrowAsset: borrowAsset.address,
          amountIn,
          entryData: "0x",
          countBlocks: 1
        },
        {
          controller: controller.address,
          rewardsFactor,
          targetHealthFactor2,
          thresholds: [AppConstants.THRESHOLD_REBALANCE_TOO_HEALTHY, AppConstants.THRESHOLD_REBALANCE_UNHEALTHY],
        },
        platformAdapters.map(() => ({
          converter: Misc.ZERO_ADDRESS,
          collateralAmount: BigNumber.from(0),
          amountToBorrow: BigNumber.from(0),
          apr18: BigNumber.from(0),
          healthFactor18: BigNumber.from(0),
        })),
        facade.address,
      );

      return {
        count: ret.count.toNumber(),
        needMore: ret.needMore,
        dest: ret.candidates.map(x => ({
          collateralAmount: +formatUnits(x.collateralAmount, decimalsCollateral),
          amountToBorrow: +formatUnits(x.amountToBorrow, decimalsBorrow),
          apr: +formatUnits(x.apr18, 18),
          healthFactor: +formatUnits(x.healthFactor18, 18),
          })
        )
      }
    }

    describe("No exist debts", () => {
      let snapshot: string;
      before(async function () {
        snapshot = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshot);
      });

      async function findCandidatesForExistDebtsTest() : Promise<IFindCandidatesForExistDebtsResults> {
        return findCandidatesForExistDebts({
          amountIn: "100",
          platforms: [
            { plan: {expectedFinalAmountIn: "100", borrowAmountOut: "50",} },
            { plan: {expectedFinalAmountIn: "100", borrowAmountOut: "45",} },
          ]
        });
      }

      it("should return zero count (no exist debts)", async() => {
        const ret = await loadFixture(findCandidatesForExistDebtsTest);
        expect(ret.count).eq(0);
      });
      it("should return needMore = true", async() => {
        const ret = await loadFixture(findCandidatesForExistDebtsTest);
        expect(ret.needMore).eq(true);
      });
    });
    describe("health factor is healthy, no collateral addon is required", () => {
      describe("Two exist debts, full borrow is possible", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function findCandidatesForExistDebtsTest(): Promise<IFindCandidatesForExistDebtsResults> {
          return findCandidatesForExistDebts({
            amountIn: "100",
            targetHealthFactor: "2",
            platforms: [
              {plan: {expectedFinalAmountIn: "100", borrowAmountOut: "70",},}, // no exist debt
              {
                plan: {expectedFinalAmountIn: "100", borrowAmountOut: "50",},
                poolAdapterStatus: {collateralAmount: "2", amountToPay: "1", healthFactor18: "2",}
              },
              {plan: {expectedFinalAmountIn: "100", borrowAmountOut: "70",},}, // no exist debt
              {
                plan: {expectedFinalAmountIn: "100", borrowAmountOut: "45",},
                poolAdapterStatus: {collateralAmount: "4", amountToPay: "2", healthFactor18: "2",}
              },
              {plan: {expectedFinalAmountIn: "100", borrowAmountOut: "70",},}, // no exist debt
            ]
          });
        }

        it("should return expected count", async () => {
          const ret = await loadFixture(findCandidatesForExistDebtsTest);
          expect(ret.count).eq(2);
        });
        it("should return needMore = false", async () => {
          const ret = await loadFixture(findCandidatesForExistDebtsTest);
          expect(ret.needMore).eq(false);
        });
        it("should return array of candidates with expected size", async () => {
          const ret = await loadFixture(findCandidatesForExistDebtsTest);
          expect(ret.dest.length).eq(5);
        });
        it("should return expected health factors", async () => {
          const ret = await loadFixture(findCandidatesForExistDebtsTest);
          expect([ret.dest[0].healthFactor, ret.dest[1].healthFactor].join()).eq([2, 2].join());
        });
        it("should return expected collateral amounts", async () => {
          const ret = await loadFixture(findCandidatesForExistDebtsTest);
          expect([ret.dest[0].collateralAmount, ret.dest[1].collateralAmount].join()).eq([100, 100].join());
        });
        it("should return expected borrow amounts", async () => {
          const ret = await loadFixture(findCandidatesForExistDebtsTest);
          expect([ret.dest[0].amountToBorrow, ret.dest[1].amountToBorrow].join()).eq([50, 45].join());
        });
      });
      describe("Two exist debts, only partial borrow is possible on one of platforms", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function findCandidatesForExistDebtsTest(): Promise<IFindCandidatesForExistDebtsResults> {
          return findCandidatesForExistDebts({
            amountIn: "100",
            targetHealthFactor: "2",
            platforms: [
              {
                // only partial borrow is possible
                plan: {expectedFinalAmountIn: "100", borrowAmountOut: "50", maxAmountToBorrowOut: "50"},
                poolAdapterStatus: {collateralAmount: "2", amountToPay: "1", healthFactor18: "2",}
              },
              {
                // full borrow is possible
                plan: {expectedFinalAmountIn: "100", borrowAmountOut: "45",},
                poolAdapterStatus: {collateralAmount: "4", amountToPay: "2", healthFactor18: "2",}
              },
            ]
          });
        }

        it("should return expected count", async () => {
          const ret = await loadFixture(findCandidatesForExistDebtsTest);
          expect(ret.count).eq(2);
        });
        it("should return needMore = false", async () => {
          const ret = await loadFixture(findCandidatesForExistDebtsTest);
          expect(ret.needMore).eq(false);
        });
        it("should return array of candidates with expected size", async () => {
          const ret = await loadFixture(findCandidatesForExistDebtsTest);
          expect(ret.dest.length).eq(2);
        });
        it("should return expected health factors", async () => {
          const ret = await loadFixture(findCandidatesForExistDebtsTest);
          expect([ret.dest[0].healthFactor, ret.dest[1].healthFactor].join()).eq([2, 2].join());
        });
        it("should return expected collateral amounts", async () => {
          const ret = await loadFixture(findCandidatesForExistDebtsTest);
          expect([ret.dest[0].collateralAmount, ret.dest[1].collateralAmount].join()).eq([100, 100].join());
        });
        it("should return expected borrow amounts", async () => {
          const ret = await loadFixture(findCandidatesForExistDebtsTest);
          expect([ret.dest[0].amountToBorrow, ret.dest[1].amountToBorrow].join()).eq([50, 45].join());
        });
      });
      describe("Two exist debts, only partial borrow is possible on both platforms", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function findCandidatesForExistDebtsTest(): Promise<IFindCandidatesForExistDebtsResults> {
          return findCandidatesForExistDebts({
            amountIn: "100",
            targetHealthFactor: "2",
            platforms: [
              { // only partial borrow is possible
                plan: {expectedFinalAmountIn: "100", borrowAmountOut: "50", maxAmountToBorrowOut: "50"},
                poolAdapterStatus: {collateralAmount: "2", amountToPay: "1", healthFactor18: "2",}
              },
              { // only partial borrow is possible
                plan: {expectedFinalAmountIn: "100", borrowAmountOut: "45", maxAmountToBorrowOut: "45"},
                poolAdapterStatus: {collateralAmount: "4", amountToPay: "2", healthFactor18: "2",}
              },
            ]
          });
        }

        it("should return expected count", async () => {
          const ret = await loadFixture(findCandidatesForExistDebtsTest);
          expect(ret.count).eq(2);
        });
        it("should return needMore = true", async () => {
          const ret = await loadFixture(findCandidatesForExistDebtsTest);
          expect(ret.needMore).eq(true);
        });
        it("should return array of candidates with expected size", async () => {
          const ret = await loadFixture(findCandidatesForExistDebtsTest);
          expect(ret.dest.length).eq(2);
        });
        it("should return expected health factors", async () => {
          const ret = await loadFixture(findCandidatesForExistDebtsTest);
          expect([ret.dest[0].healthFactor, ret.dest[1].healthFactor].join()).eq([2, 2].join());
        });
        it("should return expected collateral amounts", async () => {
          const ret = await loadFixture(findCandidatesForExistDebtsTest);
          expect([ret.dest[0].collateralAmount, ret.dest[1].collateralAmount].join()).eq([100, 100].join());
        });
        it("should return expected borrow amounts", async () => {
          const ret = await loadFixture(findCandidatesForExistDebtsTest);
          expect([ret.dest[0].amountToBorrow, ret.dest[1].amountToBorrow].join()).eq([50, 45].join());
        });
      });
    });
  });

  describe("_findNewCandidates", () => {
    interface IPlatformParams {
      /** Params for the internal call of platformAdapter_.getConversionPlan */
      plan?: IConversionPlan;
    }

    interface IBorrowCandidate {
      collateralAmount: number;
      amountToBorrow: number;
      apr: number;
      healthFactor: number;
    }

    interface IFindNewCandidatesParams {
      /** AmountIn passed to _getPlanWithRebalancing */
      amountIn: string;
      targetHealthFactor?: string; // default 1
      platforms: IPlatformParams[];
      existDebtCandidatesIndices: number[];
    }
    interface IFindNewCandidatesResults {
      totalCount: number;
      dest: IBorrowCandidate[];
    }
    async function findNewCandidates(p: IFindNewCandidatesParams): Promise<IFindNewCandidatesResults> {
      const collateralAsset = usdc;
      const borrowAsset = usdt;
      const decimalsCollateral = await collateralAsset.decimals();
      const decimalsBorrow = await borrowAsset.decimals();

      const rewardsFactor = parseUnits("1", 18);
      const targetHealthFactor2 = parseUnits(p.targetHealthFactor ?? "1", 2);

      const amountIn = parseUnits(p.amountIn, decimalsCollateral);

      // set up platform adapters
      const platformAdapters: string[] = [];
      for (const pp of p.platforms) {
        if (pp === undefined) {
          platformAdapters.push(Misc.ZERO_ADDRESS);
        } else {
          const converter = ethers.Wallet.createRandom().address; // for simplicity there is only one converter per platform
          // set up platform adapter
          const platformAdapter = await MocksHelper.createLendingPlatformMock2(signer);
          platformAdapters.push(platformAdapter.address);

          await platformAdapter.setupConverters([converter]);

          if (pp.plan) {
            const finalAmountIn = parseUnits(pp.plan.expectedFinalAmountIn, decimalsCollateral);
            // set up _getPlanWithRebalancing
            const planOut = {
              // Platform adapter returns not-zero plan only if it receives valid input amount
              // Actual values of the plan are not important
              // We only check that this not zero plan is received, that's all
              converter,
              collateralAmount: parseUnits(pp.plan.collateralAmountOut || pp.plan.expectedFinalAmountIn, decimalsCollateral),
              amountToBorrow: parseUnits(pp.plan.borrowAmountOut, decimalsBorrow),

              maxAmountToBorrow: pp.plan.maxAmountToBorrowOut
                ? parseUnits(pp.plan.maxAmountToBorrowOut, decimalsBorrow)
                : Misc.MAX_UINT,
              maxAmountToSupply: pp.plan.maxAmountToSupplyOut
                ? parseUnits(pp.plan.maxAmountToSupplyOut, decimalsCollateral)
                : Misc.MAX_UINT,

              borrowCost36: parseUnits(pp.plan.borrowCost36 ?? "1", 36),
              amountCollateralInBorrowAsset36: parseUnits(pp.plan.amountCollateralInBorrowAsset36 ?? "1", 36),
              supplyIncomeInBorrowAsset36: parseUnits(pp.plan.supplyIncomeInBorrowAsset36 ?? "1", 36),

              liquidationThreshold18: 1,
              ltv18: 1,
              rewardsAmountInBorrowAsset36: 1,
            }

            await platformAdapter.setupGetConversionPlan(
              {
                collateralAsset: collateralAsset.address,
                borrowAsset: borrowAsset.address,
                amountIn: finalAmountIn,
                entryData: "0x",
                countBlocks: 1
              },
              planOut
            );
          }
        }
      }

      const ret = await facade._findNewCandidates(
        platformAdapters.map(
          (x, index) => p.existDebtCandidatesIndices.includes(index)
            ? Misc.ZERO_ADDRESS
            : x
        ),
        p.existDebtCandidatesIndices.length,
        {
          collateralAsset: collateralAsset.address,
          borrowAsset: borrowAsset.address,
          amountIn,
          entryData: "0x",
          countBlocks: 1
        },
        {
          controller: Misc.ZERO_ADDRESS,
          rewardsFactor,
          targetHealthFactor2,
          thresholds: [AppConstants.THRESHOLD_REBALANCE_TOO_HEALTHY, AppConstants.THRESHOLD_REBALANCE_UNHEALTHY],
        },
        [
          ...p.existDebtCandidatesIndices.map(
            x => ({
              converter: ethers.Wallet.createRandom().address,
              collateralAmount: BigNumber.from(1),
              amountToBorrow: BigNumber.from(1),
              apr18: BigNumber.from(0),
              healthFactor18: parseUnits("1", 18),
            })
          ),
          ...[...Array(platformAdapters.length - p.existDebtCandidatesIndices.length).keys()].map(
            x => ({
              converter: Misc.ZERO_ADDRESS,
              collateralAmount: BigNumber.from(0),
              amountToBorrow: BigNumber.from(0),
              apr18: BigNumber.from(0),
              healthFactor18: BigNumber.from(0),
            })
          )
        ]
      );

      return {
        totalCount: ret.totalCount.toNumber(),
        dest: ret.dest.slice(0, ret.totalCount.toNumber()).map(x => ({
            collateralAmount: +formatUnits(x.collateralAmount, decimalsCollateral),
            amountToBorrow: +formatUnits(x.amountToBorrow, decimalsBorrow),
            apr: +formatUnits(x.apr18, 18),
            healthFactor: +formatUnits(x.healthFactor18, 18),
          })
        )
      }
    }

    describe("health factor is healthy, no collateral addon is required", () => {
      describe("Two exist debts, three new candidates", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function findConverterTest(): Promise<IFindNewCandidatesResults> {
          return findNewCandidates({
            amountIn: "100",
            targetHealthFactor: "2",
            platforms: [
              {
                plan: {
                  expectedFinalAmountIn: "100", borrowAmountOut: "71",
                  borrowCost36: "14", amountCollateralInBorrowAsset36: "4", supplyIncomeInBorrowAsset36: "10" // apr = (14 - 10) / 4 = 1
                },
              }, {
                plan: {
                  expectedFinalAmountIn: "100", borrowAmountOut: "72", maxAmountToBorrowOut: "50",
                  borrowCost36: "14", amountCollateralInBorrowAsset36: "2", supplyIncomeInBorrowAsset36: "10" // apr = (14 - 10) / 2 = 2
                },
              }, {
                plan: {
                  expectedFinalAmountIn: "100", borrowAmountOut: "76",
                  borrowCost36: "14", amountCollateralInBorrowAsset36: "2", supplyIncomeInBorrowAsset36: "2" // apr = (14 - 2) / 2 = 6
                },
              }, {
                plan: {
                  expectedFinalAmountIn: "100", borrowAmountOut: "75", maxAmountToSupplyOut: "100",
                  borrowCost36: "14", amountCollateralInBorrowAsset36: "2", supplyIncomeInBorrowAsset36: "4" // apr = (14 - 4) / 2 = 5
                },
              }, {
                plan: {
                  expectedFinalAmountIn: "100", borrowAmountOut: "70",
                  borrowCost36: "14", amountCollateralInBorrowAsset36: "1", supplyIncomeInBorrowAsset36: "14" // apr = (14 - 14) / 1 = 0
                },
              },
            ],
            existDebtCandidatesIndices: [1, 3]
          });
        }

        it("should return expected total count", async () => {
          const ret = await loadFixture(findConverterTest);
          expect(ret.totalCount).eq(5);
        });
        it("should return expected collateral amounts", async () => {
          const ret = await loadFixture(findConverterTest);
          expect(ret.dest.map(x => x.collateralAmount).join()).eq([0.000001, 0.000001, 100, 100, 100].join());
        });
        it("should return expected borrow amounts", async () => {
          const ret = await loadFixture(findConverterTest);
          expect(ret.dest.map(x => x.amountToBorrow).join()).eq([0.000001, 0.000001, 71, 76, 70].join());
        });
        it("should return expected aprs", async () => {
          const ret = await loadFixture(findConverterTest);
          expect(ret.dest.map(x => x.apr).join()).eq([0, 0, 1, 6, 0].join());
        });
        it("should return zero health factors for new candidates", async () => {
          const ret = await loadFixture(findConverterTest);
          expect(ret.dest.map(x => x.healthFactor).join()).eq([1, 1, 0, 0, 0].join());
        });
      });
      describe("Single exist debts, single new candidate", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function findConverterTest(): Promise<IFindNewCandidatesResults> {
          return findNewCandidates({
            amountIn: "100",
            targetHealthFactor: "2",
            platforms: [
              {}, // no conversion is possible
              {
                plan: {
                  expectedFinalAmountIn: "100", borrowAmountOut: "72", maxAmountToBorrowOut: "72",
                  borrowCost36: "14", amountCollateralInBorrowAsset36: "2", supplyIncomeInBorrowAsset36: "10" // apr = (14 - 10) / 2 = 2
                },
              },
              {}, // no conversion is possible
              {
                plan: {
                  expectedFinalAmountIn: "100", borrowAmountOut: "75", maxAmountToSupplyOut: "75",
                  borrowCost36: "14", amountCollateralInBorrowAsset36: "2", supplyIncomeInBorrowAsset36: "4" // apr = (14 - 4) / 2 = 5
                },
              },
              {}, // no conversion is possible
            ],
            existDebtCandidatesIndices: [3]
          });
        }

        it("should return expected total count", async () => {
          const ret = await loadFixture(findConverterTest);
          expect(ret.totalCount).eq(2);
        });
        it("should return expected collateral amounts", async () => {
          const ret = await loadFixture(findConverterTest);
          expect(ret.dest.map(x => x.collateralAmount).join()).eq([0.000001, 100].join());
        });
        it("should return expected borrow amounts", async () => {
          const ret = await loadFixture(findConverterTest);
          expect(ret.dest.map(x => x.amountToBorrow).join()).eq([0.000001, 72].join());
        });
        it("should return expected aprs", async () => {
          const ret = await loadFixture(findConverterTest);
          expect(ret.dest.map(x => x.apr).join()).eq([0, 2].join());
        });
        it("should return zero health factors for new candidates", async () => {
          const ret = await loadFixture(findConverterTest);
          expect(ret.dest.map(x => x.healthFactor).join()).eq([1, 0].join());
        });
      });
      describe("No exist debts, no new candidates", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function findConverterTest(): Promise<IFindNewCandidatesResults> {
          return findNewCandidates({
            amountIn: "100",
            targetHealthFactor: "2",
            platforms: [{}, {}, {}, {}, {}],
            existDebtCandidatesIndices: []
          });
        }

        it("should return expected total count", async () => {
          const ret = await loadFixture(findConverterTest);
          expect(ret.totalCount).eq(0);
        });
      });
    });

  });

  describe("findConverter", () => {
    interface IPlatformParams {
      /** Params for the internal call of platformAdapter_.getConversionPlan */
      plan: IConversionPlan;

      poolAdapterStatus?: {
        collateralAmount: string;
        amountToPay: string;
        healthFactor18: string;
      }
    }
    interface IFindConverterParams {
      /** AmountIn passed to _getPlanWithRebalancing */
      amountIn: string;
      targetHealthFactor?: string; // default 1
      platforms: IPlatformParams[];
      zeroRebalanceThresholds: boolean;
    }
    interface IFindConverterResults {
      indexPlatformAdapters: number[];
      collateralAmounts: number[];
      borrowAmounts: number[];
      aprs: number[];
    }

    async function findConverter(p: IFindConverterParams): Promise<IFindConverterResults> {
      const collateralAsset = usdc;
      const borrowAsset = usdt;
      const decimalsCollateral = await collateralAsset.decimals();
      const decimalsBorrow = await borrowAsset.decimals();

      const rewardsFactor = parseUnits("1", 18);
      const targetHealthFactor2 = parseUnits(p.targetHealthFactor ?? "1", 2);

      const amountIn = parseUnits(p.amountIn, decimalsCollateral);

      // set up controller and borrow manager
      const controller = await MocksHelper.createConverterControllerMock(signer);
      await controller.setupMinHealthFactor2(1);

      const borrowManager = await MocksHelper.createBorrowManagerMock(signer);
      await controller.setupBorrowManager(borrowManager.address);

      // set up platform adapters
      const mapConverter2index = new Map<string, number>();
      const platformAdapters: LendingPlatformMock2[] = [];
      for (const pp of p.platforms) {
        const converter = ethers.Wallet.createRandom().address; // for simplicity there is only one converter per platform
        // set up platform adapter
        const platformAdapter = await MocksHelper.createLendingPlatformMock2(signer);
        platformAdapters.push(platformAdapter);
        mapConverter2index.set(converter.toLowerCase(), platformAdapters.length - 1);
        console.log("converter", converter);

        await platformAdapter.setupConverters([converter]);

        const finalAmountIn = parseUnits(pp.plan.expectedFinalAmountIn, decimalsCollateral);

        // set up _getPlanWithRebalancing
        const planOut = {
          // Platform adapter returns not-zero plan only if it receives valid input amount
          // Actual values of the plan are not important
          // We only check that this not zero plan is received, that's all
          converter,
          collateralAmount: parseUnits(pp.plan.collateralAmountOut || pp.plan.expectedFinalAmountIn, decimalsCollateral),
          amountToBorrow: parseUnits(pp.plan.borrowAmountOut, decimalsBorrow),

          maxAmountToBorrow: pp.plan.maxAmountToBorrowOut
            ? parseUnits(pp.plan.maxAmountToBorrowOut, decimalsBorrow)
            : Misc.MAX_UINT,
          maxAmountToSupply: pp.plan.maxAmountToSupplyOut
            ? parseUnits(pp.plan.maxAmountToSupplyOut, decimalsCollateral)
            : Misc.MAX_UINT,

          borrowCost36: parseUnits(pp.plan.borrowCost36 ?? "1", 36),
          amountCollateralInBorrowAsset36: parseUnits(pp.plan.amountCollateralInBorrowAsset36 ?? "1", 36),
          supplyIncomeInBorrowAsset36: parseUnits(pp.plan.supplyIncomeInBorrowAsset36 ?? "1", 36),

          liquidationThreshold18: 1,
          ltv18: 1,
          rewardsAmountInBorrowAsset36: 1,
        }

        await platformAdapter.setupGetConversionPlan(
          {
            collateralAsset: collateralAsset.address,
            borrowAsset: borrowAsset.address,
            amountIn: finalAmountIn,
            entryData: "0x",
            countBlocks: 1
          },
          planOut
        );

        // set up pool adapter (exist debt)
        if (pp.poolAdapterStatus) {
          const poolAdapter = await MocksHelper.createPoolAdapterMock2(signer);

          // set up pool adapter
          await poolAdapter.setStatus(
            parseUnits(pp.poolAdapterStatus.collateralAmount, decimalsCollateral),
            parseUnits(pp.poolAdapterStatus.amountToPay, decimalsBorrow),
            parseUnits(pp.poolAdapterStatus.healthFactor18, 18),
            true,
            0,
            true
          );

          await borrowManager.setupGetPoolAdapter(
            converter,
            facade.address,
            collateralAsset.address,
            borrowAsset.address,
            poolAdapter.address
          );
        }
      }

      // set up EnumerableSet.AddressSet
      await facade.addPlatformAdapter(platformAdapters.map(x => x.address));

      const ret = await facade._findConverter(
        {
          collateralAsset: collateralAsset.address,
          borrowAsset: borrowAsset.address,
          amountIn,
          entryData: "0x",
          countBlocks: 1
        },
        {
          controller: controller.address,
          rewardsFactor,
          targetHealthFactor2,
          thresholds: p.zeroRebalanceThresholds
            ? [0, 0]
            : [AppConstants.THRESHOLD_REBALANCE_TOO_HEALTHY, AppConstants.THRESHOLD_REBALANCE_UNHEALTHY],
        },
        facade.address,
      );
      console.log("ret", ret);

      return {
        indexPlatformAdapters: ret.convertersOut.map(x => mapConverter2index.get(x.toLowerCase()) ?? -1),
        collateralAmounts: ret.collateralAmountsOut.map(x => +formatUnits(x, decimalsCollateral)),
        borrowAmounts: ret.amountsToBorrowOut.map(x => +formatUnits(x, decimalsBorrow)),
        aprs: ret.aprs18Out.map(x => +formatUnits(x, 18))
      }
    }

    describe("health factor is healthy, no collateral addon is required", () => {
      describe("Two exist debts, full borrow is possible", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function findConverterTest(): Promise<IFindConverterResults> {
          return findConverter({
            amountIn: "100",
            targetHealthFactor: "2",
            // for simplicity of calculations, we reset both thresholds
            // and so expectedFinalAmountIn is always equal to amountIn
            zeroRebalanceThresholds: true,
            platforms: [
              {plan: {expectedFinalAmountIn: "100", borrowAmountOut: "70",},}, // no exist debt
              {
                plan: {
                  expectedFinalAmountIn: "100",
                  borrowAmountOut: "50",

                  // amounts required to calculate apr = (14 - 10) / 2 = 2
                  borrowCost36: "14",
                  amountCollateralInBorrowAsset36: "2",
                  supplyIncomeInBorrowAsset36: "10"
                },
                poolAdapterStatus: {collateralAmount: "2", amountToPay: "1", healthFactor18: "3.0",}
              },
              {plan: {expectedFinalAmountIn: "100", borrowAmountOut: "70",},}, // no exist debt
              {
                plan: {
                  expectedFinalAmountIn: "100",
                  borrowAmountOut: "45",

                  // amounts required to calculate apr = (14 - 4) / 2 = 5
                  borrowCost36: "14",
                  amountCollateralInBorrowAsset36: "2",
                  supplyIncomeInBorrowAsset36: "4"
                },
                poolAdapterStatus: {collateralAmount: "4", amountToPay: "2", healthFactor18: "1.5",}
              },
              {plan: {expectedFinalAmountIn: "100", borrowAmountOut: "70",},}, // no exist debt
            ]
          });
        }

        it("should return arrays with expected lengths", async () => {
          const ret = await loadFixture(findConverterTest);
          expect(ret.indexPlatformAdapters.length).eq(2);
          expect(ret.collateralAmounts.length).eq(2);
          expect(ret.borrowAmounts.length).eq(2);
          expect(ret.aprs.length).eq(2);
        });
        it("should return expected converters", async () => {
          const ret = await loadFixture(findConverterTest);
          expect([ret.indexPlatformAdapters[0], ret.indexPlatformAdapters[1]].join()).eq([3, 1].join());
        });
        it("should return expected collateral amounts", async () => {
          const ret = await loadFixture(findConverterTest);
          expect([ret.collateralAmounts[0], ret.collateralAmounts[1]].join()).eq([100, 100].join());
        });
        it("should return expected borrow amounts", async () => {
          const ret = await loadFixture(findConverterTest);
          expect([ret.borrowAmounts[0], ret.borrowAmounts[1]].join()).eq([45, 50].join());
        });
        it("should return expected aprs", async () => {
          const ret = await loadFixture(findConverterTest);
          expect([ret.aprs[0], ret.aprs[1]].join()).eq([5, 2].join());
        });
      });
      describe("Two exist debts, full borrow is not possible", () => {
        let snapshot: string;
        before(async function () {
          snapshot = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshot);
        });

        async function findConverterTest(): Promise<IFindConverterResults> {
          return findConverter({
            amountIn: "100",
            targetHealthFactor: "2",
            // for simplicity of calculations, we reset both thresholds
            // and so expectedFinalAmountIn is always equal to amountIn
            zeroRebalanceThresholds: true,
            platforms: [
              {plan: {
                  expectedFinalAmountIn: "100", borrowAmountOut: "71",
                  borrowCost36: "14", amountCollateralInBorrowAsset36: "4", supplyIncomeInBorrowAsset36: "10" // apr = (14 - 10) / 4 = 1
              },},
              {plan: {
                  expectedFinalAmountIn: "100", borrowAmountOut: "72", maxAmountToSupplyOut: "100",
                  borrowCost36: "14", amountCollateralInBorrowAsset36: "2", supplyIncomeInBorrowAsset36: "10" // apr = (14 - 10) / 2 = 2
                },
               poolAdapterStatus: {collateralAmount: "2", amountToPay: "1", healthFactor18: "3.0",}
              },
              {plan: {
                  expectedFinalAmountIn: "100", borrowAmountOut: "76",
                  borrowCost36: "14", amountCollateralInBorrowAsset36: "2", supplyIncomeInBorrowAsset36: "2" // apr = (14 - 2) / 2 = 6
              }, },
              {plan: {
                  expectedFinalAmountIn: "100", borrowAmountOut: "75", maxAmountToSupplyOut: "100",
                  borrowCost36: "14", amountCollateralInBorrowAsset36: "2", supplyIncomeInBorrowAsset36: "4" // apr = (14 - 4) / 2 = 5
                },
               poolAdapterStatus: {collateralAmount: "4", amountToPay: "2", healthFactor18: "1.5",}
              },
              {plan: {
                  expectedFinalAmountIn: "100", borrowAmountOut: "70",
                  borrowCost36: "14", amountCollateralInBorrowAsset36: "1", supplyIncomeInBorrowAsset36: "14" // apr = (14 - 14) / 1 = 0
              }, },
            ]
          });
        }

        it("should return expected converters", async () => {
          const ret = await loadFixture(findConverterTest);
          expect(ret.indexPlatformAdapters.join()).eq([3, 1, 4, 0, 2].join());
        });
        it("should return expected collateral amounts", async () => {
          const ret = await loadFixture(findConverterTest);
          expect(ret.collateralAmounts.join()).eq([100, 100, 100, 100, 100].join());
        });
        it("should return expected borrow amounts", async () => {
          const ret = await loadFixture(findConverterTest);
          expect(ret.borrowAmounts.join()).eq([75, 72, 70, 71, 76].join());
        });
        it("should return expected aprs", async () => {
          const ret = await loadFixture(findConverterTest);
          expect(ret.aprs.join()).eq([5, 2, 0, 1, 6].join());
        });
      });
    });
  });

//endregion Unit tests

});
