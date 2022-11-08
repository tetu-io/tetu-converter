import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {expect} from "chai";
import {TokenDataTypes} from "../../baseUT/types/TokenDataTypes";
import {BigNumber} from "ethers";
import {IPoolAdapterStatus} from "../../baseUT/types/BorrowRepayDataTypes";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {
  HundredFinanceTestUtils,
  IPrepareToBorrowResults
} from "../../baseUT/protocols/hundred-finance/HundredFinanceTestUtils";
import {HundredFinanceChangePriceUtils} from "./HundredFinanceChangePriceUtils";
import {IERC20__factory, IHfCToken__factory} from "../../../typechain";

describe("HfLiquidationTest", () => {
//region Constants
  const MAX_UINT_AMOUNT = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
  const collateralAsset = MaticAddresses.DAI;
  const collateralHolder = MaticAddresses.HOLDER_DAI;
  const collateralCTokenAddress = MaticAddresses.hDAI;
  const borrowAsset = MaticAddresses.WMATIC;
  const borrowCTokenAddress = MaticAddresses.hMATIC;
  const borrowHolder = MaticAddresses.HOLDER_WMATIC;

  const collateralAmountNum = 100_000;
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
    collateralCToken: TokenDataTypes;
    borrowCToken: TokenDataTypes;
    collateralAmount: BigNumber;
    statusBeforeLiquidation: IPoolAdapterStatus;
    d: IPrepareToBorrowResults;
  }

  async function prepareToLiquidation() : Promise<IPrepareToLiquidationResults> {
    const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
    const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);
    const collateralCToken = await TokenDataTypes.Build(deployer, collateralCTokenAddress);
    const borrowCToken = await TokenDataTypes.Build(deployer, borrowCTokenAddress);

    const collateralAmount = getBigNumberFrom(100_000, collateralToken.decimals);

    const d = await HundredFinanceTestUtils.prepareToBorrow(deployer,
      collateralToken,
      collateralHolder,
      collateralCTokenAddress,
      collateralAmount,
      borrowToken,
      borrowCTokenAddress,
    );
    // make a borrow
    await HundredFinanceTestUtils.makeBorrow(
      deployer,
      collateralToken,
      collateralCToken,
      collateralHolder,
      collateralAmount,
      borrowToken,
      borrowCToken,
      undefined
    );

    // reduce price of collateral to reduce health factor below 1
    await HundredFinanceChangePriceUtils.setupPriceOracleMock(
      deployer,
      [
        MaticAddresses.hDAI,
        MaticAddresses.hMATIC,
        MaticAddresses.hUSDC,
        MaticAddresses.hETH,
        MaticAddresses.hUSDT,
        MaticAddresses.hWBTC,
        MaticAddresses.hFRAX,
        MaticAddresses.hLINK,
      ]
    );
    await HundredFinanceChangePriceUtils.changeCTokenPrice(
      deployer,
      collateralCTokenAddress,
      false,
      10
    );

    const statusBeforeLiquidation = await d.hfPoolAdapterTC.getStatus();
    return {
      collateralToken,
      borrowToken,
      collateralCToken,
      borrowCToken,
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
    const borrowerAddress = init.d.hfPoolAdapterTC.address;

    const borrowCTokenAsLiquidator = IHfCToken__factory.connect(init.d.borrowCToken.address, liquidator);
    const accountBefore = await init.d.comptroller.getAccountLiquidity(borrowerAddress);
    const borrowPrice = await init.d.priceOracle.getUnderlyingPrice(init.d.borrowCToken.address);
    const borrowDebt = accountBefore.shortfall.mul(borrowPrice);
    console.log("borrowed amount", init.d.amountToBorrow);
    console.log("debt", borrowDebt);

    await BalanceUtils.getAmountFromHolder(borrowAsset, borrowHolder, liquidatorAddress, borrowDebt);
    await IERC20__factory.connect(borrowAsset, liquidator).approve(init.d.comptroller.address, MAX_UINT_AMOUNT);

    console.log("Before liquidation, user account", accountBefore);
    await borrowCTokenAsLiquidator.liquidateBorrow(borrowerAddress, borrowDebt, init.d.collateralCToken.address);

    const accountAfter = await init.d.comptroller.getAccountLiquidity(borrowerAddress);
    console.log("Before liquidation, user account", accountAfter);

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
        console.log("After liquidation", await init.d.hfPoolAdapterTC.getStatus());

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
          HundredFinanceTestUtils.makeBorrow(
            deployer,
            init.collateralToken,
            init.collateralCToken,
            collateralHolder,
            init.collateralAmount,
            init.borrowToken,
            init.borrowCToken,
            undefined
          )
        ).revertedWith("35");
      });
    });
  });
//endregion Unit tests
});