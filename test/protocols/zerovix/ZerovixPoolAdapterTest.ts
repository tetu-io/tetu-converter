import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  BorrowManager,
  BorrowManager__factory,
  ConverterController,
  IERC20__factory, IERC20Metadata,
  IERC20Metadata__factory,
  IZerovixComptroller,
  IZerovixPriceOracle, ITetuLiquidator__factory,
  ZerovixPlatformAdapter,
  ZerovixPoolAdapter,
  ZerovixPoolAdapter__factory,
  TetuConverterReplacer
} from "../../../typechain";
import {HardhatUtils, ZKEVM_NETWORK_ID} from "../../../scripts/utils/HardhatUtils";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {TetuConverterApp} from "../../baseUT/app/TetuConverterApp";
import {ZerovixHelper} from "../../../scripts/integration/zerovix/ZerovixHelper";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {
  IZerovixPreparePlan,
  ZerovixPlatformAdapterUtils
} from "../../baseUT/protocols/zerovix/ZerovixPlatformAdapterUtils";
import {IConversionPlanNum} from "../../baseUT/types/AppDataTypes";
import {IPoolAdapterStatus, IPoolAdapterStatusNum} from "../../baseUT/types/BorrowRepayDataTypes";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {Misc} from "../../../scripts/utils/Misc";
import {BorrowRepayDataTypeUtils} from "../../baseUT/utils/BorrowRepayDataTypeUtils";
import {expect} from "chai";
import {generateAssetPairs} from "../../baseUT/utils/AssetPairUtils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {BigNumber} from "ethers";
import {AppConstants} from "../../baseUT/types/AppConstants";
import {ZkevmAddresses} from "../../../scripts/addresses/ZkevmAddresses";
import {ZerovixUtilsZkevm} from "../../baseUT/protocols/zerovix/ZerovixUtilsZkevm";
import {MocksHelper} from "../../baseUT/app/MocksHelper";
import {TokenUtils} from "../../../scripts/utils/TokenUtils";
import {ZkevmUtils} from "../../baseUT/chains/zkevm/ZkevmUtils";
import {ZerovixSetupUtils} from "../../baseUT/protocols/zerovix/ZerovixSetupUtils";

describe.skip("ZerovixPoolAdapterTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let signer: SignerWithAddress;

  let converterController: ConverterController;
  let comptroller: IZerovixComptroller;
  let priceOracle: IZerovixPriceOracle;
  let poolAdapter: ZerovixPoolAdapter;
  let platformAdapter: ZerovixPlatformAdapter;
  let tetuConverterReplacer: TetuConverterReplacer;
  let converterGovernance: SignerWithAddress;
  let borrowManagerAsGov: BorrowManager;
  let tetuLiquidator: string;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(ZKEVM_NETWORK_ID);
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    signer = signers[0];

    tetuLiquidator = (await MocksHelper.createTetuLiquidatorMock(signer, [], [])).address; // todo ZkevmAddresses.TETU_LIQUIDATOR

    tetuConverterReplacer = await DeployUtils.deployContract(signer, "TetuConverterReplacer") as TetuConverterReplacer;
    converterController = await TetuConverterApp.createController(
      signer, {
        networkId: ZKEVM_NETWORK_ID,
        tetuConverterFabric: {
          deploy: async () => tetuConverterReplacer.address,
        },
        tetuLiquidatorAddress: tetuLiquidator
      }
    );
    comptroller = ZerovixHelper.getComptroller(signer, ZkevmAddresses.ZEROVIX_COMPTROLLER);
    priceOracle = await ZerovixHelper.getPriceOracle(signer, ZkevmAddresses.ZEROVIX_COMPTROLLER);
    poolAdapter = await DeployUtils.deployContract(signer, "ZerovixPoolAdapter") as ZerovixPoolAdapter;
    platformAdapter = await DeployUtils.deployContract(
      signer,
      "ZerovixPlatformAdapter",
      converterController.address,
      comptroller.address,
      poolAdapter.address,
      ZerovixUtilsZkevm.getAllCTokens()
    ) as ZerovixPlatformAdapter;
    converterGovernance = await Misc.impersonate(await converterController.governance());
    borrowManagerAsGov = await BorrowManager__factory.connect(await converterController.borrowManager(), converterGovernance);

    // register the platform adapter in TetuConverter app
    const pairs = generateAssetPairs(ZerovixUtilsZkevm.getAllAssets());
    await borrowManagerAsGov.addAssetPairs(
      platformAdapter.address,
      pairs.map(x => x.smallerAddress),
      pairs.map(x => x.biggerAddress)
    );
  });

  after(async function () {
    await TimeUtils.rollback(snapshot);
  });

//endregion before, after

//region Utils
  async function getConversionPlan(p: IZerovixPreparePlan): Promise<IConversionPlanNum> {
    const {plan} = await ZerovixPlatformAdapterUtils.getConversionPlan(
      signer,
      comptroller,
      priceOracle,
      p,
      platformAdapter,
      poolAdapter.address
    );
    return plan;
  }

//endregion Utils

