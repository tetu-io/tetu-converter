import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BASE_NETWORK_ID, controlGasLimitsEx2, HardhatUtils} from "../../../../scripts/utils/HardhatUtils";
import {
  ConverterController,
  IMoonwellComptroller,
  IMoonwellPriceOracle,
  MoonwellPlatformAdapter,
  CompoundAprLibFacade,
  CompoundPlatformAdapterLibFacade,
  MoonwellPlatformAdapter__factory
} from "../../../../typechain";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {DeployUtils} from "../../../../scripts/utils/DeployUtils";
import {ethers} from "hardhat";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {AdaptersHelper} from "../../../baseUT/app/AdaptersHelper";
import {Misc} from "../../../../scripts/utils/Misc";
import {expect} from "chai";
import {TetuConverterApp} from "../../../baseUT/app/TetuConverterApp";
import {MoonwellHelper} from "../../../../scripts/integration/moonwell/MoonwellHelper";
import {IConversionPlanNum} from "../../../baseUT/types/AppDataTypes";
import {
  IMoonwellPreparePlan,
  IMoonwellPreparePlanBadPaths,
  IPlanSourceInfo,
  MoonwellPlatformAdapterUtils
} from "../../../baseUT/protocols/moonwell/MoonwellPlatformAdapterUtils";
import {BaseAddresses} from "../../../../scripts/addresses/BaseAddresses";
import {MoonwellUtils} from "../../../baseUT/protocols/moonwell/MoonwellUtils";
import {defaultAbiCoder, formatUnits} from "ethers/lib/utils";
import {AppConstants} from "../../../baseUT/types/AppConstants";
import {BigNumber} from "ethers";
import {GAS_LIMIT_MOONWELL_GET_CONVERSION_PLAN} from "../../../baseUT/types/GasLimit";

describe("MoonwellPlatformAdapterTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let signer: SignerWithAddress;

  let converterController: ConverterController;
  let comptroller: IMoonwellComptroller;
  let priceOracle: IMoonwellPriceOracle;
  let platformAdapter: MoonwellPlatformAdapter;
  let facadeAprLib: CompoundAprLibFacade;
  let facadePlatformLib: CompoundPlatformAdapterLibFacade;
  let poolAdapterTemplate: string;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(BASE_NETWORK_ID);
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    signer = signers[0];

    converterController  = await TetuConverterApp.createController(signer,);
    comptroller = await MoonwellHelper.getComptroller(signer);
    priceOracle = await MoonwellHelper.getPriceOracle(signer);
    facadeAprLib = await DeployUtils.deployContract(signer, "CompoundAprLibFacade") as CompoundAprLibFacade;
    facadePlatformLib = await DeployUtils.deployContract(signer, "CompoundPlatformAdapterLibFacade") as CompoundPlatformAdapterLibFacade;

    poolAdapterTemplate = ethers.Wallet.createRandom().address; // todo
    platformAdapter = await DeployUtils.deployContract(
      signer,
      "MoonwellPlatformAdapter",
      converterController.address,
      comptroller.address,
      poolAdapterTemplate,
      MoonwellUtils.getAllCTokens()
    ) as MoonwellPlatformAdapter;
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
      const cTokens = p.cTokens ?? [BaseAddresses.MOONWELL_USDC, BaseAddresses.MOONWELL_DAI];

      const platformAdapter = await AdaptersHelper.createMoonwellPlatformAdapter(
        signer,
        p?.zeroController ? Misc.ZERO_ADDRESS : converterController.address,
        p?.zeroComptroller ? Misc.ZERO_ADDRESS : BaseAddresses.MOONWELL_COMPTROLLER,
        p?.zeroConverter ? Misc.ZERO_ADDRESS : templateAdapterNormalStub.address,
        cTokens,
      );

      return {
        templateAdapterNormalStub: templateAdapterNormalStub.address,
        controller: await platformAdapter.controller(),
        comptroller: await platformAdapter.comptroller(),
        converters: await platformAdapter.converters(),
        checkedAssets: await Promise.all((p.assetsToCheck ?? [BaseAddresses.USDC, BaseAddresses.DAI]).map(
          async x =>  platformAdapter.activeAssets(x)
        ))
      };
    }
    describe("Good paths", () => {
      describe("Normal case", () => {
        async function initializePlatformAdapterTest(): Promise<IResults> {
          return initializePlatformAdapter({
            cTokens: [BaseAddresses.MOONWELL_USDC, BaseAddresses.MOONWELL_WETH, BaseAddresses.MOONWELL_DAI],
            assetsToCheck: [BaseAddresses.USDC, BaseAddresses.WETH, BaseAddresses.cbETH, BaseAddresses.DAI]
          })
        }
        it("should return expected controller and comptroller", async () => {
          const r = await loadFixture(initializePlatformAdapterTest);
          expect(
            [r.controller, r.comptroller].join().toLowerCase()
          ).eq(
            [converterController.address, BaseAddresses.MOONWELL_COMPTROLLER].join().toLowerCase()
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
            [BaseAddresses.MOONWELL_USDC, BaseAddresses.MOONWELL_WETH, Misc.ZERO_ADDRESS, BaseAddresses.MOONWELL_DAI].join().toLowerCase()
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
    async function getConversionPlan(p: IMoonwellPreparePlan): Promise<IResults> {
      const pa = p.platformAdapter
        ? MoonwellPlatformAdapter__factory.connect(p.platformAdapter, signer)
        : platformAdapter;

      const {
        plan,
        sourceInfo,
        gasUsed
      } = await MoonwellPlatformAdapterUtils.getConversionPlan(signer, comptroller, priceOracle, p, pa, poolAdapterTemplate);

      const expectedPlan = await MoonwellPlatformAdapterUtils.getExpectedPlan(
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
          {collateral: BaseAddresses.DAI, borrow: BaseAddresses.USDC, amount: "1000"},
          {collateral: BaseAddresses.USDC, borrow: BaseAddresses.DAI, amount: "10000"},
          {collateral: BaseAddresses.USDC, borrow: BaseAddresses.WETH, amount: "5000"},
          {collateral: BaseAddresses.WETH, borrow: BaseAddresses.DAI, amount: "1"},
          {collateral: BaseAddresses.WETH, borrow: BaseAddresses.DAI, amount: "1", entryKind: 1},
          {collateral: BaseAddresses.WETH, borrow: BaseAddresses.DAI, amount: "1", entryKind: 2},
        ];
        BORROWS.forEach(function (b: IBorrowParams) {
          const testName = `${MoonwellUtils.getAssetName(b.collateral)} - ${MoonwellUtils.getAssetName(b.borrow)}, ${b.entryKind ?? 0}`;
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
              expect(plan.supplyIncomeInBorrowAsset).eq(expectedPlan.supplyIncomeInBorrowAsset);
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
            collateralAsset: BaseAddresses.USDDbC,
            borrowAsset: BaseAddresses.DAI,
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
            collateralAsset: BaseAddresses.USDDbC,
            borrowAsset: BaseAddresses.DAI,
            amountIn: "10000000000000000000000000",
            setMinBorrowCapacityDelta: "7"
          });
          expect(r.plan.maxAmountToBorrow).eq(7);
        });

        /** totalBorrows    <     totalBorrows + available cash    <     borrowCap */
        it("maxAmountToBorrow is equal to available cash if borrowCap is huge", async () => {
          const r = await getConversionPlan({
            collateralAsset: BaseAddresses.USDDbC,
            borrowAsset: BaseAddresses.DAI,
            amountIn: "1",
            setMinBorrowCapacityDelta: "7000000000000000000000000000000"
          });
          const availableCash = +formatUnits(r.planSourceInfo.borrowAssetData.cash, r.planSourceInfo.borrowAssetDecimals);
          expect(r.plan.maxAmountToBorrow === availableCash).eq(true);
        });

        /** borrowCap   <     totalBorrows    <   totalBorrows + available cash */
        it("maxAmountToBorrow is zero if borrow capacity is exceeded", async () => {
          const r = await getConversionPlan({
            collateralAsset: BaseAddresses.USDDbC,
            borrowAsset: BaseAddresses.DAI,
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
            collateralAsset: BaseAddresses.USDDbC,
            borrowAsset: BaseAddresses.DAI,
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
              collateralAsset: BaseAddresses.USDDbC,
              borrowAsset: BaseAddresses.DAI,
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
              collateralAsset: BaseAddresses.USDDbC,
              borrowAsset: BaseAddresses.DAI,
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
              collateralAsset: BaseAddresses.DAI,
              borrowAsset: BaseAddresses.USDDbC,
              amountIn: collateralAmount.toString(),
            })).plan.amountToBorrow;
            console.log("collateralAmount", collateralAmount);
            console.log("amountIn", amountIn);

            const r = await getConversionPlan({
              collateralAsset: BaseAddresses.DAI,
              borrowAsset: BaseAddresses.USDDbC,
              amountIn: amountIn.toString(),
              entryData: defaultAbiCoder.encode(["uint256"], [AppConstants.ENTRY_KIND_2]),
              entryKind: AppConstants.ENTRY_KIND_2,
            });

            expect(r.plan.collateralAmount).eq(collateralAmount);
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
              collateralAsset: BaseAddresses.USDDbC,
              borrowAsset: BaseAddresses.DAI,
              amountIn: "1",
            });

            // let's try to borrow amount using collateral that exceeds max borrow amount
            const r = await getConversionPlan({
              collateralAsset: BaseAddresses.USDDbC,
              borrowAsset: BaseAddresses.DAI,
              amountIn: (sample.plan.maxAmountToBorrow + 1000).toString(),
              entryKind: AppConstants.ENTRY_KIND_2,
              entryData: defaultAbiCoder.encode(["uint256"], [AppConstants.ENTRY_KIND_2])
            });

            expect(r.plan.maxAmountToBorrow).eq(r.expectedPlan.maxAmountToBorrow);
            expect(r.plan.collateralAmount).eq(r.expectedPlan.collateralAmount);
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
        badPathsParams: IMoonwellPreparePlanBadPaths,
        collateralAsset: string = BaseAddresses.USDDbC,
        borrowAsset: string = BaseAddresses.DAI,
        collateralAmount: string = "1",
      ) : Promise<IConversionPlanNum> {
        const pa = badPathsParams.platformAdapter
          ? MoonwellPlatformAdapter__factory.connect(badPathsParams.platformAdapter, signer)
          : platformAdapter;

        const {plan} = await MoonwellPlatformAdapterUtils.getConversionPlan(
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
            "MoonwellPlatformAdapter",
            converterController.address,
            comptroller.address,
            poolAdapterTemplate,
            [BaseAddresses.MOONWELL_USDBC, BaseAddresses.MOONWELL_DAI]
          ) as MoonwellPlatformAdapter;

          expect((await tryGetConversionPlan(
            {
              cTokenCollateral: BaseAddresses.MOONWELL_WETH,
              platformAdapter: platformAdapterNoWeth.address
            },
            BaseAddresses.WETH
          )).converter).eq(Misc.ZERO_ADDRESS);
        });
        it("should fail if borrow token is not registered", async () => {
          const platformAdapterNoWeth = await DeployUtils.deployContract(
            signer,
            "MoonwellPlatformAdapter",
            converterController.address,
            comptroller.address,
            poolAdapterTemplate,
            [BaseAddresses.MOONWELL_USDBC, BaseAddresses.MOONWELL_DAI]
          ) as MoonwellPlatformAdapter;

          expect((await tryGetConversionPlan(
            {
              cTokenBorrow: BaseAddresses.MOONWELL_WETH,
              platformAdapter: platformAdapterNoWeth.address
            },
            BaseAddresses.USDDbC,
            BaseAddresses.WETH,
          )).converter).eq(Misc.ZERO_ADDRESS);
        });
      });
      describe("capacity", () => {
        it("should return expected maxAmountToBorrow if borrowCapacity is limited", async () => {
          const planBorrowCapacityNotLimited = await tryGetConversionPlan(
            {},
            BaseAddresses.USDDbC,
            BaseAddresses.DAI,
            "1"
          );
          console.log("planBorrowCapacityNotLimited", planBorrowCapacityNotLimited);
          const plan = await tryGetConversionPlan(
            {setMinBorrowCapacity: true},
            BaseAddresses.USDDbC,
            BaseAddresses.DAI,
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
          collateralAsset: BaseAddresses.DAI,
          borrowAsset: BaseAddresses.USDDbC,
          amountIn: "1"
        });

        controlGasLimitsEx2(ret.gasUsed, GAS_LIMIT_MOONWELL_GET_CONVERSION_PLAN, (u, t) => {
          expect(u).to.be.below(t);
        });
      });
    });
  });

  // describe("getBorrowRateAfterBorrow", () => {
  //   describe("Good paths", () => {
  //     async function makeTest(
  //       collateralAsset: string,
  //       collateralCToken: string,
  //       borrowAsset: string,
  //       borrowCToken: string,
  //       collateralHolders: string[],
  //       part10000: number
  //     ) : Promise<{br: BigNumber, brPredicted: BigNumber}> {
  //       const borrowToken = IHfCToken__factory.connect(borrowCToken, deployer);
  //       const collateralToken = IHfCToken__factory.connect(collateralCToken, deployer);
  //       const comptroller = await HundredFinanceHelper.getComptroller(deployer);
  //
  //       return PredictBrUsesCase.makeTest(
  //         deployer,
  //         new HfPlatformActor(borrowToken, collateralToken, comptroller),
  //         "hundred-finance",
  //         collateralAsset,
  //         borrowAsset,
  //         collateralHolders,
  //         part10000
  //       );
  //     }
  //
  //     describe("small amount", () => {
  //       it("Predicted borrow rate should be same to real rate after the borrow", async () => {
  //         const collateralAsset = MaticAddresses.DAI;
  //         const collateralCToken = MaticAddresses.hDAI;
  //         const borrowAsset = MaticAddresses.USDC;
  //         const borrowCToken = MaticAddresses.hUSDC;
  //
  //         const collateralHolders = [
  //           MaticAddresses.HOLDER_DAI,
  //           MaticAddresses.HOLDER_DAI_2,
  //           MaticAddresses.HOLDER_DAI_3,
  //           MaticAddresses.HOLDER_DAI_4,
  //           MaticAddresses.HOLDER_DAI_5,
  //           MaticAddresses.HOLDER_DAI_6,
  //         ];
  //         const part10000 = 1;
  //
  //         const r = await makeTest(
  //           collateralAsset,
  //           collateralCToken,
  //           borrowAsset,
  //           borrowCToken,
  //           collateralHolders,
  //           part10000
  //         );
  //
  //         const ret = areAlmostEqual(r.br, r.brPredicted, 3);
  //         expect(ret).eq(true);
  //       });
  //     });
  //
  //     describe("Huge amount", () => {
  //       it("Predicted borrow rate should be same to real rate after the borrow", async () => {
  //         const collateralAsset = MaticAddresses.DAI;
  //         const collateralCToken = MaticAddresses.hDAI;
  //         const borrowAsset = MaticAddresses.USDC;
  //         const borrowCToken = MaticAddresses.hUSDC;
  //
  //         const collateralHolders = [
  //           MaticAddresses.HOLDER_DAI,
  //           MaticAddresses.HOLDER_DAI_2,
  //           MaticAddresses.HOLDER_DAI_3,
  //           MaticAddresses.HOLDER_DAI_4,
  //           MaticAddresses.HOLDER_DAI_5,
  //           MaticAddresses.HOLDER_DAI_6,
  //         ];
  //         const part10000 = 500;
  //
  //         const r = await makeTest(
  //           collateralAsset,
  //           collateralCToken,
  //           borrowAsset,
  //           borrowCToken,
  //           collateralHolders,
  //           part10000
  //         );
  //
  //         const ret = areAlmostEqual(r.br, r.brPredicted, 3);
  //         expect(ret).eq(true);
  //       });
  //     });
  //   });
  // });

  // describe("initializePoolAdapter", () => {
  //   let controller: ConverterController;
  //   let snapshotLocal: string;
  //   before(async function () {
  //     snapshotLocal = await TimeUtils.snapshot();
  //     controller = await TetuConverterApp.createController(deployer,
  //       {tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
  //     );
  //   });
  //   after(async function () {
  //     await TimeUtils.rollback(snapshotLocal);
  //   });
  //   interface IInitializePoolAdapterBadPaths {
  //     useWrongConverter?: boolean;
  //     wrongCallerOfInitializePoolAdapter?: boolean;
  //   }
  //   async function makeInitializePoolAdapterTest(
  //     badParams?: IInitializePoolAdapterBadPaths
  //   ) : Promise<{ret: string, expected: string}> {
  //     const user = ethers.Wallet.createRandom().address;
  //     const collateralAsset = MaticAddresses.DAI;
  //     const borrowAsset = MaticAddresses.USDC;
  //     const borrowManager = BorrowManager__factory.connect(await controller.borrowManager(), deployer);
  //     const converterNormal = await AdaptersHelper.createHundredFinancePoolAdapter(deployer);
  //
  //     const comptroller = await HundredFinanceHelper.getComptroller(deployer);
  //     const platformAdapter = await AdaptersHelper.createHundredFinancePlatformAdapter(
  //       deployer,
  //       controller.address,
  //       comptroller.address,
  //       converterNormal.address,
  //       [MaticAddresses.hDAI, MaticAddresses.hUSDC]
  //     );
  //
  //     const poolAdapter = await AdaptersHelper.createHundredFinancePoolAdapter(deployer)
  //     const platformAdapterAsBorrowManager = HfPlatformAdapter__factory.connect(
  //       platformAdapter.address,
  //       badParams?.wrongCallerOfInitializePoolAdapter
  //         ? await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address)
  //         : await DeployerUtils.startImpersonate(borrowManager.address)
  //     );
  //
  //     await platformAdapterAsBorrowManager.initializePoolAdapter(
  //       badParams?.useWrongConverter
  //         ? ethers.Wallet.createRandom().address
  //         : converterNormal.address,
  //       poolAdapter.address,
  //       user,
  //       collateralAsset,
  //       borrowAsset
  //     );
  //
  //     const poolAdapterConfigAfter = await poolAdapter.getConfig();
  //     const ret = [
  //       poolAdapterConfigAfter.origin,
  //       poolAdapterConfigAfter.outUser,
  //       poolAdapterConfigAfter.outCollateralAsset.toLowerCase(),
  //       poolAdapterConfigAfter.outBorrowAsset.toLowerCase()
  //     ].join("\n");
  //     const expected = [
  //       converterNormal.address,
  //       user,
  //       collateralAsset.toLowerCase(),
  //       borrowAsset.toLowerCase()
  //     ].join("\n");
  //     return {ret, expected};
  //   }
  //
  //   describe("Good paths", () => {
  //     it("initialized pool adapter should has expected values", async () => {
  //       const r = await makeInitializePoolAdapterTest();
  //       expect(r.ret).eq(r.expected);
  //     });
  //   });
  //   describe("Bad paths", () => {
  //     it("should revert if converter address is not registered", async () => {
  //
  //       await expect(
  //         makeInitializePoolAdapterTest(
  //           {useWrongConverter: true}
  //         )
  //       ).revertedWith("TC-25 converter not found"); // CONVERTER_NOT_FOUND
  //     });
  //     it("should revert if it's called by not borrow-manager", async () => {
  //       await expect(
  //         makeInitializePoolAdapterTest(
  //           {wrongCallerOfInitializePoolAdapter: true}
  //         )
  //       ).revertedWith("TC-45 borrow manager only"); // BORROW_MANAGER_ONLY
  //     });
  //   });
  // });

  describe("registerCTokens", () => {
    let platformAdapterLocal: MoonwellPlatformAdapter;
    let snapshotLocal: string;
    before(async function () {
      snapshotLocal = await TimeUtils.snapshot();
      platformAdapterLocal = await DeployUtils.deployContract(
        signer,
        "MoonwellPlatformAdapter",
        converterController.address,
        comptroller.address,
        poolAdapterTemplate,
        [] // no mTokens are registered at first
      ) as MoonwellPlatformAdapter;
    });
    after(async function () {
      await TimeUtils.rollback(snapshotLocal);
    });
    describe("Good paths", () => {
      it("should return expected values", async () => {
        await platformAdapterLocal.registerCTokens([BaseAddresses.MOONWELL_USDBC, BaseAddresses.MOONWELL_DAI]);

        expect([
          await platformAdapterLocal.activeAssets(BaseAddresses.USDC),  // (!) not registered
          await platformAdapterLocal.activeAssets(BaseAddresses.USDDbC),
          await platformAdapterLocal.activeAssets(BaseAddresses.DAI),
        ].join().toLowerCase()).eq([
          Misc.ZERO_ADDRESS,
          BaseAddresses.MOONWELL_USDBC,
          BaseAddresses.MOONWELL_DAI,
        ].join().toLowerCase());
      });
    });
    describe("Bad paths", () => {
      describe("Not governance", () => {
        it("should revert", async () => {
          await expect(
            platformAdapterLocal.connect(await Misc.impersonate(ethers.Wallet.createRandom().address)).registerCTokens([BaseAddresses.MOONWELL_USDBC])
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
        const r = await platformAdapter.getMarketsInfo(BaseAddresses.MOONWELL_WETH, BaseAddresses.MOONWELL_USDBC);
        expect(r.ltv18.eq(0) || r.liquidityThreshold18.eq(0)).eq(false);
      });
    });
    describe("Bad paths", () => {
      describe("Collateral token is unregistered in the protocol", () => {
        it("should return zero ltv and zero liquidityThreshold", async () => {
          const r = await platformAdapter.getMarketsInfo(ethers.Wallet.createRandom().address, BaseAddresses.MOONWELL_USDBC);
          expect(r.ltv18.eq(0) && r.liquidityThreshold18.eq(0)).eq(true);
        });
      });
      describe("Borrow token is unregistered in the protocol", () => {
        it("should return zero ltv and zero liquidityThreshold", async () => {
          const r = await platformAdapter.getMarketsInfo(BaseAddresses.MOONWELL_WETH, ethers.Wallet.createRandom().address);
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
      expect((await platformAdapter.platformKind())).eq(AppConstants.LENDING_PLATFORM_KIND_MOONWELL_6);
    });
  });
//endregion Unit tests
});