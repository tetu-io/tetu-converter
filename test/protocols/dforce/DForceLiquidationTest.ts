import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {expect} from "chai";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {DForceTestUtils, IPrepareToLiquidationResults} from "../../baseUT/protocols/dforce/DForceTestUtils";

describe("DForceLiquidationTest", () => {
//region Constants
  const collateralAsset = MaticAddresses.USDC;
  const collateralHolder = MaticAddresses.HOLDER_USDC;
  const collateralCTokenAddress = MaticAddresses.dForce_iUSDC;
  const borrowAsset = MaticAddresses.WETH;
  const borrowCTokenAddress = MaticAddresses.dForce_iWETH;
  const borrowHolder = MaticAddresses.HOLDER_WETH;

  const CHANGE_PRICE_FACTOR = 10;
  const collateralAmountNum = 1_000;
//endregion Constants

//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let init: IPrepareToLiquidationResults;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];

    if (!await isPolygonForkInUse()) return;
    init = await DForceTestUtils.prepareToLiquidation(
      deployer,
      collateralAsset,
      collateralHolder,
      collateralCTokenAddress,
      collateralAmountNum,
      borrowAsset,
      borrowCTokenAddress,
      CHANGE_PRICE_FACTOR
    );
  });

  after(async function () {
    await TimeUtils.rollback(snapshot);
  });

  beforeEach(async function () {
    snapshotForEach = await TimeUtils.snapshot();
  });

  afterEach(async function () {
    await TimeUtils.rollback(snapshotForEach);
  });
//endregion before, after

//region Unit tests
  describe("Make borrow, change prices, make health factor < 1", () => {
    describe("Good paths", () => {
      it("health factor is less 1 before liquidation", async () => {
        if (!await isPolygonForkInUse()) return;

        console.log("Before liquidation", init.statusBeforeLiquidation);
        const healtDForceactorNum = Number(ethers.utils.formatUnits(init.statusBeforeLiquidation.healthFactor18));
        expect(healtDForceactorNum).below(1);
      });

      it("liquidator receives all collateral", async () => {
        if (!await isPolygonForkInUse()) return;

        const r = await DForceTestUtils.makeLiquidation(deployer, init.d, borrowHolder);
        const collateralAmountReceivedByLiquidator = ethers.utils.formatUnits(
          r.collateralAmountReceivedByLiquidator,
          init.collateralToken.decimals
        );
        const collateralAmountStr = ethers.utils.formatUnits(
          init.collateralAmount,
          init.collateralToken.decimals
        );
        const accountLiquidator = await init.d.comptroller.calcAccountEquity(r.liquidatorAddress);
        console.log("accountLiquidator", accountLiquidator);

        console.log("Amount received by liquidator", collateralAmountReceivedByLiquidator);
        console.log("Original collateral amount", collateralAmountStr);

        console.log("Before liquidation", init.statusBeforeLiquidation);
        const statusAfterLiquidation = await init.d.dfPoolAdapterTC.getStatus();
        console.log("After liquidation", statusAfterLiquidation);

        const ret = [
          r.collateralAmountReceivedByLiquidator.gt(0),
          init.statusBeforeLiquidation.collateralAmountLiquidated.eq(0),
          statusAfterLiquidation.collateralAmountLiquidated.gt(0)
        ].join();
        const expected = [true, true, true].join();
        expect(ret).eq(expected);
      });

      it("Try to make new borrow after liquidation", async () => {
        if (!await isPolygonForkInUse()) return;

        const r = await DForceTestUtils.makeLiquidation(deployer, init.d, borrowHolder);

        // put collateral amount on user's balance
        await BalanceUtils.getRequiredAmountFromHolders(
          init.collateralAmount,
          init.collateralToken.token,
          [collateralHolder],
          init.d.userContract.address
        );

        await expect(
          DForceTestUtils.makeBorrow(deployer, init.d, undefined)
        ).revertedWith("Account has some shortfall"); // borrow failed
      });
    });
  });
//endregion Unit tests
});