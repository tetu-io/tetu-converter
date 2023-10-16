import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  BorrowManager,
  BorrowManager__factory,
  CompoundAprLibFacade,
  CompoundPlatformAdapterLibFacade,
  ConverterController,
  IERC20__factory,
  IERC20Metadata__factory,
  IMoonwellComptroller,
  IMoonwellPriceOracle,
  MoonwellPlatformAdapter,
  MoonwellPoolAdapter,
  MoonwellPoolAdapter__factory,
  TetuConverter,
  TetuConverter__factory,
  TokenAddressProviderMock
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

describe("MoonwellPlatformAdapterTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let signer: SignerWithAddress;

  let converterController: ConverterController;
  let comptroller: IMoonwellComptroller;
  let priceOracle: IMoonwellPriceOracle;
  let poolAdapter: MoonwellPoolAdapter;
  let platformAdapter: MoonwellPlatformAdapter;
  let tetuConverterSigner: SignerWithAddress;
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

    converterController = await TetuConverterApp.createController(signer,);
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
    tetuConverterSigner = await Misc.impersonate(await converterController.tetuConverter());
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
    interface IParams {
      collateralAsset: string;
      borrowAsset: string;
      collateralHolder: string;

      collateralAmount: string;

      collateralBalance?: string; // collateralAmount by default

      collateralAmountApproved?: string; // collateralAmount by default
    }

    interface IResults {
      collateralBalance: number;
      borrowBalance: number;
      plan: IConversionPlanNum;
      status: IPoolAdapterStatusNum;
    }

    async function borrow(p: IParams): Promise<IResults> {
      const receiver = ethers.Wallet.createRandom().address;

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
            let snapshotLocal: string;
            beforeEach(async function () {
              snapshotLocal = await TimeUtils.snapshot();
            });
            afterEach(async function () {
              await TimeUtils.rollback(snapshotLocal);
            });
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
            let snapshotLocal: string;
            beforeEach(async function () {
              snapshotLocal = await TimeUtils.snapshot();
            });
            afterEach(async function () {
              await TimeUtils.rollback(snapshotLocal);
            });
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
//endregion Unit tests
  });
});