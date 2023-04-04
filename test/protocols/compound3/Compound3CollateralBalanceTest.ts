import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {parseUnits} from "ethers/lib/utils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";
import {TokenDataTypes} from "../../baseUT/types/TokenDataTypes";
import {Compound3TestUtils, IInitialBorrowResults} from "../../baseUT/protocols/compound3/Compound3TestUtils";
import {expect} from "chai";
import {SharedRepayToRebalanceUtils} from "../../baseUT/protocols/shared/sharedRepayToRebalanceUtils";
import {BigNumber} from "ethers";


describe("Compound3CollateralBalanceTest", () => {
//region Constants
  const collateralAsset = MaticAddresses.WETH;
  const collateralHolder = MaticAddresses.HOLDER_WETH;
  const borrowAsset = MaticAddresses.USDC;
  const borrowHolder = MaticAddresses.HOLDER_USDC;
  const collateralAmount = parseUnits('100');
//endregion Constants

//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let init: IInitialBorrowResults;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];

    if (!await isPolygonForkInUse()) return;

    const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
    const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);
    const prepareResults = await Compound3TestUtils.prepareToBorrow(
      deployer,
      collateralToken,
      collateralHolder,
      collateralAmount,
      borrowToken,
      [MaticAddresses.COMPOUND3_COMET_USDC],
      MaticAddresses.COMPOUND3_COMET_REWARDS,
    )
    const borrowResults = await Compound3TestUtils.makeBorrow(deployer, prepareResults, undefined)

    init = {
      prepareResults,
      borrowResults,
      collateralAmount,
      collateralToken,
      borrowToken,
      stateAfterBorrow: await Compound3TestUtils.getState(prepareResults)
    }
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
  describe("Check collateralBalanceBase and status.collateralAmountLiquidated", () => {
    describe("Make second borrow", () => {
      it("should return expected collateral balance", async () => {
        if (!await isPolygonForkInUse()) return;

        await Compound3TestUtils.putCollateralAmountOnUserBalance(init, collateralHolder);
        await Compound3TestUtils.makeBorrow(deployer, init.prepareResults, undefined)
        const stateAfterSecondBorrow = await Compound3TestUtils.getState(init.prepareResults)

        expect(init.stateAfterBorrow.status.collateralAmountLiquidated).eq(0)
        expect(stateAfterSecondBorrow.status.collateralAmountLiquidated).eq(0)
        expect(init.stateAfterBorrow.collateralBalanceBase).lt(stateAfterSecondBorrow.collateralBalanceBase)
      })
      it("make full repay, should return zero collateral balance", async () => {
        if (!await isPolygonForkInUse()) return;

        await Compound3TestUtils.putCollateralAmountOnUserBalance(init, collateralHolder);
        await Compound3TestUtils.makeBorrow(deployer, init.prepareResults, undefined)
        await Compound3TestUtils.putDoubleBorrowAmountOnUserBalance(init.prepareResults, borrowHolder)
        await Compound3TestUtils.makeRepay(init.prepareResults, undefined) // full repayment
        const stateAfterFullRepay = await Compound3TestUtils.getState(init.prepareResults)

        expect(init.stateAfterBorrow.status.collateralAmountLiquidated).eq(0)
        expect(stateAfterFullRepay.status.collateralAmountLiquidated).eq(0)
        expect(init.stateAfterBorrow.collateralBalanceBase).gt(0)
        expect(stateAfterFullRepay.collateralBalanceBase).eq(0)
      })
    })
    describe("Make partial repay", () => {
      it("should return expected collateral balance", async () => {
        if (!await isPolygonForkInUse()) return;

        await Compound3TestUtils.putDoubleBorrowAmountOnUserBalance(init.prepareResults, borrowHolder)
        await Compound3TestUtils.makeRepay(init.prepareResults, init.prepareResults.amountToBorrow.div(2))
        const stateAfterRepay = await Compound3TestUtils.getState(init.prepareResults)

        expect(stateAfterRepay.status.collateralAmountLiquidated).eq(0)
        expect(init.stateAfterBorrow.collateralBalanceBase).gt(stateAfterRepay.collateralBalanceBase)
      })
      it("make full repay, should return zero collateral balance", async () => {
        if (!await isPolygonForkInUse()) return;

        await Compound3TestUtils.putCollateralAmountOnUserBalance(init, collateralHolder);
        await Compound3TestUtils.makeBorrow(deployer, init.prepareResults, undefined)
        await Compound3TestUtils.putDoubleBorrowAmountOnUserBalance(init.prepareResults, borrowHolder)
        await Compound3TestUtils.makeRepay(init.prepareResults, init.prepareResults.amountToBorrow.div(2))
        await Compound3TestUtils.makeRepay(init.prepareResults, undefined) // full repayment
        const stateAfterFullRepay = await Compound3TestUtils.getState(init.prepareResults)

        expect(stateAfterFullRepay.status.collateralAmountLiquidated).eq(0)
        expect(stateAfterFullRepay.collateralBalanceBase).eq(0)
      })
    })
    describe("Make repay to rebalance using collateral asset", () => {
      it("add collateral, should return updated collateral balance", async () => {
        if (!await isPolygonForkInUse()) return;

        // increase target health factor from 200 to 300
        await init.prepareResults.controller.setTargetHealthFactor2(300);
        const amountToRepay = await init.prepareResults.amountToBorrow.mul(2).div(3);
        await Compound3TestUtils.putCollateralAmountOnUserBalance(init, collateralHolder);

        await SharedRepayToRebalanceUtils.approveAmountToRepayToUserContract(
          init.prepareResults.poolAdapter.address,
          init.prepareResults.collateralToken.address,
          init.prepareResults.borrowToken.address,
          {
            useCollateral: true,
            amountBorrowAsset: BigNumber.from(0),
            amountCollateralAsset: amountToRepay
          },
          init.prepareResults.userContract.address,
          await init.prepareResults.controller.tetuConverter()
        );

        await init.prepareResults.poolAdapter.repayToRebalance(amountToRepay, true);
        const stateAfterRepayToRebalance = await Compound3TestUtils.getState(init.prepareResults)

        expect(stateAfterRepayToRebalance.status.collateralAmountLiquidated).eq(0)
        expect(stateAfterRepayToRebalance.collateralBalanceBase).gt(init.stateAfterBorrow.collateralBalanceBase)
      })
      it("make full repay, should return zero collateral balance", async () => {
        if (!await isPolygonForkInUse()) return;

        // increase target health factor from 200 to 300
        await init.prepareResults.controller.setTargetHealthFactor2(300);
        const amountToRepay = await init.prepareResults.amountToBorrow.mul(2).div(3);
        await Compound3TestUtils.putCollateralAmountOnUserBalance(init, collateralHolder);

        await SharedRepayToRebalanceUtils.approveAmountToRepayToUserContract(
          init.prepareResults.poolAdapter.address,
          init.prepareResults.collateralToken.address,
          init.prepareResults.borrowToken.address,
          {
            useCollateral: true,
            amountBorrowAsset: BigNumber.from(0),
            amountCollateralAsset: amountToRepay
          },
          init.prepareResults.userContract.address,
          await init.prepareResults.controller.tetuConverter()
        );

        await init.prepareResults.poolAdapter.repayToRebalance(amountToRepay, true);

        await Compound3TestUtils.putDoubleBorrowAmountOnUserBalance(init.prepareResults, borrowHolder)

        await Compound3TestUtils.makeRepay(init.prepareResults, undefined) // full repayment
        const stateAfterFullRepay = await Compound3TestUtils.getState(init.prepareResults)

        expect(stateAfterFullRepay.status.collateralAmountLiquidated).eq(0)
        expect(stateAfterFullRepay.collateralBalanceBase).eq(0)
      })
    })
    describe("Make repay to rebalance using borrow asset", () => {
      it("add borrow, should not change internal collateral balance", async () => {
        if (!await isPolygonForkInUse()) return;

        // increase target health factor from 200 to 300
        await init.prepareResults.controller.setTargetHealthFactor2(300);
        const amountToRepay = await init.prepareResults.amountToBorrow.mul(2).div(3);
        await Compound3TestUtils.putDoubleBorrowAmountOnUserBalance(init.prepareResults, borrowHolder)
        await SharedRepayToRebalanceUtils.approveAmountToRepayToUserContract(
          init.prepareResults.poolAdapter.address,
          init.prepareResults.collateralToken.address,
          init.prepareResults.borrowToken.address,
          {
            useCollateral: false,
            amountBorrowAsset: amountToRepay,
            amountCollateralAsset: BigNumber.from(0)
          },
          init.prepareResults.userContract.address,
          await init.prepareResults.controller.tetuConverter()
        );
        await init.prepareResults.poolAdapter.repayToRebalance(amountToRepay, false);
        const stateAfterRepayToRebalance = await Compound3TestUtils.getState(init.prepareResults)

        expect(stateAfterRepayToRebalance.status.collateralAmountLiquidated).eq(0)
        expect(init.stateAfterBorrow.collateralBalanceBase).eq(stateAfterRepayToRebalance.collateralBalanceBase)
      })
      it("make full repay, should return zero collateral balance", async () => {
        if (!await isPolygonForkInUse()) return;
        // increase target health factor from 200 to 300
        await init.prepareResults.controller.setTargetHealthFactor2(300);
        const amountToRepay = await init.prepareResults.amountToBorrow.mul(2).div(3);
        await Compound3TestUtils.putDoubleBorrowAmountOnUserBalance(init.prepareResults, borrowHolder)

        await SharedRepayToRebalanceUtils.approveAmountToRepayToUserContract(
          init.prepareResults.poolAdapter.address,
          init.prepareResults.collateralToken.address,
          init.prepareResults.borrowToken.address,
          {
            useCollateral: false,
            amountBorrowAsset: amountToRepay,
            amountCollateralAsset: BigNumber.from(0)
          },
          init.prepareResults.userContract.address,
          await init.prepareResults.controller.tetuConverter()
        );

        await init.prepareResults.poolAdapter.repayToRebalance(amountToRepay, false);

        await Compound3TestUtils.makeRepay(init.prepareResults, undefined) // full repayment
        const stateAfterFullRepay = await Compound3TestUtils.getState(init.prepareResults)

        expect(stateAfterFullRepay.status.collateralAmountLiquidated).eq(0)
        expect(stateAfterFullRepay.collateralBalanceBase).eq(0)
      })
    })
  })
//endregion Unit tests
})