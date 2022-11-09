import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {expect} from "chai";
import {Aave3TestUtils, IPrepareToBorrowResults} from "../../baseUT/protocols/aave3/Aave3TestUtils";
import {TokenDataTypes} from "../../baseUT/types/TokenDataTypes";
import {BigNumber} from "ethers";
import {IPoolAdapterStatus} from "../../baseUT/types/BorrowRepayDataTypes";
import {Aave3ChangePricesUtils} from "../../baseUT/protocols/aave3/Aave3ChangePricesUtils";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {IAavePool__factory, IERC20__factory, IPoolAdapter__factory} from "../../../typechain";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {Aave3Helper} from "../../../scripts/integration/helpers/Aave3Helper";
import {SharedRepayToRebalanceUtils} from "../../baseUT/protocols/shared/sharedRepayToRebalanceUtils";
import {Misc} from "../../../scripts/utils/Misc";

describe("Aave3LiquidationTest", () => {
//region Constants
  const MAX_UINT_AMOUNT = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
  const collateralAsset = MaticAddresses.DAI;
  const collateralHolder = MaticAddresses.HOLDER_DAI;
  const borrowAsset = MaticAddresses.WMATIC;
  const borrowHolder = MaticAddresses.HOLDER_WMATIC;

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
    init = await prepareToLiquidation();
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

//region TestImpl
  interface IPrepareToLiquidationResults {
    collateralToken: TokenDataTypes;
    borrowToken: TokenDataTypes;
    collateralAmount: BigNumber;
    statusBeforeLiquidation: IPoolAdapterStatus;
    d: IPrepareToBorrowResults;
  }

  async function prepareToLiquidation() : Promise<IPrepareToLiquidationResults> {
    const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
    const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

    const collateralAmount = getBigNumberFrom(collateralAmountNum, collateralToken.decimals);

    const d = await Aave3TestUtils.prepareToBorrow(deployer,
      collateralToken,
      [collateralHolder],
      collateralAmount,
      borrowToken,
      false
    );
    // make a borrow
    await Aave3TestUtils.makeBorrow(deployer, d, undefined);

    // reduce price of collateral to reduce health factor below 1
    await Aave3ChangePricesUtils.changeAssetPrice(deployer, d.collateralToken.address, false, 10);

    const statusBeforeLiquidation = await d.aavePoolAdapterAsTC.getStatus();
    return {
      collateralToken,
      borrowToken,
      collateralAmount,
      statusBeforeLiquidation,
      d
    };
  }

  interface ILiquidationResults {
    liquidatorAddress: string;
    collateralAmountReceivedByLiquidator: BigNumber;
  }
  async function makeLiquidation() : Promise<ILiquidationResults> {
    const liquidatorAddress = ethers.Wallet.createRandom().address;

    const liquidator = await DeployerUtils.startImpersonate(liquidatorAddress);
    const liquidatorBorrowAmountToPay = init.d.amountToBorrow;
    const borrowerAddress = init.d.aavePoolAdapterAsTC.address;
    await BalanceUtils.getAmountFromHolder(borrowAsset, borrowHolder, liquidatorAddress, liquidatorBorrowAmountToPay);
    await IERC20__factory.connect(borrowAsset, liquidator).approve(init.d.aavePool.address, MAX_UINT_AMOUNT);

    const aavePoolAsLiquidator = IAavePool__factory.connect(init.d.aavePool.address, liquidator);
    const dataProvider = await Aave3Helper.getAaveProtocolDataProvider(liquidator);
    const userReserveData = await dataProvider.getUserReserveData(borrowAsset, borrowerAddress);
    const amountToLiquidate = userReserveData.currentVariableDebt.div(2);

    console.log("Before liquidation, user account", await init.d.aavePool.getUserAccountData(borrowerAddress));
    await aavePoolAsLiquidator.liquidationCall(
      collateralAsset,
      borrowAsset,
      borrowerAddress,
      amountToLiquidate,
      false // we need to receive underlying
    );
    console.log("After liquidation, user account", await init.d.aavePool.getUserAccountData(borrowerAddress));

    const collateralAmountReceivedByLiquidator = await IERC20__factory.connect(collateralAsset, deployer).balanceOf(liquidatorAddress);

    return {
      liquidatorAddress,
      collateralAmountReceivedByLiquidator
    }
  }
//endregion TestImpl

//region Unit tests
  describe("Make borrow, change prices, make health factor < 1", () => {
    describe("Good paths", () => {
      it("health factor is less 1 before liquidation", async () => {
        if (!await isPolygonForkInUse()) return;

        const healthFactorNum = Number(ethers.utils.formatUnits(init.statusBeforeLiquidation.healthFactor18));
        expect(healthFactorNum).below(1);
      });

      it("liquidator receives all collateral", async () => {
        if (!await isPolygonForkInUse()) return;

        const r = await makeLiquidation();
        const collateralAmountReceivedByLiquidator = ethers.utils.formatUnits(
          r.collateralAmountReceivedByLiquidator,
          init.collateralToken.decimals
        );
        const collateralAmountStr = ethers.utils.formatUnits(
          init.collateralAmount,
          init.collateralToken.decimals
        );
        console.log("Amount received by liquidator", collateralAmountReceivedByLiquidator);
        console.log("Original collateral amount", collateralAmountStr);

        console.log("Before liquidation", init.statusBeforeLiquidation);
        console.log("After liquidation", await init.d.aavePoolAdapterAsTC.getStatus());

        expect(r.collateralAmountReceivedByLiquidator.gt(0)).eq(true);
      });

      it("Try to make new borrow after liquidation", async () => {
        if (!await isPolygonForkInUse()) return;

        const r = await makeLiquidation();

        // put collateral amount on user's balance
        await BalanceUtils.getRequiredAmountFromHolders(
          init.collateralAmount,
          init.collateralToken.token,
          [collateralHolder],
          init.d.userContract.address
        );

        await expect(
          Aave3TestUtils.makeBorrow(deployer, init.d, undefined)
        ).revertedWith("35");
      });

      it("Try to repay before liquidation", async () => {
        if (!await isPolygonForkInUse()) return;

        // make repayment to rebalance
        const amountsToRepay = {
          useCollateral: true,
          amountCollateralAsset: init.d.collateralAmount.mul(20),
          amountBorrowAsset: BigNumber.from(0)
        }

        // put collateral amount on user's balance
        await BalanceUtils.getRequiredAmountFromHolders(
          amountsToRepay.amountCollateralAsset,
          init.collateralToken.token,
          [collateralHolder],
          init.d.userContract.address
        );
        console.log("Balance collateral of user contract", await init.collateralToken.token.balanceOf(init.d.userContract.address));

        await SharedRepayToRebalanceUtils.approveAmountToRepayToUserContract(
          init.d.aavePoolAdapterAsTC.address,
          collateralAsset,
          borrowAsset,
          amountsToRepay,
          init.d.userContract.address,
          await init.d.controller.tetuConverter()
        );

        const statusBeforeRepay = await init.d.aavePoolAdapterAsTC.getStatus();
        console.log("Status before repay", statusBeforeRepay);

        await init.d.aavePoolAdapterAsTC.repayToRebalance(
          amountsToRepay.useCollateral
            ? amountsToRepay.amountCollateralAsset
            : amountsToRepay.amountBorrowAsset,
          amountsToRepay.useCollateral
        );

        const statusAfterRepay = await init.d.aavePoolAdapterAsTC.getStatus();
        console.log("Status after repay", statusAfterRepay);

        expect(statusAfterRepay.healthFactor18.gt(Misc.WEI)).eq(true);
      });
    });
  });
//endregion Unit tests
});