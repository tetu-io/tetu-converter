import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {BigNumber} from "ethers";
import {TetuConverterApp} from "../baseUT/helpers/TetuConverterApp";
import {MocksHelper} from "../baseUT/helpers/MocksHelper";
import {TokenDataTypes} from "../baseUT/types/TokenDataTypes";
import {setInitialBalance} from "../baseUT/utils/CommonUtils";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";
import {TestSingleBorrowParams} from "../baseUT/types/BorrowRepayDataTypes";
import {ILendingPlatformFabric} from "../baseUT/fabrics/ILendingPlatformFabric";
import {isPolygonForkInUse} from "../baseUT/utils/NetworkUtils";
import {BorrowRepayUsesCase} from "../baseUT/uses-cases/BorrowRepayUsesCase";
import {AaveTwoPlatformFabric} from "../baseUT/fabrics/AaveTwoPlatformFabric";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {Aave3PlatformFabric} from "../baseUT/fabrics/Aave3PlatformFabric";
import {Aave3Helper} from "../../scripts/integration/helpers/Aave3Helper";
import {Aave3AprLib__factory, Aave3AprLibFacade} from "../../typechain";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import exp from "constants";
import {expect} from "chai";

/**
 * For any landing platform:
 * 1. Get APR: borrow apr, supply apr (we don't check rewards in this test)
 * 2. Make supply+borrow inside single block
 * 3. Get current amount of borrow-debt-1 and supply-profit-1
 * 4. Advance 1 block
 * 5. Get current amount of borrow-debt-2 and supply-profit-2
 * 6. Ensure, that
 *        (borrow-debt-2 - borrow-debt-1) == borrow apr
 *        (supply-profit-2 - supply-profit-1) = supply apr
 */
