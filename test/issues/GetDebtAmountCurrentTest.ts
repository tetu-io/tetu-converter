import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {Aave3PlatformFabric} from "../baseUT/fabrics/Aave3PlatformFabric";
import {
  BorrowRepayUsesCase, IActionsResults,
  IMakeTestSingleBorrowInstantRepayResults,
  IQuoteRepayResults
} from "../baseUT/uses-cases/BorrowRepayUsesCase";
import {isPolygonForkInUse} from "../baseUT/utils/NetworkUtils";
import {HundredFinancePlatformFabric} from "../baseUT/fabrics/HundredFinancePlatformFabric";
import {DForcePlatformFabric} from "../baseUT/fabrics/DForcePlatformFabric";
import {AaveTwoPlatformFabric} from "../baseUT/fabrics/AaveTwoPlatformFabric";
import {
  GAS_LIMIT_INIT_BORROW_AAVE_TWO,
  GAS_LIMIT_REPAY_AAVE_TWO,
  GAS_LIMIT_INIT_BORROW_DFORCE,
  GAS_LIMIT_REPAY_DFORCE,
  GAS_LIMIT_INIT_BORROW_HUNDRED_FINANCE,
  GAS_LIMIT_REPAY_HUNDRED_FINANCE,
  GAS_LIMIT_QUOTE_REPAY_AAVE3,
  GAS_LIMIT_QUOTE_REPAY_AAVE_TWO,
  GAS_LIMIT_QUOTE_REPAY_DFORCE,
  GAS_LIMIT_QUOTE_REPAY_HUNDRED_FINANCE,
  GAS_LIMIT_QUOTE_REPAY_AAVE3_WITH_SWAP,
  GAS_LIMIT_QUOTE_REPAY_DFORCE_WITH_SWAP,
  GAS_LIMIT_QUOTE_REPAY_HUNDRED_FINANCE_WITH_SWAP,
  GAS_LIMIT_QUOTE_REPAY_AAVE_TWO_WITH_SWAP
} from "../baseUT/GasLimit";
import {controlGasLimitsEx} from "../../scripts/utils/hardhatUtils";
import {DForceChangePriceUtils} from "../baseUT/protocols/dforce/DForceChangePriceUtils";
import {TetuConverterApp} from "../baseUT/helpers/TetuConverterApp";
import {CoreContractsHelper} from "../baseUT/helpers/CoreContractsHelper";
import {areAlmostEqual} from "../baseUT/utils/CommonUtils";
import {Controller__factory, IController__factory, ITetuConverter__factory} from "../../typechain";

describe.skip("GetDebtAmountCurrentTest", () => {
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
    // we use signers[1] instead signers[0] here because of weird problem
    // if signers[0] is used than newly created TetuConverter contract has not-zero USDC balance
    // and some tests don't pass
    deployer = signers[1];

    if (!await isPolygonForkInUse()) return;
    // We need to replace DForce price oracle by custom one
    // because when we run all tests
    // DForce-prices deprecate before DForce tests are run
    // and we have TC-4 (zero price) error in DForce-tests
    await DForceChangePriceUtils.setupPriceOracleMock(deployer);
  });

  after(async function () {
    await TimeUtils.rollback(snapshot);
  });

  beforeEach(async function () {
    console.log("beforeEach");
    snapshotForEach = await TimeUtils.snapshot();
  });

  afterEach(async function () {
    console.log("afterEach");
    await TimeUtils.rollback(snapshotForEach);
  });
//endregion before, after

//region Unit tests
  describe("getDebtAmountCurrent result is not rounded", async () => {
    describe("Good paths", () => {
      describe("Dai=>USDC", () => {
        const ASSET_COLLATERAL = MaticAddresses.USDC;
        const HOLDER_COLLATERAL = MaticAddresses.HOLDER_USDC;
        const ASSET_BORROW = MaticAddresses.DAI;
        const HOLDER_BORROW = MaticAddresses.HOLDER_DAI;
        const AMOUNT_COLLATERAL = 4_444;
        const INITIAL_LIQUIDITY_COLLATERAL = 100_000;
        const INITIAL_LIQUIDITY_BORROW = 80_000;
        const HEALTH_FACTOR2 = 200;
        const COUNT_BLOCKS = 1_000;

        it("should display not rounded values", async () => {
          if (!await isPolygonForkInUse()) return;

          // const {controller} = await TetuConverterApp.buildApp(
          //   deployer,
          //   [new AaveTwoPlatformFabric()],
          //   {priceOracleFabric: async c => (await CoreContractsHelper.createPriceOracle(deployer, c.address)).address} // disable swap, enable price oracle
          // );
          const controller = Controller__factory.connect("0x29Eead6Fd74F826dac9E0383abC990615AA62Fa7", deployer);

          const results = await BorrowRepayUsesCase.makeBorrow(deployer,
            {
              collateral: {
                asset: ASSET_COLLATERAL,
                holder: HOLDER_COLLATERAL,
                initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
              },
              borrow: {
                asset: ASSET_BORROW,
                holder: HOLDER_BORROW,
                initialLiquidity: INITIAL_LIQUIDITY_BORROW,
              },
              collateralAmount: AMOUNT_COLLATERAL,
              healthFactor2: HEALTH_FACTOR2,
              countBlocks: COUNT_BLOCKS,
            },
            controller
          );

          const tetuConverter = ITetuConverter__factory.connect(await controller.tetuConverter(), deployer);

          const before = await tetuConverter.callStatic.getDebtAmountCurrent(results.uc.address, ASSET_COLLATERAL, ASSET_BORROW);
          console.log("getDebtAmountCurrent", before.totalDebtAmountOut.toString(), before.totalCollateralAmountOut.toString());

          await TimeUtils.advanceNBlocks(918);

          const after = await tetuConverter.callStatic.getDebtAmountCurrent(results.uc.address, ASSET_COLLATERAL, ASSET_BORROW);
          console.log("getDebtAmountCurrent", after.totalDebtAmountOut.toString(), after.totalCollateralAmountOut.toString());

          // nothing to check here
        });
      });
    });
  });
//endregion Unit tests

});