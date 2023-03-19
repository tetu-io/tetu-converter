import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {
  BorrowRepayUsesCase
} from "../baseUT/uses-cases/BorrowRepayUsesCase";
import {isPolygonForkInUse} from "../baseUT/utils/NetworkUtils";
import {DForceChangePriceUtils} from "../baseUT/protocols/dforce/DForceChangePriceUtils";
import {
  ConverterController__factory,
  IPlatformAdapter__factory,
  ITetuConverter__factory
} from "../../typechain";
import {areAlmostEqual} from "../baseUT/utils/CommonUtils";
import {Misc} from "../../scripts/utils/Misc";

describe("GetDebtAmountCurrentTest", () => {
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
  describe.skip("getDebtAmountCurrent result is not rounded", () => {
    describe("Good paths", () => {
      describe("Dai=>USDC", () => {
        const ASSET_COLLATERAL = MaticAddresses.USDC;
        const HOLDER_COLLATERAL = MaticAddresses.HOLDER_USDC;
        const ASSET_BORROW = MaticAddresses.WETH;
        const HOLDER_BORROW = MaticAddresses.HOLDER_WETH;
        const AMOUNT_COLLATERAL = 1;
        const INITIAL_LIQUIDITY_COLLATERAL = 100_000;
        const INITIAL_LIQUIDITY_BORROW = 80_000;
        const HEALTH_FACTOR2 = 200;
        const COUNT_BLOCKS = 1_000;

        it("should display not rounded values", async () => {
          if (!await isPolygonForkInUse()) return;

          const controller = await ConverterController__factory.connect("0xf1f5d27877e44C93d2892701a887Fb0a102A1815", deployer);

          // const priceOracleAave3 = await Aave3ChangePricesUtils.setupPriceOracleMock(deployer);
          // const {controller} = await TetuConverterApp.buildApp(
          //   deployer,
          //   [new DForcePlatformFabric()],
          //   {
          //     priceOracleFabric: async () => priceOracleAave3.address
          //   }
          // );
          // const controller = Controller__factory.connect("0x29Eead6Fd74F826dac9E0383abC990615AA62Fa7", deployer);
          const governance = await controller.governance();

          const platformAdapterAaveTwo = "0x6e3c9c624634fEE2924A24Afad8627f60C580D03";
          const platformAdapterAave3 = "0xf9013c430ef3B81c6Ede7bEffC5239A6D677941F";
          const platformAdapterDForce = "0x6605Ce0d8E92A0c5d542F19DdB5B236A03137c64";
          const platformAdapterHundredFinance = "0x3863a4eB9071863EB4CbA999E6952b8283804750";
          const toFroze = [
            platformAdapterAave3,
            // platformAdapterAaveTwo,
            platformAdapterDForce,
            platformAdapterHundredFinance
          ];
          for (const platformAdapterAddress of toFroze) {
            const paAsGovernance = IPlatformAdapter__factory.connect(
              platformAdapterAddress,
              await Misc.impersonate(governance)
            );
            await paAsGovernance.setFrozen(true);
          }

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

          const borrowedAmount = results.userBalances[0].borrow.sub(results.ucBalanceBorrow0);
          const ret = areAlmostEqual(borrowedAmount, before.totalDebtAmountOut, 5);
          console.log("borrowed amount", borrowedAmount.toString());
          console.log("before.totalDebtAmountOut", before.totalDebtAmountOut.toString());
          expect(ret).eq(true);
        });
      });
    });
  });
//endregion Unit tests

});
