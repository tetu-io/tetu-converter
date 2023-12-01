import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  controlGasLimitsEx2,
  HardhatUtils,
  ZKEVM_NETWORK_ID
} from "../../../scripts/utils/HardhatUtils";
import {ConverterController, IZerovixComptroller, IZerovixPriceOracle, ZerovixPlatformAdapter, CompoundAprLibFacade, CompoundPlatformAdapterLibFacade, ZerovixPlatformAdapter__factory, IERC20Metadata__factory, BorrowManager__factory, IMToken__factory} from "../../../typechain";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {ethers} from "hardhat";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {AdaptersHelper} from "../../baseUT/app/AdaptersHelper";
import {Misc} from "../../../scripts/utils/Misc";
import {expect} from "chai";
import {TetuConverterApp} from "../../baseUT/app/TetuConverterApp";
import {ZerovixHelper} from "../../../scripts/integration/zerovix/ZerovixHelper";
import {IConversionPlanNum} from "../../baseUT/types/AppDataTypes";
import {
  IPlanSourceInfo, IZerovixPreparePlan, IZerovixPreparePlanBadPaths,
  ZerovixPlatformAdapterUtils
} from "../../baseUT/protocols/zerovix/ZerovixPlatformAdapterUtils";
import {defaultAbiCoder, formatUnits} from "ethers/lib/utils";
import {AppConstants} from "../../baseUT/types/AppConstants";
import {BigNumber} from "ethers";
import {GAS_LIMIT_MOONWELL_GET_CONVERSION_PLAN} from "../../baseUT/types/GasLimit";
import {generateAssetPairs} from "../../baseUT/utils/AssetPairUtils";
import {IPredictBrParams, IPredictBrResults, PredictBrUsesCase} from "../../baseUT/uses-cases/shared/PredictBrUsesCase";
import {ZerovixPlatformActor} from "../../baseUT/protocols/zerovix/ZerovixPlatformActor";
import {ZkevmAddresses} from "../../../scripts/addresses/ZkevmAddresses";
import {ZerovixUtilsZkevm} from "../../baseUT/protocols/zerovix/ZerovixUtilsZkevm";
import {ZkevmUtils} from "../../baseUT/chains/zkevm/ZkevmUtils";

describe("ZerovixPlatformAdapterTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let signer: SignerWithAddress;

  let converterController: ConverterController;
  let comptroller: IZerovixComptroller;
  let priceOracle: IZerovixPriceOracle;
  let platformAdapter: ZerovixPlatformAdapter;
  let facadeAprLib: CompoundAprLibFacade;
  let facadePlatformLib: CompoundPlatformAdapterLibFacade;
  let poolAdapterTemplate: string;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(ZKEVM_NETWORK_ID);
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    signer = signers[0];

    converterController  = await TetuConverterApp.createController(signer, {networkId: ZKEVM_NETWORK_ID,});
    comptroller = ZerovixHelper.getComptroller(signer, ZkevmAddresses.ZEROVIX_COMPTROLLER);
    priceOracle = await ZerovixHelper.getPriceOracle(signer, ZkevmAddresses.ZEROVIX_COMPTROLLER);
    facadeAprLib = await DeployUtils.deployContract(signer, "CompoundAprLibFacade") as CompoundAprLibFacade;
    facadePlatformLib = await DeployUtils.deployContract(signer, "CompoundPlatformAdapterLibFacade") as CompoundPlatformAdapterLibFacade;

    poolAdapterTemplate = (await AdaptersHelper.createZerovixPoolAdapter(signer)).address;
    platformAdapter = await DeployUtils.deployContract(
      signer,
      "ZerovixPlatformAdapter",
      converterController.address,
      comptroller.address,
      poolAdapterTemplate,
      ZerovixUtilsZkevm.getAllCTokens()
    ) as ZerovixPlatformAdapter;
  });

  after(async function () {
    await TimeUtils.rollback(snapshot);
  });

//endregion before, after

