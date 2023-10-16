import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
    BorrowManager,
    BorrowManager__factory,
    ConverterController,
    IERC20__factory,
    IERC20Metadata__factory,
    IMoonwellComptroller,
    IMoonwellPriceOracle,
    MoonwellPlatformAdapter,
    MoonwellPoolAdapter,
    MoonwellPoolAdapter__factory,
    TetuConverter__factory, TetuConverterReplacer, TetuConverterReplacer__factory
} from "../../../../typechain";
import {BASE_NETWORK_ID, HardhatUtils} from "../../../../scripts/utils/HardhatUtils";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {TetuConverterApp} from "../../../baseUT/app/TetuConverterApp";
import {MoonwellHelper} from "../../../../scripts/integration/moonwell/MoonwellHelper";
import {DeployUtils} from "../../../../scripts/utils/DeployUtils";
import {MoonwellUtils} from "../../../baseUT/protocols/moonwell/MoonwellUtils";
import {BaseAddresses} from "../../../../scripts/addresses/BaseAddresses";
import {
  IMoonwellPreparePlan,
  MoonwellPlatformAdapterUtils
} from "../../../baseUT/protocols/moonwell/MoonwellPlatformAdapterUtils";
import {IConversionPlanNum} from "../../../baseUT/types/AppDataTypes";
import {IPoolAdapterStatusNum} from "../../../baseUT/types/BorrowRepayDataTypes";
import {BalanceUtils} from "../../../baseUT/utils/BalanceUtils";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {Misc} from "../../../../scripts/utils/Misc";
import {BorrowRepayDataTypeUtils} from "../../../baseUT/utils/BorrowRepayDataTypeUtils";
import {expect} from "chai";
import {generateAssetPairs} from "../../../baseUT/utils/AssetPairUtils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";

describe("MoonwellPlatformAdapterTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let signer: SignerWithAddress;

  let converterController: ConverterController;
  let comptroller: IMoonwellComptroller;
  let priceOracle: IMoonwellPriceOracle;
  let poolAdapter: MoonwellPoolAdapter;
  let platformAdapter: MoonwellPlatformAdapter;
  let tetuConverterReplacer: TetuConverterReplacer;
  let converterGovernance: SignerWithAddress;
  let borrowManagerAsGov: BorrowManager;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(BASE_NETWORK_ID);
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    signer = signers[0];

    tetuConverterReplacer = await DeployUtils.deployContract(signer, "TetuConverterReplacer") as TetuConverterReplacer;
    converterController = await TetuConverterApp.createController(
      signer, {
        tetuConverterFabric: {
          deploy: async () => tetuConverterReplacer.address,
          init: async (controller, instance) => {
          }
        },
      }
    );
    comptroller = await MoonwellHelper.getComptroller(signer);
    priceOracle = await MoonwellHelper.getPriceOracle(signer);
    poolAdapter = await DeployUtils.deployContract(signer, "MoonwellPoolAdapter") as MoonwellPoolAdapter;
    platformAdapter = await DeployUtils.deployContract(
      signer,
      "MoonwellPlatformAdapter",
      converterController.address,
      comptroller.address,
      poolAdapter.address,
      MoonwellUtils.getAllCTokens()
    ) as MoonwellPlatformAdapter;
    converterGovernance = await Misc.impersonate(await converterController.governance());
    borrowManagerAsGov = await BorrowManager__factory.connect(await converterController.borrowManager(), converterGovernance);

    // register the platform adapter in TetuConverter app
    const pairs = generateAssetPairs(MoonwellUtils.getAllAssets());
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
  async function getConversionPlan(p: IMoonwellPreparePlan): Promise<IConversionPlanNum> {
    const {
      plan,
    } = await MoonwellPlatformAdapterUtils.getConversionPlan(signer, comptroller, priceOracle, p, platformAdapter, poolAdapter.address);
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
      collateralHolder: string;

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
      await BalanceUtils.getAmountFromHolder(p.collateralAsset, p.collateralHolder, tetuConverterSigner.address, collateralAmount);

      // initialize the pool adapter
      await borrowManagerAsGov.connect(tetuConverterSigner).registerPoolAdapter(poolAdapter.address, receiver, p.collateralAsset, p.borrowAsset);
      const poolAdapterInstance = MoonwellPoolAdapter__factory.connect(
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
          {collateral: BaseAddresses.USDDbC, borrow: BaseAddresses.USDC, amount: "2500"},
          {collateral: BaseAddresses.DAI, borrow: BaseAddresses.USDC, amount: "1"},
          {collateral: BaseAddresses.USDC, borrow: BaseAddresses.DAI, amount: "50000"},
          {collateral: BaseAddresses.USDC, borrow: BaseAddresses.USDDbC, amount: "1000"},
          {collateral: BaseAddresses.DAI, borrow: BaseAddresses.USDDbC, amount: "0.01"},
        ];
        BORROWS.forEach(function (b: IBorrowParams) {
          const testName = `${MoonwellUtils.getAssetName(b.collateral)} - ${MoonwellUtils.getAssetName(b.borrow)}`;
          describe(testName, () => {
            it("should borrow expected amount", async () => {
              const ret = await borrow({
                collateralAsset: b.collateral,
                borrowAsset: b.borrow,
                collateralAmount: b.amount,
                collateralHolder: MoonwellUtils.getHolder(b.collateral)
              });
              expect(ret.plan.amountToBorrow).eq(ret.borrowBalance);
            });
          });
        });
      });
      describe("Native token", () => {
        const BORROWS: IBorrowParams[] = [
          {collateral: BaseAddresses.WETH, borrow: BaseAddresses.USDC, amount: "1"},
          {collateral: BaseAddresses.USDC, borrow: BaseAddresses.WETH, amount: "1000"},
        ];
        BORROWS.forEach(function (b: IBorrowParams) {
          const testName = `${MoonwellUtils.getAssetName(b.collateral)} - ${MoonwellUtils.getAssetName(b.borrow)}`;
          describe(testName, () => {
            it("should borrow expected amount", async () => {
              const ret = await borrow({
                collateralAsset: b.collateral,
                borrowAsset: b.borrow,
                collateralAmount: b.amount,
                collateralHolder: MoonwellUtils.getHolder(b.collateral)
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
          collateralAsset: BaseAddresses.DAI,
          borrowAsset: BaseAddresses.USDC,
          collateralAmount: "1",
          collateralHolder: BaseAddresses.HOLDER_DAI,
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
      const collateralHolder = MoonwellUtils.getHolder(p.collateralAsset);
      const borrowHolder = MoonwellUtils.getHolder(p.borrowAsset);

      // prepare conversion plan
      const plan = await getConversionPlan({
        collateralAsset: p.collateralAsset,
        borrowAsset: p.borrowAsset,
        amountIn: p.collateralAmount,
      });

      // put collateral amount on TetuConverter balance
      const collateralAmount = parseUnits(p.collateralAmount, decimalsCollateral);
      const collateralAmountApproved = parseUnits(p.collateralAmount, decimalsCollateral);
      await BalanceUtils.getAmountFromHolder(p.collateralAsset, collateralHolder, tetuConverterSigner.address, collateralAmount);

      // initialize the pool adapter
      await borrowManagerAsGov.connect(tetuConverterSigner).registerPoolAdapter(poolAdapter.address, receiver, p.collateralAsset, p.borrowAsset);
      const poolAdapterInstance = MoonwellPoolAdapter__factory.connect(
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
      await BalanceUtils.getAmountFromHolder(p.borrowAsset, borrowHolder, tetuConverterSigner.address, amountToRepay.mul(2));
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
            {collateral: BaseAddresses.USDDbC, borrow: BaseAddresses.USDC, amount: "2500"},
            {collateral: BaseAddresses.DAI, borrow: BaseAddresses.USDC, amount: "1"},
            {collateral: BaseAddresses.USDC, borrow: BaseAddresses.DAI, amount: "50000"},
            {collateral: BaseAddresses.USDC, borrow: BaseAddresses.USDDbC, amount: "1000"},
            {collateral: BaseAddresses.DAI, borrow: BaseAddresses.USDDbC, amount: "0.01"},
          ];
          BORROWS.forEach(function (b: IRepayParams) {
            const testName = `${MoonwellUtils.getAssetName(b.collateral)} - ${MoonwellUtils.getAssetName(b.borrow)}`;
            async function repayTest(): Promise<IResults>  {
              return await repay({
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
            {collateral: BaseAddresses.WETH, borrow: BaseAddresses.USDC, amount: "1"},
            {collateral: BaseAddresses.USDC, borrow: BaseAddresses.WETH, amount: "1000"},
          ];
          BORROWS.forEach(function (b: IRepayParams) {
            const testName = `${MoonwellUtils.getAssetName(b.collateral)} - ${MoonwellUtils.getAssetName(b.borrow)}`;
            async function repayTest(): Promise<IResults>  {
              return await repay({
                collateralAsset: b.collateral,
                borrowAsset: b.borrow,
                collateralAmount: b.amount,
              });
            }
            describe(testName, () => {
              it("should receive expected collateral", async () => {
                const ret = await loadFixture(repayTest);
                expect(ret.collateralBalance).gte(Number(b.amount));
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
          return await repay({
            collateralAsset: BaseAddresses.USDC,
            borrowAsset: BaseAddresses.USDDbC,
            collateralAmount: "100",
            repayPart: 20_000
          });
        }
        it("should receive expected collateral", async () => {
          const ret = await loadFixture(repayTest);
          expect(ret.collateralBalance).gte(20);
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
      });
    });
    describe("Bad paths", () => {
      let snapshotLocal: string;
      before(async function () {
        snapshotLocal = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshotLocal);
      });

      it("should revert if not TetuConverter", async () => {
        await expect(repay({
          collateralAsset: BaseAddresses.DAI,
          borrowAsset: BaseAddresses.USDC,
          collateralAmount: "1",
          notTetuConverter: true
        })).rejectedWith("TC-8 tetu converter only") // TETU_CONVERTER_ONLY
      });

      it("should revert if try to repay too match", async () => {
        await expect(repay({
          collateralAsset: BaseAddresses.DAI,
          borrowAsset: BaseAddresses.USDC,
          collateralAmount: "1",
          repayPart: 100_001
        })).rejectedWith("TC-15 wrong borrow balance") // WRONG_BORROWED_BALANCE
      });
    });
//endregion Unit tests
  });
});