//region Unit tests
  describe("borrow by plan", () => {
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

      collateralAmount: string;

      collateralBalance?: string; // collateralAmount by default

      collateralAmountApproved?: string; // collateralAmount by default
      notTetuConverter?: boolean;
    }

    interface IResults {
      collateralBalance: number;
      borrowBalance: number;
      plan: IConversionPlanNum;
      status: IPoolAdapterStatusNum;
    }

    async function borrow(p: IParams): Promise<IResults> {
      const receiver = ethers.Wallet.createRandom().address;
      const tetuConverterSigner = p.notTetuConverter
        ? await Misc.impersonate(ethers.Wallet.createRandom().address)
        : await Misc.impersonate(tetuConverterReplacer.address);

      const collateralAsset = IERC20Metadata__factory.connect(p.collateralAsset, signer);
      const borrowAsset = IERC20Metadata__factory.connect(p.borrowAsset, signer);
      const decimalsCollateral = await collateralAsset.decimals();
      const decimalsBorrow = await borrowAsset.decimals();

      // prepare conversion plan
      const plan = await getConversionPlan({
        collateralAsset: p.collateralAsset,
        borrowAsset: p.borrowAsset,
        amountIn: p.collateralAmount,
      });

      // put collateral amount on TetuConverter balance
      const collateralAmount = parseUnits(p.collateralAmount, decimalsCollateral);
      const collateralAmountApproved = parseUnits(p.collateralAmountApproved || p.collateralAmount, decimalsCollateral);
      await TokenUtils.getToken(p.collateralAsset, tetuConverterSigner.address, collateralAmount);

      // initialize the pool adapter
      await borrowManagerAsGov.connect(tetuConverterSigner).registerPoolAdapter(poolAdapter.address, receiver, p.collateralAsset, p.borrowAsset);
      const poolAdapterInstance = ZerovixPoolAdapter__factory.connect(
        await borrowManagerAsGov.getPoolAdapter(poolAdapter.address, receiver, p.collateralAsset, p.borrowAsset),
        tetuConverterSigner
      );
      await IERC20__factory.connect(p.collateralAsset, tetuConverterSigner).approve(poolAdapterInstance.address, collateralAmountApproved);

      // make borrow
      await poolAdapterInstance.connect(tetuConverterSigner).borrow(
        collateralAmount,
        parseUnits(plan.amountToBorrow.toString(), decimalsBorrow),
        receiver
      );

      // get status
      const status = await poolAdapterInstance.getStatus();

      return {
        collateralBalance: +formatUnits(await collateralAsset.balanceOf(tetuConverterSigner.address), decimalsCollateral),
        borrowBalance: +formatUnits(await borrowAsset.balanceOf(receiver), decimalsBorrow),
        plan,
        status: BorrowRepayDataTypeUtils.getPoolAdapterStatusNum(status, decimalsCollateral, decimalsBorrow)
      }
    }

    describe("Good paths", () => {
      interface IBorrowParams {
        collateral: string;
        borrow: string;
        amount: string;
      }
      describe("Not-native token", () => {
        const BORROWS: IBorrowParams[] = [
          {collateral: ZkevmAddresses.USDT, borrow: ZkevmAddresses.USDC, amount: "2500"},
          {collateral: ZkevmAddresses.MATIC, borrow: ZkevmAddresses.USDC, amount: "1"},
          {collateral: ZkevmAddresses.USDC, borrow: ZkevmAddresses.MATIC, amount: "50000"},
          {collateral: ZkevmAddresses.USDC, borrow: ZkevmAddresses.USDT, amount: "1000"},
          {collateral: ZkevmAddresses.MATIC, borrow: ZkevmAddresses.USDT, amount: "0.01"},
        ];
        BORROWS.forEach(function (b: IBorrowParams) {
          const testName = `${ZkevmUtils.getAssetName(b.collateral)} - ${ZkevmUtils.getAssetName(b.borrow)}`;
          describe(testName, () => {
            it("should borrow expected amount", async () => {
              const ret = await borrow({
                collateralAsset: b.collateral,
                borrowAsset: b.borrow,
                collateralAmount: b.amount,
              });
              expect(ret.plan.amountToBorrow).eq(ret.borrowBalance);
            });
          });
        });
      });
      describe("Native token", () => {
        const BORROWS: IBorrowParams[] = [
          {collateral: ZkevmAddresses.WETH, borrow: ZkevmAddresses.USDC, amount: "1"},
          {collateral: ZkevmAddresses.USDC, borrow: ZkevmAddresses.WETH, amount: "1000"},
        ];
        BORROWS.forEach(function (b: IBorrowParams) {
          const testName = `${ZkevmUtils.getAssetName(b.collateral)} - ${ZkevmUtils.getAssetName(b.borrow)}`;
          describe(testName, () => {
            it("should borrow expected amount", async () => {
              const ret = await borrow({
                collateralAsset: b.collateral,
                borrowAsset: b.borrow,
                collateralAmount: b.amount,
              });
              expect(ret.plan.amountToBorrow).eq(ret.borrowBalance);
            });
          });
        });
      });
    });
    describe("Bad paths", () => {
      it("should revert if not TetuConverter", async () => {
        await expect(borrow({
          collateralAsset: ZkevmAddresses.MATIC,
          borrowAsset: ZkevmAddresses.USDC,
          collateralAmount: "1",
          notTetuConverter: true
        })).rejectedWith("TC-8 tetu converter only") // TETU_CONVERTER_ONLY
      });
    });
//endregion Unit tests
  });

  describe("repay by plan", () => {
    interface IParams {
      collateralAsset: string;
      borrowAsset: string;

      collateralAmount: string;
      repayPart?: number; // by default: 100_000 => full repay; It can be more 100_000
      closePosition?: boolean; // false by default

      collateralBalance?: string; // collateralAmount by default
      notTetuConverter?: boolean;

      countBlocksBetweenBorrowAndRepay?: number; // zero by default
    }

    interface IResults {
      collateralBalance: number;
      borrowBalance: number;
      plan: IConversionPlanNum;
      statusBeforeRepay: IPoolAdapterStatusNum;
      statusAfterBorrow: IPoolAdapterStatusNum;
      statusAfterRepay: IPoolAdapterStatusNum;
    }

    async function repay(p: IParams): Promise<IResults> {
      const receiver = ethers.Wallet.createRandom().address;
      const tetuConverterSigner = await Misc.impersonate(tetuConverterReplacer.address);

      const collateralAsset = IERC20Metadata__factory.connect(p.collateralAsset, signer);
      const borrowAsset = IERC20Metadata__factory.connect(p.borrowAsset, signer);
      const decimalsCollateral = await collateralAsset.decimals();
      const decimalsBorrow = await borrowAsset.decimals();

      // prepare conversion plan
      const plan = await getConversionPlan({
        collateralAsset: p.collateralAsset,
        borrowAsset: p.borrowAsset,
        amountIn: p.collateralAmount,
      });

      // put collateral amount on TetuConverter balance
      const collateralAmount = parseUnits(p.collateralAmount, decimalsCollateral);
      const collateralAmountApproved = parseUnits(p.collateralAmount, decimalsCollateral);
      await TokenUtils.getToken(p.collateralAsset, tetuConverterSigner.address, collateralAmount);

      // initialize the pool adapter
      await borrowManagerAsGov.connect(tetuConverterSigner).registerPoolAdapter(poolAdapter.address, receiver, p.collateralAsset, p.borrowAsset);
      const poolAdapterInstance = ZerovixPoolAdapter__factory.connect(
        await borrowManagerAsGov.getPoolAdapter(poolAdapter.address, receiver, p.collateralAsset, p.borrowAsset),
        tetuConverterSigner
      );
      await IERC20__factory.connect(p.collateralAsset, tetuConverterSigner).approve(poolAdapterInstance.address, collateralAmountApproved);

      // make borrow
      await poolAdapterInstance.connect(tetuConverterSigner).borrow(
        collateralAmount,
        parseUnits(plan.amountToBorrow.toString(), decimalsBorrow),
        receiver
      );

      // get status
      const statusAfterBorrow = await poolAdapterInstance.getStatus();

      // prepare to repay
      const amountToRepay = statusAfterBorrow.amountToPay.mul(p.repayPart ?? 100_000).div(100_000);
      await TokenUtils.getToken(p.borrowAsset, tetuConverterSigner.address, amountToRepay.mul(2));
      await IERC20__factory.connect(p.borrowAsset, tetuConverterSigner).approve(poolAdapterInstance.address, amountToRepay.mul(2));

      if (p.countBlocksBetweenBorrowAndRepay) {
        await TimeUtils.advanceNBlocks(p.countBlocksBetweenBorrowAndRepay);
      }

      // repay
      const statusBeforeRepay = await poolAdapterInstance.getStatus();
      if (p.notTetuConverter) {
          await poolAdapterInstance.connect(await Misc.impersonate(receiver)).repay(
              amountToRepay,
              receiver,
              p.closePosition ?? false
          );
      } else {
          await tetuConverterReplacer.repay(
              poolAdapterInstance.address,
              p.repayPart ?? 100_000,
              p.closePosition ?? false,
              receiver,
          );
      }
      const statusAfterRepay = await poolAdapterInstance.getStatus();

      return {
        collateralBalance: +formatUnits(await collateralAsset.balanceOf(receiver), decimalsCollateral),
        borrowBalance: +formatUnits(await borrowAsset.balanceOf(receiver), decimalsBorrow),
        plan,
        statusBeforeRepay: BorrowRepayDataTypeUtils.getPoolAdapterStatusNum(statusBeforeRepay, decimalsCollateral, decimalsBorrow),
        statusAfterBorrow: BorrowRepayDataTypeUtils.getPoolAdapterStatusNum(statusAfterBorrow, decimalsCollateral, decimalsBorrow),
        statusAfterRepay: BorrowRepayDataTypeUtils.getPoolAdapterStatusNum(statusAfterRepay, decimalsCollateral, decimalsBorrow),
      }
    }

    describe("Good paths", () => {
      interface IRepayParams {
        collateral: string;
        borrow: string;
        amount: string;
      }
      describe("Full repay", () => {
        describe("Not-native token", () => {
          let snapshotLocal: string;
          before(async function () {
            snapshotLocal = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLocal);
          });

          const BORROWS: IRepayParams[] = [
            {collateral: ZkevmAddresses.USDT, borrow: ZkevmAddresses.USDC, amount: "2500"},
            {collateral: ZkevmAddresses.MATIC, borrow: ZkevmAddresses.USDC, amount: "1"},
            {collateral: ZkevmAddresses.USDC, borrow: ZkevmAddresses.MATIC, amount: "50000"},
            {collateral: ZkevmAddresses.USDC, borrow: ZkevmAddresses.USDT, amount: "1000"},
            {collateral: ZkevmAddresses.MATIC, borrow: ZkevmAddresses.USDT, amount: "0.01"},
          ];
          BORROWS.forEach(function (b: IRepayParams) {
            const testName = `${ZkevmUtils.getAssetName(b.collateral)} - ${ZkevmUtils.getAssetName(b.borrow)}`;
            async function repayTest(): Promise<IResults>  {
              return repay({
                collateralAsset: b.collateral,
                borrowAsset: b.borrow,
                collateralAmount: b.amount,
              });
            }
            describe(testName, () => {
              it("should receive expected collateral", async () => {
                const ret = await loadFixture(repayTest);
                // 1e-8 is required for case DAI with amount "0.01"
                expect(ret.collateralBalance + 1e-8).gte(Number(b.amount));
              });
              it("should close the debt", async () => {
                const ret = await loadFixture(repayTest);
                expect([
                  ret.statusAfterRepay.opened, ret.statusAfterRepay.collateralAmount, ret.statusAfterRepay.amountToPay
                ].join()).eq([
                  false, 0, 0
                ].join());
              });
            });
          });
        });
        describe("Native token", () => {
          let snapshotLocal: string;
          before(async function () {
            snapshotLocal = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLocal);
          });

          const BORROWS: IRepayParams[] = [
            {collateral: ZkevmAddresses.WETH, borrow: ZkevmAddresses.USDC, amount: "1"},
            {collateral: ZkevmAddresses.USDC, borrow: ZkevmAddresses.WETH, amount: "1000"},
          ];
          BORROWS.forEach(function (b: IRepayParams) {
            const testName = `${ZkevmUtils.getAssetName(b.collateral)} - ${ZkevmUtils.getAssetName(b.borrow)}`;
            async function repayTest(): Promise<IResults>  {
              return repay({
                collateralAsset: b.collateral,
                borrowAsset: b.borrow,
                collateralAmount: b.amount,
              });
            }
            describe(testName, () => {
              it("should receive expected collateral", async () => {
                const ret = await loadFixture(repayTest);
                expect(ret.collateralBalance + 1e-6).gte(Number(b.amount));
              });
              it("should close the debt", async () => {
                const ret = await loadFixture(repayTest);
                expect([
                  ret.statusAfterRepay.opened, ret.statusAfterRepay.collateralAmount, ret.statusAfterRepay.amountToPay
                ].join()).eq([
                  false, 0, 0
                ].join());
              });
            });
          });
        });
      });
      describe("Partial repay", () => {
        let snapshotLocal: string;
        before(async function () {
          snapshotLocal = await TimeUtils.snapshot();
        });
        after(async function () {
          await TimeUtils.rollback(snapshotLocal);
        });

        async function repayTest(): Promise<IResults>  {
          return repay({
            collateralAsset: ZkevmAddresses.USDC,
            borrowAsset: ZkevmAddresses.USDT,
            collateralAmount: "100",
            repayPart: 20_000
          });
        }
        it("should receive expected collateral", async () => {
          const ret = await loadFixture(repayTest);
          expect(ret.collateralBalance + 1e-6).gte(20);
        });
        it("should keep the debt opened", async () => {
          const ret = await loadFixture(repayTest);
          expect(ret.statusAfterRepay.opened).eq(true);
        });
        it("should have amount to pay ~ 80%", async () => {
          const ret = await loadFixture(repayTest);
          expect(ret.statusAfterRepay.amountToPay).approximately(ret.statusBeforeRepay.amountToPay * 80 /100, 0.01);
        });
        it("should have amount of collateral ~ 80%", async () => {
          const ret = await loadFixture(repayTest);
          expect(ret.statusAfterRepay.collateralAmount).approximately(ret.statusBeforeRepay.collateralAmount * 80 /100, 0.01);
        });
        it("should not change health factor", async () => {
          const ret = await loadFixture(repayTest);
          expect(ret.statusAfterRepay.healthFactor).approximately(ret.statusBeforeRepay.healthFactor, 0.001);
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

      it("should revert if not TetuConverter", async () => {
        await expect(repay({
          collateralAsset: ZkevmAddresses.MATIC,
          borrowAsset: ZkevmAddresses.USDC,
          collateralAmount: "1",
          notTetuConverter: true
        })).rejectedWith("TC-8 tetu converter only") // TETU_CONVERTER_ONLY
      });

      it("should revert if try to repay too match", async () => {
        await expect(repay({
          collateralAsset: ZkevmAddresses.MATIC,
          borrowAsset: ZkevmAddresses.USDC,
          collateralAmount: "1",
          repayPart: 100_001
        })).rejectedWith("TC-15 wrong borrow balance") // WRONG_BORROWED_BALANCE
      });
    });
//endregion Unit tests
  });

  describe("repay to rebalance", () => {
    interface IPrepareParams {
      collateralAsset: string;
      borrowAsset: string;
      targetHealthFactorBeforeBorrow: string;
      targetHealthFactorBeforeRepay: string;
      collateralAmount: string;

      collateralBalance?: string; // collateralAmount by default

      countBlocksBetweenBorrowAndRepay?: number; // zero by default
    }

    interface IRepayPrams {
      repayPart: number; // It should be less 100_000
      isCollateral: boolean;
      notTetuConverter?: boolean;
    }

    interface IResults {
      plan: IConversionPlanNum;
      statusAfterBorrow: IPoolAdapterStatusNum;
      statusBeforeRepay: IPoolAdapterStatusNum;
      statusAfterRepay: IPoolAdapterStatusNum;
    }

    /** Intermediate results of prepare */
    interface IPrepareResults {
      receiver: string;
      tetuConverterSigner: SignerWithAddress;
      collateralAsset: IERC20Metadata;
      borrowAsset: IERC20Metadata;
      decimalsCollateral: number;
      decimalsBorrow: number;
      plan: IConversionPlanNum;
      collateralAmount: BigNumber;
      collateralAmountApproved: BigNumber;
      poolAdapterInstance: ZerovixPoolAdapter;
      statusAfterBorrow: IPoolAdapterStatus;
    }

    /** Make borrow, move time */
    async function prepare(p: IPrepareParams): Promise<IPrepareResults> {
      const receiver = ethers.Wallet.createRandom().address;
      const tetuConverterSigner = await Misc.impersonate(tetuConverterReplacer.address);

      const collateralAsset = IERC20Metadata__factory.connect(p.collateralAsset, signer);
      const borrowAsset = IERC20Metadata__factory.connect(p.borrowAsset, signer);
      const decimalsCollateral = await collateralAsset.decimals();
      const decimalsBorrow = await borrowAsset.decimals();

      // set up initial health factor
      await converterController.connect(converterGovernance).setTargetHealthFactor2(parseUnits(p.targetHealthFactorBeforeBorrow, 2));

      // prepare conversion plan
      const plan = await getConversionPlan({
        collateralAsset: p.collateralAsset,
        borrowAsset: p.borrowAsset,
        amountIn: p.collateralAmount,
      });

      // put collateral amount on TetuConverter balance
      const collateralAmount = parseUnits(p.collateralAmount, decimalsCollateral);
      const collateralAmountApproved = parseUnits(p.collateralAmount, decimalsCollateral);
      await TokenUtils.getToken(p.collateralAsset, tetuConverterSigner.address, collateralAmount);

      // initialize the pool adapter
      await borrowManagerAsGov.connect(tetuConverterSigner).registerPoolAdapter(poolAdapter.address, receiver, p.collateralAsset, p.borrowAsset);
      const poolAdapterInstance = ZerovixPoolAdapter__factory.connect(
        await borrowManagerAsGov.getPoolAdapter(poolAdapter.address, receiver, p.collateralAsset, p.borrowAsset),
        tetuConverterSigner
      );
      await IERC20__factory.connect(p.collateralAsset, tetuConverterSigner).approve(poolAdapterInstance.address, collateralAmountApproved);

      // make borrow
      await poolAdapterInstance.connect(tetuConverterSigner).borrow(
        collateralAmount,
        parseUnits(plan.amountToBorrow.toString(), decimalsBorrow),
        receiver
      );

      // get status
      const statusAfterBorrow = await poolAdapterInstance.getStatus();

      // move time
      if (p.countBlocksBetweenBorrowAndRepay) {
        await TimeUtils.advanceNBlocks(p.countBlocksBetweenBorrowAndRepay);
      }

      // set up new health factor
      await converterController.connect(converterGovernance).setTargetHealthFactor2(parseUnits(p.targetHealthFactorBeforeRepay, 2));

      return {
        receiver,
        borrowAsset,
        tetuConverterSigner,
        collateralAmountApproved,
        collateralAmount,
        decimalsBorrow,
        plan,
        collateralAsset,
        poolAdapterInstance,
        statusAfterBorrow,
        decimalsCollateral
      }
    }

    async function repayToRebalance(p: IRepayPrams, pr: IPrepareResults): Promise<IResults> {
      // prepare amount to repay (either collateral or borrow)
      const amountIn = p.isCollateral
        ? pr.statusAfterBorrow.collateralAmount.mul(p.repayPart ?? 100_000).div(100_000)
        : pr.statusAfterBorrow.amountToPay.mul(p.repayPart ?? 100_000).div(100_000);
      if (p.isCollateral) {
        await TokenUtils.getToken(pr.collateralAsset.address, pr.tetuConverterSigner.address, amountIn.mul(2));
        await IERC20__factory.connect(pr.collateralAsset.address, pr.tetuConverterSigner).approve(pr.poolAdapterInstance.address, amountIn.mul(2));
      } else {
        await TokenUtils.getToken(pr.borrowAsset.address, pr.tetuConverterSigner.address, amountIn.mul(2));
        await IERC20__factory.connect(pr.borrowAsset.address, pr.tetuConverterSigner).approve(pr.poolAdapterInstance.address, amountIn.mul(2));
      }

      // repay to rebalance
      const statusBeforeRepay = await pr.poolAdapterInstance.getStatus();
      const repaySigner = await Misc.impersonate(p.notTetuConverter ? pr.receiver : tetuConverterReplacer.address);
      await pr.poolAdapterInstance.connect(repaySigner).repayToRebalance(amountIn, p.isCollateral);
      const statusAfterRepay = await pr.poolAdapterInstance.getStatus();

      return {
        plan: pr.plan,
        statusAfterBorrow: BorrowRepayDataTypeUtils.getPoolAdapterStatusNum(pr.statusAfterBorrow, pr.decimalsCollateral, pr.decimalsBorrow),
        statusBeforeRepay: BorrowRepayDataTypeUtils.getPoolAdapterStatusNum(statusBeforeRepay, pr.decimalsCollateral, pr.decimalsBorrow),
        statusAfterRepay: BorrowRepayDataTypeUtils.getPoolAdapterStatusNum(statusAfterRepay, pr.decimalsCollateral, pr.decimalsBorrow),
      }
    }

    describe("Good paths", () => {
      interface IParamsForPrepare {
        collateral: string;
        borrow: string;
        amount: string;
      }
      interface IParamsForRepay {
        isCollateral: boolean;
        repayPart: number;
      }
      interface ITest {
        title: string;
        borrows: IParamsForPrepare[];
      }
      const TESTS: ITest[] = [
        {
          title: "Native token",
          borrows: [
            {collateral: ZkevmAddresses.WETH, borrow: ZkevmAddresses.USDC, amount: "100"},
            {collateral: ZkevmAddresses.USDC, borrow: ZkevmAddresses.WETH, amount: "100"},
          ]
        },
        {
          title: "Not native token",
          borrows: [
            {collateral: ZkevmAddresses.USDC, borrow: ZkevmAddresses.MATIC, amount: "50000"},
            {collateral: ZkevmAddresses.USDC, borrow: ZkevmAddresses.USDT, amount: "1000"},
            {collateral: ZkevmAddresses.MATIC, borrow: ZkevmAddresses.USDT, amount: "0.1"},
          ]
        },
      ];

      TESTS.forEach(function (test: ITest) {
        describe(test.title, () => {
          test.borrows.forEach(function (b: IParamsForPrepare) {
            const testName = `${ZkevmUtils.getAssetName(b.collateral)} - ${ZkevmUtils.getAssetName(b.borrow)}`;
            describe(testName, () => {
              let snapshotLocal: string;
              let pr: IPrepareResults;
              before(async function () {
                snapshotLocal = await TimeUtils.snapshot();
                pr = await prepare({
                  collateralAsset: b.collateral,
                  borrowAsset: b.borrow,
                  collateralAmount: b.amount,
                  targetHealthFactorBeforeRepay: "2",
                  targetHealthFactorBeforeBorrow: "3",
                });
              });
              after(async function () {
                await TimeUtils.rollback(snapshotLocal);
              });

              const PARAMS_FOR_REPAY: IParamsForRepay[] = [
                {isCollateral: false, repayPart: 1000},
                {isCollateral: false, repayPart: 99_900},
                {isCollateral: true, repayPart: 1000},
                {isCollateral: true, repayPart: 99_900},
              ]
              PARAMS_FOR_REPAY.forEach(function (paramsForRepay: IParamsForRepay) {
                describe(`pay ${paramsForRepay.repayPart / 100_000 * 100}% of ${paramsForRepay.isCollateral ? "collateral" : "borrow"} asset`, () => {
                  let snapshotLocal2: string;
                  before(async function () {
                    snapshotLocal2 = await TimeUtils.snapshot();
                  });
                  after(async function () {
                    await TimeUtils.rollback(snapshotLocal2);
                  });

                  async function repayTest(): Promise<IResults> {
                    return repayToRebalance({
                      isCollateral: paramsForRepay.isCollateral,
                      repayPart: paramsForRepay.repayPart
                    }, pr);
                  }

                  it("should increase health factor", async () => {
                    const ret = await loadFixture(repayTest);
                    // console.log("ret", ret);
                    expect(ret.statusAfterRepay.healthFactor).gt(ret.statusBeforeRepay.healthFactor);
                  });
                  if (paramsForRepay.isCollateral) {
                    it("should increase amount of collateral", async () => {
                      const ret = await loadFixture(repayTest);
                      expect(ret.statusAfterRepay.collateralAmount).approximately(ret.statusBeforeRepay.collateralAmount * (100_000 + paramsForRepay.repayPart) / 100_000, 1e-3);
                    });
                    it("should not change amount to repay", async () => {
                      const ret = await loadFixture(repayTest);
                      expect(ret.statusAfterRepay.amountToPay).approximately(ret.statusBeforeRepay.amountToPay, 1e-5);
                    });
                  } else {
                    it("should decrease debt amount", async () => {
                      const ret = await loadFixture(repayTest);
                      expect(ret.statusAfterRepay.amountToPay).approximately(ret.statusBeforeRepay.amountToPay * (100_000 - paramsForRepay.repayPart) / 100_000, 1e-2);
                    });
                    it("should not change amount of collateral", async () => {
                      const ret = await loadFixture(repayTest);
                      expect(ret.statusAfterRepay.collateralAmount).approximately(ret.statusBeforeRepay.collateralAmount, 1e-5);
                    });
                  }
                });
              });
            });
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

      it("should revert if not TetuConverter", async () => {
        const pr = await prepare({
          collateralAsset: ZkevmAddresses.USDC,
          borrowAsset: ZkevmAddresses.USDT,
          collateralAmount: "1000",
          targetHealthFactorBeforeRepay: "2",
          targetHealthFactorBeforeBorrow: "3",
        });
        await expect(
          repayToRebalance({isCollateral: true, repayPart: 1000, notTetuConverter: true}, pr)
        ).rejectedWith("TC-8 tetu converter only") // TETU_CONVERTER_ONLY
      });
    });
  });

  describe("getConversionKind", () => {
    it("should return BORROW_2", async () => {
      expect(await poolAdapter.getConversionKind()).eq(AppConstants.CONVERSION_KIND_BORROW_2);
    })
  });

  describe("getConfig", () => {
    let snapshotLocal: string;
    beforeEach(async function () {
      snapshotLocal = await TimeUtils.snapshot();
    });
    afterEach(async function () {
      await TimeUtils.rollback(snapshotLocal);
    });

    it("should return expected config", async () => {
      const receiver = ethers.Wallet.createRandom().address;
      const tetuConverterSigner = await Misc.impersonate(tetuConverterReplacer.address);

      await borrowManagerAsGov.connect(tetuConverterSigner).registerPoolAdapter(poolAdapter.address, receiver, ZkevmAddresses.MATIC, ZkevmAddresses.WETH);
      const poolAdapterInstance = ZerovixPoolAdapter__factory.connect(
        await borrowManagerAsGov.getPoolAdapter(poolAdapter.address, receiver, ZkevmAddresses.MATIC, ZkevmAddresses.WETH),
        tetuConverterSigner
      );
      const config = await poolAdapterInstance.getConfig();
      expect([
        config.origin,
        config.outUser,
        config.outCollateralAsset,
        config.outBorrowAsset
      ].join().toLowerCase()).eq([
        poolAdapter.address,
        receiver,
        ZkevmAddresses.MATIC,
        ZkevmAddresses.WETH
      ].join().toLowerCase());
    })
  });

  describe("getCollateralAmountToReturn", () => {
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
      collateralAmount: string;

      partToRepay: number;
      closePosition: boolean;
    }

    interface IResults {
      collateralAmountToReturn: number;
      status: IPoolAdapterStatusNum;
    }

    async function getCollateralAmountToReturn(p: IParams): Promise<IResults> {
      const receiver = ethers.Wallet.createRandom().address;
      const tetuConverterSigner = await Misc.impersonate(tetuConverterReplacer.address);

      const collateralAsset = IERC20Metadata__factory.connect(p.collateralAsset, signer);
      const borrowAsset = IERC20Metadata__factory.connect(p.borrowAsset, signer);
      const decimalsCollateral = await collateralAsset.decimals();
      const decimalsBorrow = await borrowAsset.decimals();

      // prepare conversion plan
      const plan = await getConversionPlan({
        collateralAsset: p.collateralAsset,
        borrowAsset: p.borrowAsset,
        amountIn: p.collateralAmount,
      });

      // put collateral amount on TetuConverter balance
      const collateralAmount = parseUnits(p.collateralAmount, decimalsCollateral);
      await TokenUtils.getToken(p.collateralAsset, tetuConverterSigner.address, collateralAmount);

      // initialize the pool adapter
      await borrowManagerAsGov.connect(tetuConverterSigner).registerPoolAdapter(poolAdapter.address, receiver, p.collateralAsset, p.borrowAsset);
      const poolAdapterInstance = ZerovixPoolAdapter__factory.connect(
        await borrowManagerAsGov.getPoolAdapter(poolAdapter.address, receiver, p.collateralAsset, p.borrowAsset),
        tetuConverterSigner
      );
      await IERC20__factory.connect(p.collateralAsset, tetuConverterSigner).approve(poolAdapterInstance.address, collateralAmount);

      // make borrow
      await poolAdapterInstance.connect(tetuConverterSigner).borrow(
        collateralAmount,
        parseUnits(plan.amountToBorrow.toString(), decimalsBorrow),
        receiver
      );

      // get status
      const status = await poolAdapterInstance.getStatus();

      const collateralAmountToReturn = await poolAdapterInstance.getCollateralAmountToReturn(
        status.amountToPay.mul(p.partToRepay).div(100_000),
        p.closePosition
      );

      return {
        collateralAmountToReturn: +formatUnits(collateralAmountToReturn, decimalsCollateral),
        status: BorrowRepayDataTypeUtils.getPoolAdapterStatusNum(status, decimalsCollateral, decimalsBorrow)
      }
    }

    describe("Good paths", () => {
      it("should return expected amount for full repay", async () => {
        const ret = await getCollateralAmountToReturn({
          collateralAsset: ZkevmAddresses.MATIC,
          borrowAsset: ZkevmAddresses.USDC,
          collateralAmount: "1234",
          closePosition: true,
          partToRepay: 100_000,
        });
        expect(ret.collateralAmountToReturn).approximately(1234, 1e-5);
      });
      it("should return expected amount for partial repay", async () => {
        const ret = await getCollateralAmountToReturn({
          collateralAsset: ZkevmAddresses.MATIC,
          borrowAsset: ZkevmAddresses.USDC,
          collateralAmount: "500",
          closePosition: false,
          partToRepay: 50_000,
        });
        expect(ret.collateralAmountToReturn).approximately(250, 1e-5);
      });
    });
//endregion Unit tests
  });

  describe("updateStatus", () => {
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
      collateralAmount: string;

      countBlocksBeforeUpdateStatus: number;
    }

    interface IResults {
      statusAfterBorrow: IPoolAdapterStatusNum;
      statusBeforeUpdateStatus: IPoolAdapterStatusNum;
      statusAfterUpdateStatus: IPoolAdapterStatusNum;
    }

    async function updateStatus(p: IParams): Promise<IResults> {
      const receiver = ethers.Wallet.createRandom().address;
      const tetuConverterSigner = await Misc.impersonate(tetuConverterReplacer.address);

      const collateralAsset = IERC20Metadata__factory.connect(p.collateralAsset, signer);
      const borrowAsset = IERC20Metadata__factory.connect(p.borrowAsset, signer);
      const decimalsCollateral = await collateralAsset.decimals();
      const decimalsBorrow = await borrowAsset.decimals();

      // prepare conversion plan
      const plan = await getConversionPlan({
        collateralAsset: p.collateralAsset,
        borrowAsset: p.borrowAsset,
        amountIn: p.collateralAmount,
      });

      // put collateral amount on TetuConverter balance
      const collateralAmount = parseUnits(p.collateralAmount, decimalsCollateral);
      await TokenUtils.getToken(p.collateralAsset, tetuConverterSigner.address, collateralAmount);

      // initialize the pool adapter
      await borrowManagerAsGov.connect(tetuConverterSigner).registerPoolAdapter(poolAdapter.address, receiver, p.collateralAsset, p.borrowAsset);
      const poolAdapterInstance = ZerovixPoolAdapter__factory.connect(
        await borrowManagerAsGov.getPoolAdapter(poolAdapter.address, receiver, p.collateralAsset, p.borrowAsset),
        tetuConverterSigner
      );
      await IERC20__factory.connect(p.collateralAsset, tetuConverterSigner).approve(poolAdapterInstance.address, collateralAmount);

      // make borrow
      await poolAdapterInstance.connect(tetuConverterSigner).borrow(
        collateralAmount,
        parseUnits(plan.amountToBorrow.toString(), decimalsBorrow),
        receiver
      );

      // get status
      const statusAfterBorrow = await poolAdapterInstance.getStatus();

      // move time
      await TimeUtils.advanceNBlocks(p.countBlocksBeforeUpdateStatus);

      // call update status
      const statusBeforeUpdateStatus = await poolAdapterInstance.getStatus();
      await poolAdapterInstance.updateStatus();
      const statusAfterUpdateStatus = await poolAdapterInstance.getStatus();

      return {
        statusAfterBorrow: BorrowRepayDataTypeUtils.getPoolAdapterStatusNum(statusAfterBorrow, decimalsCollateral, decimalsBorrow),
        statusBeforeUpdateStatus: BorrowRepayDataTypeUtils.getPoolAdapterStatusNum(statusBeforeUpdateStatus, decimalsCollateral, decimalsBorrow),
        statusAfterUpdateStatus: BorrowRepayDataTypeUtils.getPoolAdapterStatusNum(statusAfterUpdateStatus, decimalsCollateral, decimalsBorrow)
      }
    }

    describe("Good paths", () => {
      it("should increase debt amount and collateral amount", async () => {
        await ZerovixSetupUtils.setupPriceOracleMock(signer, true);
        const ret = await updateStatus({
          collateralAsset: ZkevmAddresses.MATIC,
          borrowAsset: ZkevmAddresses.USDC,
          collateralAmount: "1234",
          countBlocksBeforeUpdateStatus: 10_000
        });
        console.log(ret);
        expect(ret.statusAfterBorrow.amountToPay).eq(ret.statusBeforeUpdateStatus.amountToPay, "Debt amount is not changed without call of UpdateStatus");
        expect(ret.statusAfterUpdateStatus.amountToPay).gt(ret.statusAfterBorrow.amountToPay);
        expect(ret.statusAfterUpdateStatus.collateralAmount).gt(ret.statusAfterBorrow.collateralAmount);
      });
    });
  });

  // describe("claimRewards", () => {
  //   let snapshotLocal: string;
  //   beforeEach(async function () {
  //     snapshotLocal = await TimeUtils.snapshot();
  //   });
  //   afterEach(async function () {
  //     await TimeUtils.rollback(snapshotLocal);
  //   });
  //
  //   interface IParams {
  //     collateralAsset: string;
  //     borrowAsset: string;
  //     collateralAmount: string;
  //
  //     countBlocksBeforeClaimingRewards: number;
  //   }
  //
  //   interface IResults {
  //     rewardToken: string;
  //     amount: number;
  //     rewardsBalance: number;
  //   }
  //
  //   async function claimRewards(p: IParams): Promise<IResults> {
  //     await InjectUtils.registerWethWellPoolInLiquidator(signer);
  //     const liquidator = await ITetuLiquidator__factory.connect(tetuLiquidator, signer);
  //     const test = await liquidator.getPrice(BaseAddresses.WELL, ZkevmAddresses.USDC, BigNumber.from("65147450812097255374"));
  //     console.log("test", test);
  //
  //
  //     const receiver = ethers.Wallet.createRandom().address;
  //     const tetuConverterSigner = await Misc.impersonate(tetuConverterReplacer.address);
  //
  //     const collateralAsset = IERC20Metadata__factory.connect(p.collateralAsset, signer);
  //     const borrowAsset = IERC20Metadata__factory.connect(p.borrowAsset, signer);
  //     const decimalsCollateral = await collateralAsset.decimals();
  //     const decimalsBorrow = await borrowAsset.decimals();
  //
  //     // prepare conversion plan
  //     const plan = await getConversionPlan({
  //       collateralAsset: p.collateralAsset,
  //       borrowAsset: p.borrowAsset,
  //       amountIn: p.collateralAmount,
  //       countBlocks: p.countBlocksBeforeClaimingRewards
  //     });
  //
  //     // put collateral amount on TetuConverter balance
  //     const collateralAmount = parseUnits(p.collateralAmount, decimalsCollateral);
  //     await TokenUtils.getToken(p.collateralAsset, tetuConverterSigner.address, collateralAmount);
  //
  //     // initialize the pool adapter
  //     await borrowManagerAsGov.connect(tetuConverterSigner).registerPoolAdapter(poolAdapter.address, receiver, p.collateralAsset, p.borrowAsset);
  //     const poolAdapterInstance = ZerovixPoolAdapter__factory.connect(
  //       await borrowManagerAsGov.getPoolAdapter(poolAdapter.address, receiver, p.collateralAsset, p.borrowAsset),
  //       tetuConverterSigner
  //     );
  //     await IERC20__factory.connect(p.collateralAsset, tetuConverterSigner).approve(poolAdapterInstance.address, collateralAmount);
  //
  //     // make borrow
  //     await poolAdapterInstance.connect(tetuConverterSigner).borrow(
  //       collateralAmount,
  //       parseUnits(plan.amountToBorrow.toString(), decimalsBorrow),
  //       receiver
  //     );
  //
  //     // move time
  //     await TimeUtils.advanceNBlocks(p.countBlocksBeforeClaimingRewards);
  //
  //     // call update status
  //     const ret = await poolAdapterInstance.callStatic.claimRewards(receiver);
  //     await poolAdapterInstance.claimRewards(receiver);
  //
  //     return {
  //       rewardToken: ret.rewardToken,
  //       amount: ret.amount.eq(0)
  //         ? 0
  //         : +formatUnits(ret.amount, await IERC20Metadata__factory.connect(ret.rewardToken, signer).decimals()),
  //       rewardsBalance: +formatUnits(
  //         await IERC20__factory.connect(BaseAddresses.WELL, signer).balanceOf(receiver),
  //         await IERC20Metadata__factory.connect(BaseAddresses.WELL, signer).decimals()
  //       )
  //     }
  //   }
  //
  //   describe("Good paths", () => {
  //     it("should increase debt amount and collateral amount DAI:USDC", async () => {
  //       const ret = await claimRewards({
  //         collateralAsset: ZkevmAddresses.MATIC,
  //         borrowAsset: ZkevmAddresses.USDC,
  //         collateralAmount: "1234",
  //         countBlocksBeforeClaimingRewards: 10_000,
  //       });
  //       console.log(ret);
  //       // const ret2 = await claimRewards({
  //       //   collateralAsset: ZkevmAddresses.MATIC,
  //       //   borrowAsset: ZkevmAddresses.USDC,
  //       //   collateralAmount: "1234",
  //       //   countBlocksBeforeClaimingRewards: 10_000,
  //       // });
  //       expect(ret.amount).gt(0, "rewards should be paid");
  //       expect(ret.amount).approximately(ret.rewardsBalance, 0.01, "rewards should be received");
  //     });
  //     it("should increase debt amount and collateral amount USDC:USDbC", async () => {
  //       const ret = await claimRewards({
  //         collateralAsset: ZkevmAddresses.USDC,
  //         borrowAsset: ZkevmAddresses.USDT,
  //         collateralAmount: "1234",
  //         countBlocksBeforeClaimingRewards: 10_000,
  //       });
  //       console.log(ret);
  //       expect(ret.amount).gt(0, "rewards should be paid");
  //       expect(ret.amount).approximately(ret.rewardsBalance, 0.01, "rewards should be received");
  //     });
  //   });
  //   describe("temp test @skip-on-coverage", () => {
  //     it("todo", async () => {
  //       await InjectUtils.registerWethWellPoolInLiquidator(signer);
  //       const assets = [
  //         ZkevmAddresses.WETH,
  //         ZkevmAddresses.USDC,
  //         ZkevmAddresses.USDT,
  //         ZkevmAddresses.MATIC,
  //       ]
  //
  //       const liquidator = await ITetuLiquidator__factory.connect(BaseAddresses.TETU_LIQUIDATOR, signer);
  //       const well = IERC20Metadata__factory.connect(BaseAddresses.WELL, signer);
  //       const decimalsWell = await well.decimals();
  //
  //       for (const asset of assets) {
  //         const assetName = await IERC20Metadata__factory.connect(asset, signer).symbol();
  //         const assetDecimals = await IERC20Metadata__factory.connect(asset, signer).decimals();
  //         const source1 = parseUnits("1000", decimalsWell);
  //         const fromWell = await liquidator.getPrice(BaseAddresses.WELL, asset, source1);
  //         console.log(`well ${source1.toString()} => ${assetName} ${fromWell.toString()}`);
  //
  //         const source2 = parseUnits("1000", assetDecimals);
  //         const toWell = await liquidator.getPrice(asset, BaseAddresses.WELL, source2);
  //         console.log(`${assetName} ${source2.toString()}=> well ${toWell.toString()}`);
  //       }
  //
  //       const sourceTest1 = BigNumber.from("65147450812097255374");
  //       const test1 = await liquidator.getPrice(BaseAddresses.WELL, ZkevmAddresses.USDC, sourceTest1.toString());
  //       console.log(`WELL ${sourceTest1.toString()} => USDC ${test1.toString()}`);
  //
  //       const sourceTest2 = BigNumber.from("33");
  //       const test2 = await liquidator.getPrice(BaseAddresses.WELL, ZkevmAddresses.USDC, sourceTest2.toString());
  //       console.log(`WELL ${sourceTest2.toString()} => USDC ${test2.toString()}`);
  //
  //       // const receiver = ethers.Wallet.createRandom().address;
  //       // await BalanceUtils.getAmountFromHolder(BaseAddresses.WELL, BaseAddresses.HOLDER_WELL, receiver, parseUnits("1", 18));
  //       // await IERC20Metadata__factory.connect(ZkevmAddresses.USDC, await Misc.impersonate(receiver)).approve(liquidator.address, Misc.MAX_UINT);
  //       // await liquidator.connect(await Misc.impersonate(receiver)).liquidate(BaseAddresses.WELL, ZkevmAddresses.USDC, sourceTest2, 100_000);
  //       // const balance = await IERC20Metadata__factory.connect(ZkevmAddresses.USDC, signer).balanceOf(receiver);
  //       // console.log("balance", balance);
  //     });
  //   });
  // });

//endregion Unit tests
});