//region Unit tests

  describe("constructor and converters()", () => {
    interface IParams {
      cTokens?: string[]; // [cUsdc, cDai] by default

      zeroController?: boolean;
      zeroConverter?: boolean;
      zeroComptroller?: boolean;

      assetsToCheck?: string[]; // [usdc, dai] by default
    }
    interface IResults {
      templateAdapterNormalStub: string;

      controller: string;
      comptroller: string;
      converters: string[];
      checkedAssets: string[];
    }
    async function initializePlatformAdapter(p: IParams) : Promise<IResults> {
      const templateAdapterNormalStub = ethers.Wallet.createRandom();
      const cTokens = p.cTokens ?? [ZkevmAddresses.oUSDC, ZkevmAddresses.oUSDT];

      const platformAdapterLocal = await AdaptersHelper.createZerovixPlatformAdapter(
        signer,
        p?.zeroController ? Misc.ZERO_ADDRESS : converterController.address,
        p?.zeroComptroller ? Misc.ZERO_ADDRESS : ZkevmAddresses.ZEROVIX_COMPTROLLER,
        p?.zeroConverter ? Misc.ZERO_ADDRESS : templateAdapterNormalStub.address,
        cTokens,
      );

      return {
        templateAdapterNormalStub: templateAdapterNormalStub.address,
        controller: await platformAdapterLocal.controller(),
        comptroller: await platformAdapterLocal.comptroller(),
        converters: await platformAdapterLocal.converters(),
        checkedAssets: await Promise.all((p.assetsToCheck ?? [ZkevmAddresses.USDC, ZkevmAddresses.USDT]).map(
          async x =>  platformAdapterLocal.activeAssets(x)
        ))
      };
    }
    describe("Good paths", () => {
      describe("Normal case", () => {
        async function initializePlatformAdapterTest(): Promise<IResults> {
          return initializePlatformAdapter({
            cTokens: [ZkevmAddresses.oUSDC, ZkevmAddresses.oWETH, ZkevmAddresses.oUSDT],
            assetsToCheck: [ZkevmAddresses.USDC, ZkevmAddresses.WETH, ZkevmAddresses.oMatic, ZkevmAddresses.USDT]
          })
        }
        it("should return expected controller and comptroller", async () => {
          const r = await loadFixture(initializePlatformAdapterTest);
          expect(
            [r.controller, r.comptroller].join().toLowerCase()
          ).eq(
            [converterController.address, ZkevmAddresses.ZEROVIX_COMPTROLLER].join().toLowerCase()
          );
        });
        it("should return expected converters", async () => {
          const r = await loadFixture(initializePlatformAdapterTest);
          expect(r.converters.join()).eq([r.templateAdapterNormalStub].join());
        });
        it("should return expected active assets", async () => {
          const r = await loadFixture(initializePlatformAdapterTest);
          expect(
            r.checkedAssets.join().toLowerCase()
          ).eq(
            [ZkevmAddresses.oUSDC, ZkevmAddresses.oWETH, Misc.ZERO_ADDRESS, ZkevmAddresses.oUSDT].join().toLowerCase()
          );
        });
      });
    });
    describe("Bad paths", () => {
      it("should revert if aave-pool is zero", async () => {
        await expect(
          initializePlatformAdapter({zeroComptroller: true})
        ).revertedWith("TC-1 zero address");
      });
      it("should revert if controller is zero", async () => {
        await expect(
          initializePlatformAdapter({zeroController: true})
        ).revertedWith("TC-1 zero address");
      });
      it("should revert if template normal is zero", async () => {
        await expect(
          initializePlatformAdapter({zeroConverter: true})
        ).revertedWith("TC-1 zero address");
      });
    });
  });

  describe("getConversionPlan", () => {
    interface IResults {
      plan: IConversionPlanNum;
      planSourceInfo: IPlanSourceInfo;
      expectedPlan: IConversionPlanNum;
      gasUsed: BigNumber;
    }
    async function getConversionPlan(p: IZerovixPreparePlan): Promise<IResults> {
      const pa = p.platformAdapter
        ? ZerovixPlatformAdapter__factory.connect(p.platformAdapter, signer)
        : platformAdapter;

      const {
        plan,
        sourceInfo,
        gasUsed
      } = await ZerovixPlatformAdapterUtils.getConversionPlan(signer, comptroller, priceOracle, p, pa, poolAdapterTemplate);

      const expectedPlan = await ZerovixPlatformAdapterUtils.getExpectedPlan(
        p,
        plan,
        sourceInfo,
        facadeAprLib,
        facadePlatformLib,
      )

      return {plan, planSourceInfo: sourceInfo, expectedPlan, gasUsed};
    }

    describe("Good paths", () => {
      describe("Normal case", () => {
        interface IBorrowParams {
          collateral: string;
          borrow: string;
          amount: string;
          countBlocks?: number;
          healthFactor?: string;
          entryKind?: number // 0 by default
        }

        const BORROWS: IBorrowParams[] = [
          {collateral: ZkevmAddresses.USDT, borrow: ZkevmAddresses.USDC, amount: "1000"},
          {collateral: ZkevmAddresses.USDC, borrow: ZkevmAddresses.USDT, amount: "10000"},
          {collateral: ZkevmAddresses.USDC, borrow: ZkevmAddresses.WETH, amount: "5000"},
          {collateral: ZkevmAddresses.WETH, borrow: ZkevmAddresses.USDT, amount: "1"},
          {collateral: ZkevmAddresses.USDT, borrow: ZkevmAddresses.USDC, amount: "1", entryKind: 1},
          {collateral: ZkevmAddresses.USDT, borrow: ZkevmAddresses.USDC, amount: "1", entryKind: 2},
        ];
        BORROWS.forEach(function (b: IBorrowParams) {
          const testName = `${ZkevmUtils.getAssetName(b.collateral)} - ${ZkevmUtils.getAssetName(b.borrow)}, ${b.entryKind ?? 0}`;
          describe(testName, () => {
            let snapshotLocal: string;
            before(async function () {
              snapshotLocal = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshotLocal);
            });

            async function getConversionPlanTest(): Promise<IResults> {
              return getConversionPlan({
                collateralAsset: b.collateral,
                borrowAsset: b.borrow,
                amountIn: b.amount,
                countBlocks: b.countBlocks,
                healthFactor: b.healthFactor,
                entryKind: b.entryKind ?? AppConstants.ENTRY_KIND_0,
                entryData: b.entryKind === undefined || b.entryKind === AppConstants.ENTRY_KIND_0
                  ? "0x"
                  : b.entryKind === AppConstants.ENTRY_KIND_1
                    ? defaultAbiCoder.encode(["uint256", "uint256", "uint256"], [AppConstants.ENTRY_KIND_1, 1, 1])
                    : defaultAbiCoder.encode(["uint256"], [AppConstants.ENTRY_KIND_2])
              });
            }

            it("should return expected converter", async () => {
              const {plan, expectedPlan} = await loadFixture(getConversionPlanTest);
              expect(plan.converter).eq(expectedPlan.converter);
            });
            it("should return expected amountToBorrow", async () => {
              const {plan, expectedPlan} = await loadFixture(getConversionPlanTest);
              // Expected: 1.2669373689511658, Actual: 1.266937368951165
              expect(plan.amountToBorrow).approximately(expectedPlan.amountToBorrow, 1e-10);
            });
            it("should return expected collateralAmount", async () => {
              const {plan, expectedPlan} = await loadFixture(getConversionPlanTest);
              expect(plan.collateralAmount).eq(expectedPlan.collateralAmount);
            });
            it("should return expected maxAmountToBorrow", async () => {
              const {plan, expectedPlan} = await loadFixture(getConversionPlanTest);
              expect(plan.maxAmountToBorrow).eq(expectedPlan.maxAmountToBorrow);
            });
            it("should return expected maxAmountToSupply", async () => {
              const {plan, expectedPlan} = await loadFixture(getConversionPlanTest);
              expect(plan.maxAmountToSupply).eq(expectedPlan.maxAmountToSupply);
            });
            it("should return expected ltv", async () => {
              const {plan, expectedPlan} = await loadFixture(getConversionPlanTest);
              expect(plan.ltv).eq(expectedPlan.ltv);
            });
            it("should return expected liquidationThreshold", async () => {
              const {plan, expectedPlan} = await loadFixture(getConversionPlanTest);
              expect(plan.liquidationThreshold).eq(expectedPlan.liquidationThreshold);
            });
            it("should return expected borrowCost", async () => {
              const {plan, expectedPlan} = await loadFixture(getConversionPlanTest);
              expect(plan.borrowCost).approximately(expectedPlan.borrowCost, 1e-12);
            });
            it("should return expected supplyIncomeInBorrowAsset", async () => {
              const {plan, expectedPlan} = await loadFixture(getConversionPlanTest);
              expect(plan.supplyIncomeInBorrowAsset).approximately(expectedPlan.supplyIncomeInBorrowAsset, 1e-7);
            });
            it("should return expected rewardsAmountInBorrowAsset", async () => {
              const {plan, expectedPlan} = await loadFixture(getConversionPlanTest);
              expect(plan.rewardsAmountInBorrowAsset).eq(expectedPlan.rewardsAmountInBorrowAsset);
            });
            it("should return expected amountCollateralInBorrowAsset", async () => {
              const {plan, expectedPlan} = await loadFixture(getConversionPlanTest);
              expect(plan.amountCollateralInBorrowAsset).approximately(expectedPlan.amountCollateralInBorrowAsset, 1e-10);
            });
          });
        });
      });

      describe("Try to use huge collateral amount", () => {
        let snapshotLocal: string;
        before(async function () {
          snapshotLocal = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshotLocal);
        });

        it("should return borrow amount equal to max available amount", async () => {
          const r = await getConversionPlan({
            collateralAsset: ZkevmAddresses.USDC,
            borrowAsset: ZkevmAddresses.USDT,
            amountIn: "10000000000000000000000000",
          });
          expect(r.plan.amountToBorrow).eq(r.expectedPlan.maxAmountToBorrow);
        });
      });

      describe("Borrow capacity", () => {
        let snapshotLocal: string;
        beforeEach(async function () {
          snapshotLocal = await TimeUtils.snapshot();
        });
        afterEach(async function () {
          await TimeUtils.rollback(snapshotLocal);
        });

        /**  totalBorrows    <    borrowCap       <       totalBorrows + available cash */
        it("maxAmountToBorrow is equal to borrowCap - totalBorrows", async () => {
          const r = await getConversionPlan({
            collateralAsset: ZkevmAddresses.USDC,
            borrowAsset: ZkevmAddresses.USDT,
            amountIn: "10000000000000000000000000",
            setMinBorrowCapacityDelta: "7"
          });
          expect(r.plan.maxAmountToBorrow).eq(7);
        });

        /** totalBorrows    <     totalBorrows + available cash    <     borrowCap */
        it("maxAmountToBorrow is equal to available cash if borrowCap is huge", async () => {
          const r = await getConversionPlan({
            collateralAsset: ZkevmAddresses.USDC,
            borrowAsset: ZkevmAddresses.USDT,
            amountIn: "1",
            setMinBorrowCapacityDelta: "7000000000000000000000000000000"
          });
          const availableCash = +formatUnits(r.planSourceInfo.borrowAssetData.cash, r.planSourceInfo.borrowAssetDecimals);
          expect(r.plan.maxAmountToBorrow === availableCash).eq(true);
        });

        /** borrowCap   <     totalBorrows    <   totalBorrows + available cash */
        it("maxAmountToBorrow is zero if borrow capacity is exceeded", async () => {
          const r = await getConversionPlan({
            collateralAsset: ZkevmAddresses.USDC,
            borrowAsset: ZkevmAddresses.USDT,
            amountIn: "1",
            setBorrowCapacityExceeded: true
          });
          expect(r.plan.maxAmountToBorrow).eq(0);
        });
      });

      describe("Frozen", () => {
        let snapshotLocal: string;
        before(async function () {
          snapshotLocal = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshotLocal);
        });

        it("should return no plan", async () => {
          const r = await getConversionPlan({
            collateralAsset: ZkevmAddresses.USDC,
            borrowAsset: ZkevmAddresses.USDT,
            amountIn: "1",
            frozen: true
          });
          expect(r.plan.converter).eq(Misc.ZERO_ADDRESS);
        });
      });

      describe("EntryKinds", () => {
        describe("Use ENTRY_KIND_EXACT_COLLATERAL_IN_FOR_MAX_BORROW_OUT_0", () => {
          let snapshotLocal: string;
          before(async function () {
            snapshotLocal = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLocal);
          });

          it("should return not zero borrow amount", async () => {
            const r = await getConversionPlan({
              collateralAsset: ZkevmAddresses.USDC,
              borrowAsset: ZkevmAddresses.USDT,
              amountIn: "6338.199834",
              entryData: defaultAbiCoder.encode(["uint256"], [AppConstants.ENTRY_KIND_0])
            });

            expect(r.plan.amountToBorrow).gt(0);
          });
        });
        describe("Use ENTRY_KIND_EXACT_PROPORTION_1", () => {
          let snapshotLocal: string;
          before(async function () {
            snapshotLocal = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLocal);
          });

          it("should split source amount on the parts with almost same cost", async () => {
            const collateralAmount = 1000;
            const r = await getConversionPlan({
              collateralAsset: ZkevmAddresses.USDC,
              borrowAsset: ZkevmAddresses.USDT,
              amountIn: collateralAmount.toString(),
              entryKind: AppConstants.ENTRY_KIND_1,
              entryData: defaultAbiCoder.encode(
                ["uint256", "uint256", "uint256"],
                [AppConstants.ENTRY_KIND_1, 1, 1]
              )
            });

            const collateralLeftInUSD = (collateralAmount - r.plan.collateralAmount) * r.planSourceInfo.priceCollateral;
            const borrowedAmountInUSD = r.plan.amountToBorrow * r.planSourceInfo.priceBorrow;

            // Expected :285.7142856
            // Actual   :285.714286
            expect(collateralLeftInUSD).approximately(borrowedAmountInUSD, 1e-5);
            expect(r.plan.collateralAmount < collateralAmount).eq(true);
          });
        });
        describe("Use ENTRY_KIND_EXACT_BORROW_OUT_FOR_MIN_COLLATERAL_IN_2", () => {
          let snapshotLocal: string;
          before(async function () {
            snapshotLocal = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLocal);
          });

          it("should return expected collateral amount", async () => {

            // let's calculate borrow amount by known collateral amount
            const collateralAmount = 10;
            const amountIn = (await getConversionPlan({
              collateralAsset: ZkevmAddresses.USDT,
              borrowAsset: ZkevmAddresses.USDC,
              amountIn: collateralAmount.toString(),
            })).plan.amountToBorrow;
            console.log("collateralAmount", collateralAmount);
            console.log("amountIn", amountIn);

            const r = await getConversionPlan({
              collateralAsset: ZkevmAddresses.USDT,
              borrowAsset: ZkevmAddresses.USDC,
              amountIn: amountIn.toString(),
              entryData: defaultAbiCoder.encode(["uint256"], [AppConstants.ENTRY_KIND_2]),
              entryKind: AppConstants.ENTRY_KIND_2,
            });

            expect(r.plan.collateralAmount).approximately(collateralAmount, 1e-5);
          });
        });
      });

      describe("Collateral and borrow amounts fit to limits", () => {
        /** maxAmountToSupply is always equal to type(uint).max */
        // describe.skip("Allowed collateral exceeds available collateral", () => {
        //   it("should return expected borrow and collateral amounts", async () => {
        //     // let's get max available supply amount
        //     const sample = await preparePlan(
        //       controller,
        //       MaticAddresses.DAI,
        //       parseUnits("1", 18),
        //       MaticAddresses.WMATIC,
        //       MaticAddresses.hDAI,
        //       MaticAddresses.hMATIC,
        //       undefined,
        //       defaultAbiCoder.encode(["uint256"], [AppConstants.ENTRY_KIND_0])
        //     );
        //
        //     // let's try to borrow amount using collateral that exceeds max supply amount
        //     const r = await preparePlan(
        //       controller,
        //       MaticAddresses.DAI,
        //       sample.plan.maxAmountToSupply.add(1000),
        //       MaticAddresses.WMATIC,
        //       MaticAddresses.hDAI,
        //       MaticAddresses.hMATIC,
        //       undefined,
        //       defaultAbiCoder.encode(["uint256"], [AppConstants.ENTRY_KIND_0])
        //     );
        //     console.log(r.plan);
        //
        //     const expectedCollateralAmount = AprUtils.getCollateralAmount(
        //       r.plan.amountToBorrow,
        //       r.healthFactor2,
        //       r.plan.liquidationThreshold18,
        //       r.priceCollateral,
        //       r.priceBorrow,
        //       r.collateralAssetDecimals,
        //       r.borrowAssetDecimals
        //     );
        //
        //     const ret = [
        //       r.plan.amountToBorrow,
        //       areAlmostEqual(r.plan.collateralAmount, expectedCollateralAmount)
        //     ].map(x => BalanceUtils.toString(x)).join("\n");
        //     const expected = [
        //       r.plan.maxAmountToBorrow,
        //       true
        //     ].map(x => BalanceUtils.toString(x)).join("\n");
        //
        //     expect(ret).eq(expected);
        //   });
        // });

        describe("Allowed borrow amounts exceeds available borrow amount", () => {
          let snapshotLocal: string;
          before(async function () {
            snapshotLocal = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLocal);
          });

          it("should return expected borrow and collateral amounts", async () => {
            // let's get max available borrow amount
            const sample = await getConversionPlan({
              collateralAsset: ZkevmAddresses.USDC,
              borrowAsset: ZkevmAddresses.USDT,
              amountIn: "1",
            });

            // let's try to borrow amount using collateral that exceeds max borrow amount
            const r = await getConversionPlan({
              collateralAsset: ZkevmAddresses.USDC,
              borrowAsset: ZkevmAddresses.USDT,
              amountIn: (sample.plan.maxAmountToBorrow + 1000).toString(),
              entryKind: AppConstants.ENTRY_KIND_2,
              entryData: defaultAbiCoder.encode(["uint256"], [AppConstants.ENTRY_KIND_2])
            });

            expect(r.plan.maxAmountToBorrow).eq(r.expectedPlan.maxAmountToBorrow);
            expect(r.plan.collateralAmount).approximately(r.expectedPlan.collateralAmount, 1e-3);
          });
        });
      });
    });
    describe("Bad paths", () => {
      let snapshotLocal: string;
      beforeEach(async function () {
        snapshotLocal = await TimeUtils.snapshot();
      });
      afterEach(async function () {
        await TimeUtils.rollback(snapshotLocal);
      });

      async function tryGetConversionPlan(
        badPathsParams: IZerovixPreparePlanBadPaths,
        collateralAsset: string = ZkevmAddresses.USDC,
        borrowAsset: string = ZkevmAddresses.USDT,
        collateralAmount: string = "1",
      ) : Promise<IConversionPlanNum> {
        const pa = badPathsParams.platformAdapter
          ? ZerovixPlatformAdapter__factory.connect(badPathsParams.platformAdapter, signer)
          : platformAdapter;

        const {plan} = await ZerovixPlatformAdapterUtils.getConversionPlan(
          signer,
          comptroller,
          priceOracle,
          {
            collateralAsset,
            borrowAsset,
            amountIn: collateralAmount,
            ...badPathsParams
          },
          pa,
          poolAdapterTemplate,
        );
        return plan;
      }

      describe("incorrect input params", () => {
        describe("collateral token is zero", () => {
          it("should revert", async () => {
            await expect(
              tryGetConversionPlan({ zeroCollateralAsset: true })
            ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
          });
        });
        describe("borrow token is zero", () => {
          it("should revert", async () => {
            await expect(
              tryGetConversionPlan({ zeroBorrowAsset: true })
            ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
          });
        });
        describe("healthFactor2_ is less than min allowed", () => {
          it("should revert", async () => {
            await expect(
              tryGetConversionPlan({ incorrectHealthFactor: "1" })
            ).revertedWith("TC-3 wrong health factor"); // WRONG_HEALTH_FACTOR
          });
        });
        describe("countBlocks_ is zero", () => {
          it("should revert", async () => {
            await expect(
              tryGetConversionPlan({ zeroCountBlocks: true })
            ).revertedWith("TC-29 incorrect value"); // INCORRECT_VALUE
          });
        });
        describe("collateralAmount_ is zero", () => {
          it("should revert", async () => {
            await expect(
              tryGetConversionPlan({ zeroCollateralAmount: true })
            ).revertedWith("TC-29 incorrect value"); // INCORRECT_VALUE
          });
        });
      });
      describe("cToken is not registered", () => {
        it("should fail if collateral token is not registered", async () => {
          const platformAdapterNoWeth = await DeployUtils.deployContract(
            signer,
            "ZerovixPlatformAdapter",
            converterController.address,
            comptroller.address,
            poolAdapterTemplate,
            [ZkevmAddresses.oUSDC, ZkevmAddresses.oUSDT]
          ) as ZerovixPlatformAdapter;

          expect((await tryGetConversionPlan(
            {
              cTokenCollateral: ZkevmAddresses.oWETH,
              platformAdapter: platformAdapterNoWeth.address
            },
            ZkevmAddresses.WETH
          )).converter).eq(Misc.ZERO_ADDRESS);
        });
        it("should fail if borrow token is not registered", async () => {
          const platformAdapterNoWeth = await DeployUtils.deployContract(
            signer,
            "ZerovixPlatformAdapter",
            converterController.address,
            comptroller.address,
            poolAdapterTemplate,
            [ZkevmAddresses.oUSDC, ZkevmAddresses.oUSDT]
          ) as ZerovixPlatformAdapter;

          expect((await tryGetConversionPlan(
            {
              cTokenBorrow: ZkevmAddresses.oWETH,
              platformAdapter: platformAdapterNoWeth.address
            },
            ZkevmAddresses.USDC,
            ZkevmAddresses.WETH,
          )).converter).eq(Misc.ZERO_ADDRESS);
        });
      });
      describe("capacity", () => {
        it("should return expected maxAmountToBorrow if borrowCapacity is limited", async () => {
          const planBorrowCapacityNotLimited = await tryGetConversionPlan(
            {},
            ZkevmAddresses.USDC,
            ZkevmAddresses.USDT,
            "1"
          );
          console.log("planBorrowCapacityNotLimited", planBorrowCapacityNotLimited);
          const plan = await tryGetConversionPlan(
            {setMinBorrowCapacity: true},
            ZkevmAddresses.USDC,
            ZkevmAddresses.USDT,
            "10000000000000000000000000000000"
          );
          expect(plan.amountToBorrow).eq(plan.maxAmountToBorrow);
          expect(plan.amountToBorrow).lt(planBorrowCapacityNotLimited.maxAmountToBorrow);
        });
      });
      describe("paused", () => {
        it("should fail if mintPaused is true for collateral", async () => {
          expect((await tryGetConversionPlan({setCollateralMintPaused: true})).converter).eq(Misc.ZERO_ADDRESS);
        });
        it("should fail if borrowPaused for borrow", async () => {
          expect((await tryGetConversionPlan({setBorrowPaused: true})).converter).eq(Misc.ZERO_ADDRESS);
        });
      });
    });
    describe("Check gas limit @skip-on-coverage", () => {
      it("should not exceed gas limits", async () => {
        const ret = await getConversionPlan({
          collateralAsset: ZkevmAddresses.USDT,
          borrowAsset: ZkevmAddresses.USDC,
          amountIn: "1"
        });

        controlGasLimitsEx2(ret.gasUsed, GAS_LIMIT_MOONWELL_GET_CONVERSION_PLAN, (u, t) => {
          expect(u).to.be.below(t);
        });
      });
    });
  });

  describe("registerCTokens", () => {
    let platformAdapterLocal: ZerovixPlatformAdapter;
    let snapshotLocal: string;
    before(async function () {
      snapshotLocal = await TimeUtils.snapshot();
      platformAdapterLocal = await DeployUtils.deployContract(
        signer,
        "ZerovixPlatformAdapter",
        converterController.address,
        comptroller.address,
        poolAdapterTemplate,
        [] // no mTokens are registered at first
      ) as ZerovixPlatformAdapter;
    });
    after(async function () {
      await TimeUtils.rollback(snapshotLocal);
    });
    describe("Good paths", () => {
      it("should return expected values", async () => {
        await platformAdapterLocal.registerCTokens([ZkevmAddresses.oUSDC, ZkevmAddresses.oUSDT]);

        expect([
          await platformAdapterLocal.activeAssets(ZkevmAddresses.WBTC),  // (!) not registered
          await platformAdapterLocal.activeAssets(ZkevmAddresses.USDC),
          await platformAdapterLocal.activeAssets(ZkevmAddresses.USDT),
        ].join().toLowerCase()).eq([
          Misc.ZERO_ADDRESS,
          ZkevmAddresses.oUSDC,
          ZkevmAddresses.oUSDT,
        ].join().toLowerCase());
      });
    });
    describe("Bad paths", () => {
      describe("Not governance", () => {
        it("should revert", async () => {
          await expect(
            platformAdapterLocal.connect(await Misc.impersonate(ethers.Wallet.createRandom().address)).registerCTokens([ZkevmAddresses.oUSDC])
          ).revertedWith("TC-9 governance only"); // GOVERNANCE_ONLY
        });
      });
      describe("Try to add not CToken", () => {
        it("should revert", async () => {
          await expect(
            platformAdapterLocal.registerCTokens(
              [ethers.Wallet.createRandom().address] // (!)
            )
          ).revertedWithoutReason();
        });
      });
    });
  });

  describe("getMarketsInfo", () => {
    let snapshotLocal: string;
    before(async function () {
      snapshotLocal = await TimeUtils.snapshot();
    });
    after(async function () {
      await TimeUtils.rollback(snapshotLocal);
    });

    describe("Good paths", () => {
      it("should return not zero ltv and liquidityThreshold", async () => {
        const r = await platformAdapter.getMarketsInfo(ZkevmAddresses.oWETH, ZkevmAddresses.oUSDC);
        expect(r.ltv18.eq(0) || r.liquidityThreshold18.eq(0)).eq(false);
      });
    });
    describe("Bad paths", () => {
      describe("Collateral token is unregistered in the protocol", () => {
        it("should return zero ltv and zero liquidityThreshold", async () => {
          const r = await platformAdapter.getMarketsInfo(ethers.Wallet.createRandom().address, ZkevmAddresses.oUSDC);
          expect(r.ltv18.eq(0) && r.liquidityThreshold18.eq(0)).eq(true);
        });
      });
      describe("Borrow token is unregistered in the protocol", () => {
        it("should return zero ltv and zero liquidityThreshold", async () => {
          const r = await platformAdapter.getMarketsInfo(ZkevmAddresses.oWETH, ethers.Wallet.createRandom().address);
          expect(r.ltv18.eq(0) && r.liquidityThreshold18.eq(0)).eq(true);
        });
      });
    });
  });

  describe("setFrozen", () => {
    let snapshotLocal: string;
    before(async function () {
      snapshotLocal = await TimeUtils.snapshot();
    });
    after(async function () {
      await TimeUtils.rollback(snapshotLocal);
    });

    it("should assign expected value to frozen", async () => {
      const before = await platformAdapter.frozen();
      await platformAdapter.setFrozen(true);
      const middle = await platformAdapter.frozen();
      await platformAdapter.setFrozen(false);
      const after = await platformAdapter.frozen();

      expect([before, middle, after].join()).eq([false, true, false].join());
    });
  });

  describe("platformKind", () => {
    it("should return expected values", async () => {
      expect((await platformAdapter.platformKind())).eq(AppConstants.LENDING_PLATFORM_KIND_ZEROVIX_7);
    });
  });

  describe("initializePoolAdapter", () => {
    let snapshotLocal: string;
    beforeEach(async function () {
      snapshotLocal = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshotLocal);
    });

    interface IParams {
      collateralAsset: string;
      borrowAsset: string;
    }

    interface IResults {
      expectedUser: string;

      converter: string;
      comptroller: string;
      user: string;
      collateralAsset: string;
      borrowAsset: string;
      collateralTokensBalance: number;
    }

    async function initializePoolAdapter(p: IParams): Promise<IResults> {
      const user = ethers.Wallet.createRandom().address;
      const converterGovernance = await Misc.impersonate(await converterController.governance());
      const borrowManagerAsGov = await BorrowManager__factory.connect(await converterController.borrowManager(), converterGovernance);
      const poolAdapter = await AdaptersHelper.createZerovixPoolAdapter(signer);

      const pairs = generateAssetPairs(ZerovixUtilsZkevm.getAllAssets());
      await borrowManagerAsGov.addAssetPairs(
        platformAdapter.address,
        pairs.map(x => x.smallerAddress),
        pairs.map(x => x.biggerAddress)
      );

      await platformAdapter.connect(await Misc.impersonate(borrowManagerAsGov.address)).initializePoolAdapter(
        poolAdapterTemplate,
        poolAdapter.address,
        user,
        p.collateralAsset,
        p.borrowAsset
      )

      const config = await poolAdapter.getConfig();
      return {
        borrowAsset: config.outBorrowAsset,
        collateralAsset: config.outCollateralAsset,
        user: config.outUser,
        converter: await poolAdapter.controller(),
        comptroller: await poolAdapter.comptroller(),
        collateralTokensBalance: +formatUnits(
          await poolAdapter.collateralTokensBalance(),
          await IERC20Metadata__factory.connect(p.collateralAsset, signer).decimals()
        ),

        expectedUser: user
      }
    }

    describe("Good paths", () => {
      it("initialized pool adapter should has expected values", async () => {
        const r = await initializePoolAdapter({
          collateralAsset: ZkevmAddresses.USDC,
          borrowAsset: ZkevmAddresses.USDT,
        });
        expect([
          r.user,
          r.comptroller,
          r.converter,
          r.collateralAsset,
          r.borrowAsset,
          r.collateralTokensBalance
        ].join().toLowerCase()).eq([
          r.expectedUser,
          ZkevmAddresses.ZEROVIX_COMPTROLLER,
          converterController.address,
          ZkevmAddresses.USDC,
          ZkevmAddresses.USDT,
          0
        ].join().toLowerCase());
      });
    });
  });

  describe("getBorrowRateAfterBorrow", () => {
    describe("Good paths", () => {
      async function makeTest(p: IPredictBrParams): Promise<IPredictBrResults> {
        const collateralToken = IMToken__factory.connect(ZerovixUtilsZkevm.getCToken(p.collateralAsset), signer);
        const borrowToken = IMToken__factory.connect(ZerovixUtilsZkevm.getCToken(p.borrowAsset), signer);
        const actor = new ZerovixPlatformActor(borrowToken, collateralToken, comptroller, signer);
        return PredictBrUsesCase.predictBrTest(signer, actor, p);
      }

      describe("small amount", () => {
        it("Predicted borrow rate should be same to real rate after the borrow", async () => {
          const r = await makeTest({
            collateralAsset: ZkevmAddresses.USDT,
            borrowAsset: ZkevmAddresses.USDC,
            borrowPart10000: 1
          });

          expect(r.br).approximately(r.brPredicted, r.brPredicted.div(10000)); // 755719373 vs 755719325, 1831232354 vs 1831170886
        });
      });

      describe("Huge amount", () => {
        it("Predicted borrow rate should be same to real rate after the borrow", async () => {
          const r = await makeTest({
            collateralAsset: ZkevmAddresses.USDT,
            borrowAsset: ZkevmAddresses.USDC,
            borrowPart10000: 500
          });
          expect(r.br).approximately(r.brPredicted, r.brPredicted.div(10000)); // 789340079 vs 789340079
        });
      });
    });
  });
//endregion Unit tests
});