describe("CompareAprBeforeAfterBorrow", () => {
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
    deployer = signers[0];
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

//region Data type
  interface ITestResults {
    borrowApr18: BigNumber;
    supplyApr18BT: BigNumber;
    deltaBorrowDebt18: BigNumber;
    deltaSupplyProfit18CT: BigNumber;
  }

//endregion Data type

//region Test impl

  async function makeBorrow (
    deployer: SignerWithAddress,
    p: TestSingleBorrowParams,
    amountToBorrow: BigNumber,
    fabric: ILendingPlatformFabric,
  ) : Promise<string> {
    const {controller} = await TetuConverterApp.buildApp(deployer, [fabric]);
    const uc = await MocksHelper.deployBorrower(deployer.address, controller, p.healthFactor2, p.countBlocks);

    const collateralToken = await TokenDataTypes.Build(deployer, p.collateral.asset);
    const borrowToken = await TokenDataTypes.Build(deployer, p.borrow.asset);

    const c0 = await setInitialBalance(deployer, collateralToken.address
      , p.collateral.holder, p.collateral.initialLiquidity, uc.address);
    const b0 = await setInitialBalance(deployer, borrowToken.address
      , p.borrow.holder, p.borrow.initialLiquidity, uc.address);
    const collateralAmount = getBigNumberFrom(p.collateralAmount, collateralToken.decimals);

    // borrow max allowed amount
    await uc.makeBorrowExactAmount(p.collateral.asset, collateralAmount, p.borrow.asset, uc.address, amountToBorrow);

    const poolAdapters = await uc.getBorrows(p.collateral.asset, p.borrow.asset);
    return poolAdapters[0];
  }
//endregion Test impl


  describe("DAI => WETH", () => {
    const ASSET_COLLATERAL = MaticAddresses.DAI;
    const HOLDER_COLLATERAL = MaticAddresses.HOLDER_DAI;
    const ASSET_BORROW = MaticAddresses.WETH;
    const HOLDER_BORROW = MaticAddresses.HOLDER_WETH;
    const AMOUNT_COLLATERAL = 200_000;
    const INITIAL_LIQUIDITY_COLLATERAL = 1_000_000;
    const INITIAL_LIQUIDITY_BORROW = 100;
    const HEALTH_FACTOR2 = 200;
    const COUNT_BLOCKS = 1;
    const AMOUNT_TO_BORROW = 40;
    const BLOCKS_PER_DAY = 40000;

    describe("AAVE3", () => {
      it("predicted APR should be equal to real APR", async () => {
        if (!await isPolygonForkInUse()) return;

        const collateralToken = await TokenDataTypes.Build(deployer, ASSET_COLLATERAL);
        const borrowToken = await TokenDataTypes.Build(deployer, ASSET_BORROW);

        const h: Aave3Helper = new Aave3Helper(deployer);
        const aavePool = await Aave3Helper.getAavePool(deployer);
        const dp = await Aave3Helper.getAaveProtocolDataProvider(deployer);
        const priceOracle = await Aave3Helper.getAavePriceOracle(deployer);

        const collateralAssetData = await aavePool.getReserveData(ASSET_COLLATERAL);
        const borrowAssetData = await aavePool.getReserveData(ASSET_BORROW);
        console.log("collateralAssetData", collateralAssetData);
        console.log("borrowAssetData", borrowAssetData);

        const borrowReserveData = await dp.getReserveData(ASSET_BORROW);
        const collateralReserveData = await dp.getReserveData(ASSET_COLLATERAL);

        const amountToBorrow = getBigNumberFrom(AMOUNT_TO_BORROW, borrowToken.decimals);
        const amountCollateral = getBigNumberFrom(AMOUNT_COLLATERAL, collateralToken.decimals);
        console.log(`amountCollateral=${amountCollateral.toString()} amountToBorrow=${amountToBorrow.toString()}`);

        // prices
        const prices = await priceOracle.getAssetsPrices([ASSET_COLLATERAL, ASSET_BORROW]);
        const priceCollateral = prices[0];
        const priceBorrow = prices[1];

        // predict APR
        const libFacade = await DeployUtils.deployContract(deployer, "Aave3AprLibFacade") as Aave3AprLibFacade;
        const brRays0 = (await libFacade.getVariableBorrowRateRays(
          borrowAssetData,
          ASSET_BORROW,
          0,
          borrowReserveData.totalStableDebt,
          borrowReserveData.totalVariableDebt
        ));
        const liquidityRateRays0 = await libFacade.getLiquidityRateRays(
          collateralAssetData,
          ASSET_COLLATERAL,
          0,
          collateralReserveData.totalStableDebt,
          collateralReserveData.totalVariableDebt,
        );
        console.log(`liquidityRateRays0=${liquidityRateRays0.toString()} brRays=${brRays0.toString()}`);

        const brRays = (await libFacade.getVariableBorrowRateRays(
          borrowAssetData,
          ASSET_BORROW,
          amountToBorrow,
          borrowReserveData.totalStableDebt,
          borrowReserveData.totalVariableDebt
        ));
        const liquidityRateRays = await libFacade.getLiquidityRateRays(
          collateralAssetData,
          ASSET_COLLATERAL,
          amountCollateral,
          collateralReserveData.totalStableDebt,
          collateralReserveData.totalVariableDebt,
        );
        console.log(`liquidityRateRays=${liquidityRateRays.toString()} brRays=${brRays.toString()}`);

        // make borrow
        const userAddress = await makeBorrow(deployer
          , {
            collateral: {
              asset: ASSET_COLLATERAL,
              holder: HOLDER_COLLATERAL,
              initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
            }, borrow: {
              asset: ASSET_BORROW,
              holder: HOLDER_BORROW,
              initialLiquidity: INITIAL_LIQUIDITY_BORROW,
            }, collateralAmount: AMOUNT_COLLATERAL
            , healthFactor2: HEALTH_FACTOR2
            , countBlocks: COUNT_BLOCKS
          }
          , amountToBorrow
          , new Aave3PlatformFabric()
        );

        const collateralAssetDataAfterBorrow = await aavePool.getReserveData(ASSET_COLLATERAL);
        const borrowAssetDataAfterBorrow = await aavePool.getReserveData(ASSET_BORROW);
        console.log("collateralAssetDataAfterBorrow", collateralAssetData);
        console.log("borrowAssetDataAfterBorrow", borrowAssetData);


        // how user account balances are changed after 1 block
        const before = await aavePool.getUserAccountData(userAddress);
        await TimeUtils.advanceNBlocks(1);
        const after = await aavePool.getUserAccountData(userAddress);
        console.log("user account before", before);
        console.log("user account after", after);

        const deltaCollateralBase = after.totalCollateralBase.sub(before.totalCollateralBase);
        const deltaBorrowBase = after.totalDebtBase.sub(before.totalDebtBase);
        console.log("deltaCollateralBase", deltaCollateralBase);
        console.log("deltaBorrowBase", deltaBorrowBase);
        console.log("priceBorrow", priceBorrow);

        const aprFactor18 = await libFacade.getAprFactor18(BLOCKS_PER_DAY);
        console.log("aprFactor18", aprFactor18);

        const deltaCollateralBT = after.totalCollateralBase.sub(before.totalCollateralBase);
        const deltaBorrowBT = after.totalDebtBase.sub(before.totalDebtBase);

        // compare changes with APR
        const ret = [
          before.totalCollateralBase
            .mul(liquidityRateRays)
            .mul(aprFactor18)
            .div(getBigNumberFrom(1, 27))
            .toString()
          , before.totalDebtBase
            .mul(brRays)
            .mul(aprFactor18)
            .div(getBigNumberFrom(1, 27))
            .toString()
        ].join();

        const expected = [
          deltaCollateralBT.toString()
          , deltaBorrowBT.toString()
        ].join();

        console.log("ret", ret);
        console.log("expected", expected);

        expect(ret).equals(expected);
      });
    });

  });
});

