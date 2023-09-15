import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {BorrowManagerLogicLibFacade, MockERC20} from "../../typechain";
import {MocksHelper} from "../baseUT/helpers/MocksHelper";
import {Misc} from "../../scripts/utils/Misc";
import {AppConstants} from "../baseUT/AppConstants";
import {defaultAbiCoder, formatUnits, parseUnits} from "ethers/lib/utils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {expect} from "chai";
import {HARDHAT_NETWORK_ID, HardhatUtils} from "../../scripts/utils/HardhatUtils";

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
      apr18: string;
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
      const ret = await facade._prepareOutput(
        p.countDebts ?? 0,
        p.data.length,
        p.data.map(
          (d, index) => ({
            apr18: parseUnits(p.data[index].apr18, 18),
            converter: converters[index],
            collateralAmount: parseUnits(p.data[index].collateralAmount, decimalsCollateral),
            amountToBorrow: parseUnits(p.data[index].amountToBorrow, decimalsBorrow),
          })
        )
      );

      return {
        aprs: ret.aprs18.map(x => +formatUnits(x, 18)),
        collateralAmounts: ret.collateralAmounts.map(x => +formatUnits(x, decimalsCollateral)),
        borrowAmounts: ret.borrowAmounts.map(x => +formatUnits(x, decimalsBorrow)),
        convertersIndices: ret.converters.map(x => converters.findIndex(value => x === value))
      }
    }

    describe("Only new items", () => {
      async function prepareOutputTest() : Promise<IPrepareOutputResults> {
        return callPrepareOutput({
          data: [
            {apr18: "3", collateralAmount: "33", amountToBorrow: "333"},
            {apr18: "1", collateralAmount: "11", amountToBorrow: "111"},
            {apr18: "2", collateralAmount: "22", amountToBorrow: "222"},
          ]
        });
      }

      it("should return expected converters", async() => {
        const ret = await loadFixture(prepareOutputTest);
        expect(ret.convertersIndices.join()).eq([1, 2, 0].join());
      });
      it("should return expected collateral amounts", async() => {
        const ret = await loadFixture(prepareOutputTest);
        expect(ret.collateralAmounts.join()).eq([11, 22, 33].join());
      });
      it("should return expected borrow amounts", async() => {
        const ret = await loadFixture(prepareOutputTest);
        expect(ret.borrowAmounts.join()).eq([111, 222, 333].join());
      });
      it("should return expected aprs", async() => {
        const ret = await loadFixture(prepareOutputTest);
        expect(ret.aprs.join()).eq([1, 2, 3].join());
      });
    });
    describe("Only exist debts", () => {
      async function prepareOutputTest() : Promise<IPrepareOutputResults> {
        return callPrepareOutput({
          countDebts: 3,
          data: [
            {apr18: "3", collateralAmount: "33", amountToBorrow: "333"},
            {apr18: "1", collateralAmount: "11", amountToBorrow: "111"},
            {apr18: "2", collateralAmount: "22", amountToBorrow: "222"},
          ]
        });
      }

      it("should return expected converters", async() => {
        const ret = await loadFixture(prepareOutputTest);
        expect(ret.convertersIndices.join()).eq([0, 1, 2].join());
      });
      it("should return expected collateral amounts", async() => {
        const ret = await loadFixture(prepareOutputTest);
        expect(ret.collateralAmounts.join()).eq([33, 11, 22].join());
      });
      it("should return expected borrow amounts", async() => {
        const ret = await loadFixture(prepareOutputTest);
        expect(ret.borrowAmounts.join()).eq([333, 111, 222].join());
      });
      it("should return expected aprs", async() => {
        const ret = await loadFixture(prepareOutputTest);
        expect(ret.aprs.join()).eq([3, 1, 2].join());
      });
    });
    describe("New and exit debts", () => {
      async function prepareOutputTest() : Promise<IPrepareOutputResults> {
        return callPrepareOutput({
          countDebts: 2,
          data: [
            {apr18: "4", collateralAmount: "44", amountToBorrow: "444"},
            {apr18: "1", collateralAmount: "11", amountToBorrow: "111"},
            {apr18: "3", collateralAmount: "33", amountToBorrow: "333"},
            {apr18: "2", collateralAmount: "22", amountToBorrow: "222"},
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

      const controller = await MocksHelper.createConverterControllerMock(signer);
      await controller.setupBorrowManager(borrowManager.address);
      await controller.setupMinHealthFactor2(parseUnits(p.minHealthFactor ?? "1", 2));

      const ret = await facade._getExistValidPoolAdapter(
        platformAdapters.map(x => x.address),
        p.index0,
        user,
        collateralAsset,
        borrowAsset,
        controller.address
      );

      return {
        indexPlatformAdapter: ret.indexPlatformAdapter.toNumber(),
        poolAdapterExpected: ret.poolAdapter === poolAdapter.address,
        healthFactor: +formatUnits(ret.healthFactor18, 18)
      }
    }

    describe("there are no exist debts", () => {
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
  });
//endregion Unit tests

});
