import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {Aave3PlatformFabric} from "../baseUT/parts/fabrics/Aave3PlatformFabric";
import {
  BorrowRepayUsesCase,
  IQuoteRepayResults
} from "../baseUT/uses-cases/app/BorrowRepayUsesCase";
import {HundredFinancePlatformFabric} from "../baseUT/parts/fabrics/HundredFinancePlatformFabric";
import {DForcePlatformFabric} from "../baseUT/parts/fabrics/DForcePlatformFabric";
import {AaveTwoPlatformFabric} from "../baseUT/parts/fabrics/AaveTwoPlatformFabric";
import {
  GAS_LIMIT_QUOTE_REPAY_AAVE3,
  GAS_LIMIT_QUOTE_REPAY_AAVE_TWO,
  GAS_LIMIT_QUOTE_REPAY_DFORCE,
  GAS_LIMIT_QUOTE_REPAY_HUNDRED_FINANCE,
  GAS_LIMIT_QUOTE_REPAY_AAVE3_WITH_SWAP,
  GAS_LIMIT_QUOTE_REPAY_DFORCE_WITH_SWAP,
  GAS_LIMIT_QUOTE_REPAY_HUNDRED_FINANCE_WITH_SWAP,
  GAS_LIMIT_QUOTE_REPAY_AAVE_TWO_WITH_SWAP
} from "../baseUT/types/GasLimit";
import {controlGasLimitsEx2, HardhatUtils, POLYGON_NETWORK_ID} from "../../scripts/utils/HardhatUtils";
import {DForceChangePriceUtils} from "../baseUT/protocols/dforce/DForceChangePriceUtils";
import {TetuConverterApp} from "../baseUT/helpers/TetuConverterApp";
import {CoreContractsHelper} from "../baseUT/helpers/CoreContractsHelper";
import {areAlmostEqual} from "../baseUT/utils/CommonUtils";

describe("QuoteRepayTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);

    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    // we use signers[1] instead signers[0] here because of weird problem
    // if signers[0] is used than newly created TetuConverter contract has not-zero USDC balance
    // and some tests don't pass
    deployer = signers[1];

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
  describe("quoteRepay correctly predicts collateral amount", () => {
    describe("Good paths", () => {
      describe("Single borrow, single instant complete repay", () => {
        describe("Dai=>USDC", () => {
          let snapshotLocal: string;
          const ASSET_COLLATERAL = MaticAddresses.DAI;
          const HOLDER_COLLATERAL = MaticAddresses.HOLDER_DAI;
          const ASSET_BORROW = MaticAddresses.USDC;
          const HOLDER_BORROW = MaticAddresses.HOLDER_USDC;
          const AMOUNT_COLLATERAL = 1_000;
          const INITIAL_LIQUIDITY_COLLATERAL = 100_000;
          const INITIAL_LIQUIDITY_BORROW = 80_000;
          const HEALTH_FACTOR2 = 200;
          const COUNT_BLOCKS = 1_000;

          describe("AAVE3", () => {
            let results: IQuoteRepayResults;
            before(async function () {
              snapshotLocal = await TimeUtils.snapshot();
              const {controller} = await TetuConverterApp.buildApp(
                deployer,
                [new Aave3PlatformFabric()],
                {priceOracleFabric: async () => (await CoreContractsHelper.createPriceOracle(deployer, MaticAddresses.AAVE_V3_PRICE_ORACLE)).address} // disable swap, enable price oracle
              );
              results = await BorrowRepayUsesCase.makeQuoteRepay(deployer,
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
            });
            after(async function () {
              await TimeUtils.rollback(snapshotLocal);
            });
            it("should return expected value", async () => {
              const collateralReceivedByUser = results.userBalances[1].collateral.sub(results.userBalances[0].collateral);
              console.log(`Received collateral=${collateralReceivedByUser.toString()} quote=${results.quoteRepayResultCollateralAmount}`);
              console.log(`Balance0 ${results.ucBalanceCollateral0.toString()}`);
              console.log(`Balance1 ${results.userBalances[0].collateral.toString()}`);
              console.log(`Balance2 ${results.userBalances[1].collateral.toString()}`);

              // AAVE v3, SupplyLogic.sol
              // executeWithdraw calls internal function reserve.updateState(reserveCache);
              // to calculate exact balance and withdraw full amount.
              // We cannot update state externally, so we have small difference in amounts
              // For 1000 DAI we have difference about 1e-10 DAI
              const ret = areAlmostEqual(results.quoteRepayResultCollateralAmount, collateralReceivedByUser);
              expect(ret).eq(true);
            });
            it("should not exceed gas limits @skip-on-coverage", async () => {
              controlGasLimitsEx2(results.quoteRepayGasConsumption, GAS_LIMIT_QUOTE_REPAY_AAVE3, (u, t) => {
                expect(u).to.be.below(t + 1);
              });
            });
          });
          describe("AAVETwo", () => {
            let results: IQuoteRepayResults;
            before(async function () {
              snapshotLocal = await TimeUtils.snapshot();
              const {controller} = await TetuConverterApp.buildApp(
                deployer,
                [new AaveTwoPlatformFabric()],
                {priceOracleFabric: async () => (await CoreContractsHelper.createPriceOracle(deployer, MaticAddresses.AAVE_V3_PRICE_ORACLE)).address} // disable swap, enable price oracle
              );
              results = await BorrowRepayUsesCase.makeQuoteRepay(deployer,
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
            });
            after(async function () {
              await TimeUtils.rollback(snapshotLocal);
            });
            it("should return expected value", async () => {
              const collateralReceivedByUser = results.userBalances[1].collateral.sub(results.userBalances[0].collateral);
              console.log(`Received collateral=${collateralReceivedByUser.toString()} quote=${results.quoteRepayResultCollateralAmount}`);
              console.log(`Balance0 ${results.ucBalanceCollateral0.toString()}`);
              console.log(`Balance1 ${results.userBalances[0].collateral.toString()}`);
              console.log(`Balance2 ${results.userBalances[1].collateral.toString()}`);

              // dust difference: for 1000 DAI the difference is about 1e-16 DAI
              const ret = areAlmostEqual(results.quoteRepayResultCollateralAmount, collateralReceivedByUser);
              expect(ret).eq(true);
            });
            it("should not exceed gas limits @skip-on-coverage", async () => {
              controlGasLimitsEx2(results.quoteRepayGasConsumption, GAS_LIMIT_QUOTE_REPAY_AAVE_TWO, (u, t) => {
                expect(u).to.be.below(t + 1);
              });
            });
          });
          describe("dForce", () => {
            let results: IQuoteRepayResults;
            before(async function () {
              snapshotLocal = await TimeUtils.snapshot();
              const {controller} = await TetuConverterApp.buildApp(
                deployer,
                [new DForcePlatformFabric()],
                {priceOracleFabric: async () => (await CoreContractsHelper.createPriceOracle(deployer, MaticAddresses.AAVE_V3_PRICE_ORACLE)).address} // disable swap, enable price oracle
              );
              results = await BorrowRepayUsesCase.makeQuoteRepay(deployer,
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
            });
            after(async function () {
              await TimeUtils.rollback(snapshotLocal);
            });
            it("should return expected value", async () => {
              const collateralReceivedByUser = results.userBalances[1].collateral.sub(results.userBalances[0].collateral);
              console.log(`Received collateral=${collateralReceivedByUser.toString()} quote=${results.quoteRepayResultCollateralAmount}`);
              console.log(`Balance0 ${results.ucBalanceCollateral0.toString()}`);
              console.log(`Balance1 ${results.userBalances[0].collateral.toString()}`);
              console.log(`Balance2 ${results.userBalances[1].collateral.toString()}`);

              const ret = results.quoteRepayResultCollateralAmount.eq(collateralReceivedByUser);
              expect(ret).eq(true);
            });
            it("should not exceed gas limits @skip-on-coverage", async () => {
              controlGasLimitsEx2(results.quoteRepayGasConsumption, GAS_LIMIT_QUOTE_REPAY_DFORCE, (u, t) => {
                expect(u).to.be.below(t + 1);
              });
            });
          });
          describe.skip("Hundred finance", () => {
            let results: IQuoteRepayResults;
            before(async function () {
              snapshotLocal = await TimeUtils.snapshot();
              const {controller} = await TetuConverterApp.buildApp(
                deployer,
                [new HundredFinancePlatformFabric()],
                {priceOracleFabric: async () => (await CoreContractsHelper.createPriceOracle(deployer, MaticAddresses.AAVE_V3_PRICE_ORACLE)).address} // disable swap, enable price oracle
              );
              results = await BorrowRepayUsesCase.makeQuoteRepay(deployer,
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
            });
            after(async function () {
              await TimeUtils.rollback(snapshotLocal);
            });
            it("should return expected value", async () => {
              const collateralReceivedByUser = results.userBalances[1].collateral.sub(results.userBalances[0].collateral);
              console.log(`Received collateral=${collateralReceivedByUser.toString()} quote=${results.quoteRepayResultCollateralAmount}`);
              console.log(`Balance0 ${results.ucBalanceCollateral0.toString()}`);
              console.log(`Balance1 ${results.userBalances[0].collateral.toString()}`);
              console.log(`Balance2 ${results.userBalances[1].collateral.toString()}`);

              const ret = results.quoteRepayResultCollateralAmount.eq(collateralReceivedByUser);
              expect(ret).eq(true);
            });
            it("should not exceed gas limits @skip-on-coverage", async () => {
              controlGasLimitsEx2(results.quoteRepayGasConsumption, GAS_LIMIT_QUOTE_REPAY_HUNDRED_FINANCE, (u, t) => {
                expect(u).to.be.below(t + 1);
              });
            });
          });
        });
        describe("USDC=>WETH", () => {
          let snapshotLocal: string;
          const ASSET_COLLATERAL = MaticAddresses.USDC;
          const HOLDER_COLLATERAL = MaticAddresses.HOLDER_USDC;
          const ASSET_BORROW = MaticAddresses.WETH;
          const HOLDER_BORROW = MaticAddresses.HOLDER_WETH;
          const AMOUNT_COLLATERAL = 1_000;
          const INITIAL_LIQUIDITY_COLLATERAL = 10_000;
          const INITIAL_LIQUIDITY_BORROW = 14_000;
          const HEALTH_FACTOR2 = 200;
          const COUNT_BLOCKS = 1_000;

          describe("AAVE3", () => {
            let results: IQuoteRepayResults;
            before(async function () {
              snapshotLocal = await TimeUtils.snapshot();
              const {controller} = await TetuConverterApp.buildApp(
                deployer,
                [new Aave3PlatformFabric()],
                {priceOracleFabric: async () => (await CoreContractsHelper.createPriceOracle(deployer, MaticAddresses.AAVE_V3_PRICE_ORACLE)).address} // disable swap, enable price oracle
              );
              results = await BorrowRepayUsesCase.makeQuoteRepay(deployer,
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
            });
            after(async function () {
              await TimeUtils.rollback(snapshotLocal);
            });
            it("should return expected value", async () => {
              const collateralReceivedByUser = results.userBalances[1].collateral.sub(results.userBalances[0].collateral);
              console.log(`Received collateral=${collateralReceivedByUser.toString()} quote=${results.quoteRepayResultCollateralAmount}`);
              console.log(`Balance0 ${results.ucBalanceCollateral0.toString()}`);
              console.log(`Balance1 ${results.userBalances[0].collateral.toString()}`);
              console.log(`Balance2 ${results.userBalances[1].collateral.toString()}`);

              // AAVE v3, SupplyLogic.sol
              // executeWithdraw calls internal function reserve.updateState(reserveCache);
              // to calculate exact balance and withdraw full amount.
              // We cannot update state externally, so we have small difference in amounts
              // For 1000 DAI we have difference about 1e-10 DAI
              const ret = areAlmostEqual(results.quoteRepayResultCollateralAmount, collateralReceivedByUser);
              expect(ret).eq(true);
            });
            it("should not exceed gas limits @skip-on-coverage", async () => {
              controlGasLimitsEx2(results.quoteRepayGasConsumption, GAS_LIMIT_QUOTE_REPAY_AAVE3, (u, t) => {
                expect(u).to.be.below(t + 1);
              });
            });
          });
          describe("AAVETwo", () => {
            let results: IQuoteRepayResults;
            before(async function () {
              snapshotLocal = await TimeUtils.snapshot();
              const {controller} = await TetuConverterApp.buildApp(
                deployer,
                [new AaveTwoPlatformFabric()],
                {priceOracleFabric: async () => (await CoreContractsHelper.createPriceOracle(deployer, MaticAddresses.AAVE_V3_PRICE_ORACLE)).address} // disable swap, enable price oracle
              );
              results = await BorrowRepayUsesCase.makeQuoteRepay(deployer,
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
            });
            after(async function () {
              await TimeUtils.rollback(snapshotLocal);
            });
            it("should return expected value", async () => {
              const collateralReceivedByUser = results.userBalances[1].collateral.sub(results.userBalances[0].collateral);
              console.log(`Received collateral=${collateralReceivedByUser.toString()} quote=${results.quoteRepayResultCollateralAmount}`);
              console.log(`Balance0 ${results.ucBalanceCollateral0.toString()}`);
              console.log(`Balance1 ${results.userBalances[0].collateral.toString()}`);
              console.log(`Balance2 ${results.userBalances[1].collateral.toString()}`);

              // dust difference: for 1000 DAI the difference is about 1e-16 DAI
              const ret = areAlmostEqual(results.quoteRepayResultCollateralAmount, collateralReceivedByUser);
              expect(ret).eq(true);
            });
            it("should not exceed gas limits @skip-on-coverage", async () => {
              controlGasLimitsEx2(results.quoteRepayGasConsumption, GAS_LIMIT_QUOTE_REPAY_AAVE_TWO, (u, t) => {
                expect(u).to.be.below(t + 1);
              });
            });
          });
          describe("dForce", () => {
            let results: IQuoteRepayResults;
            before(async function () {
              snapshotLocal = await TimeUtils.snapshot();
              const {controller} = await TetuConverterApp.buildApp(
                deployer,
                [new DForcePlatformFabric()],
                {priceOracleFabric: async () => (await CoreContractsHelper.createPriceOracle(deployer, MaticAddresses.AAVE_V3_PRICE_ORACLE)).address} // disable swap, enable price oracle
              );
              results = await BorrowRepayUsesCase.makeQuoteRepay(deployer,
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
            });
            after(async function () {
              await TimeUtils.rollback(snapshotLocal);
            });
            it("should return expected value", async () => {
              const collateralReceivedByUser = results.userBalances[1].collateral.sub(results.userBalances[0].collateral);
              console.log(`Received collateral=${collateralReceivedByUser.toString()} quote=${results.quoteRepayResultCollateralAmount}`);
              console.log(`Balance0 ${results.ucBalanceCollateral0.toString()}`);
              console.log(`Balance1 ${results.userBalances[0].collateral.toString()}`);
              console.log(`Balance2 ${results.userBalances[1].collateral.toString()}`);

              const ret = results.quoteRepayResultCollateralAmount.eq(collateralReceivedByUser);
              expect(ret).eq(true);
            });
            it("should not exceed gas limits @skip-on-coverage", async () => {
              controlGasLimitsEx2(results.quoteRepayGasConsumption, GAS_LIMIT_QUOTE_REPAY_DFORCE, (u, t) => {
                expect(u).to.be.below(t + 1);
              });
            });
          });
          describe.skip("Hundred finance", () => {
            let results: IQuoteRepayResults;
            before(async function () {
              snapshotLocal = await TimeUtils.snapshot();
              const {controller} = await TetuConverterApp.buildApp(
                deployer,
                [new HundredFinancePlatformFabric()],
                {priceOracleFabric: async () => (await CoreContractsHelper.createPriceOracle(deployer, MaticAddresses.AAVE_V3_PRICE_ORACLE)).address} // disable swap, enable price oracle
              );
              results = await BorrowRepayUsesCase.makeQuoteRepay(deployer,
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
            });
            after(async function () {
              await TimeUtils.rollback(snapshotLocal);
            });
            it("should return expected value", async () => {
              const collateralReceivedByUser = results.userBalances[1].collateral.sub(results.userBalances[0].collateral);
              console.log(`Received collateral=${collateralReceivedByUser.toString()} quote=${results.quoteRepayResultCollateralAmount}`);
              console.log(`Balance0 ${results.ucBalanceCollateral0.toString()}`);
              console.log(`Balance1 ${results.userBalances[0].collateral.toString()}`);
              console.log(`Balance2 ${results.userBalances[1].collateral.toString()}`);

              const ret = results.quoteRepayResultCollateralAmount.eq(collateralReceivedByUser);
              expect(ret).eq(true);
            });
            it("should not exceed gas limits @skip-on-coverage", async () => {
              controlGasLimitsEx2(results.quoteRepayGasConsumption, GAS_LIMIT_QUOTE_REPAY_HUNDRED_FINANCE, (u, t) => {
                expect(u).to.be.below(t + 1);
              });
            });
          });
        });

        describe("Dai=>USDC with additional amount for quoteRepay @skip-on-coverage", () => {
          let snapshotLocal: string;
          const ASSET_COLLATERAL = MaticAddresses.DAI;
          const HOLDER_COLLATERAL = MaticAddresses.HOLDER_DAI;
          const ASSET_BORROW = MaticAddresses.USDC;
          const HOLDER_BORROW = MaticAddresses.HOLDER_USDC;
          const AMOUNT_COLLATERAL = 1_000;
          const INITIAL_LIQUIDITY_COLLATERAL = 100_000;
          const INITIAL_LIQUIDITY_BORROW = 80_000;
          const HEALTH_FACTOR2 = 200;
          const COUNT_BLOCKS = 1_000;

          const ADDITIONAL_AMOUNT_PASSED_TO_QUOTE_REPAY = 100;

          describe("AAVE3", () => {
            let results: IQuoteRepayResults;
            before(async function () {
              snapshotLocal = await TimeUtils.snapshot();
              const {controller} = await TetuConverterApp.buildApp(
                deployer,
                [new Aave3PlatformFabric()],
                {priceOracleFabric: async () => (await CoreContractsHelper.createPriceOracle(deployer, MaticAddresses.AAVE_V3_PRICE_ORACLE)).address} // disable swap, enable price oracle
              );
              results = await BorrowRepayUsesCase.makeQuoteRepay(deployer,
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
                controller,
                undefined,
                ADDITIONAL_AMOUNT_PASSED_TO_QUOTE_REPAY
              );
            });
            after(async function () {
              await TimeUtils.rollback(snapshotLocal);
            });
            it("should not exceed gas limits @skip-on-coverage", async () => {
              controlGasLimitsEx2(results.quoteRepayGasConsumption, GAS_LIMIT_QUOTE_REPAY_AAVE3_WITH_SWAP, (u, t) => {
                expect(u).to.be.below(t + 1);
              });
            });
          });
          describe("AAVETwo", () => {
            let results: IQuoteRepayResults;
            before(async function () {
              snapshotLocal = await TimeUtils.snapshot();
              const {controller} = await TetuConverterApp.buildApp(
                deployer,
                [new AaveTwoPlatformFabric()],
                {priceOracleFabric: async () => (await CoreContractsHelper.createPriceOracle(deployer)).address} // disable swap, enable price oracle
              );
              results = await BorrowRepayUsesCase.makeQuoteRepay(deployer,
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
                controller,
                undefined,
                ADDITIONAL_AMOUNT_PASSED_TO_QUOTE_REPAY
              );
            });
            after(async function () {
              await TimeUtils.rollback(snapshotLocal);
            });
            it("should not exceed gas limits @skip-on-coverage", async () => {
              controlGasLimitsEx2(results.quoteRepayGasConsumption, GAS_LIMIT_QUOTE_REPAY_AAVE_TWO_WITH_SWAP, (u, t) => {
                expect(u).to.be.below(t + 1);
              });
            });
          });
          describe("dForce", () => {
            let results: IQuoteRepayResults;
            before(async function () {
              snapshotLocal = await TimeUtils.snapshot();
              const {controller} = await TetuConverterApp.buildApp(
                deployer,
                [new DForcePlatformFabric()],
                {priceOracleFabric: async () => (await CoreContractsHelper.createPriceOracle(deployer, MaticAddresses.AAVE_V3_PRICE_ORACLE)).address} // disable swap, enable price oracle
              );
              results = await BorrowRepayUsesCase.makeQuoteRepay(deployer,
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
                controller,
                undefined,
                ADDITIONAL_AMOUNT_PASSED_TO_QUOTE_REPAY
              );
            });
            after(async function () {
              await TimeUtils.rollback(snapshotLocal);
            });
            it("should not exceed gas limits @skip-on-coverage", async () => {
              controlGasLimitsEx2(results.quoteRepayGasConsumption, GAS_LIMIT_QUOTE_REPAY_DFORCE_WITH_SWAP, (u, t) => {
                expect(u).to.be.below(t + 1);
              });
            });
          });
          describe.skip("Hundred finance", () => {
            let results: IQuoteRepayResults;
            before(async function () {
              snapshotLocal = await TimeUtils.snapshot();
              const {controller} = await TetuConverterApp.buildApp(
                deployer,
                [new HundredFinancePlatformFabric()],
                {priceOracleFabric: async () => (await CoreContractsHelper.createPriceOracle(deployer, MaticAddresses.AAVE_V3_PRICE_ORACLE)).address} // disable swap, enable price oracle
              );
              results = await BorrowRepayUsesCase.makeQuoteRepay(deployer,
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
                controller,
                undefined,
                ADDITIONAL_AMOUNT_PASSED_TO_QUOTE_REPAY
              );
            });
            after(async function () {
              await TimeUtils.rollback(snapshotLocal);
            });
            it("should not exceed gas limits @skip-on-coverage", async () => {
              controlGasLimitsEx2(results.quoteRepayGasConsumption, GAS_LIMIT_QUOTE_REPAY_HUNDRED_FINANCE_WITH_SWAP, (u, t) => {
                expect(u).to.be.below(t + 1);
              });
            });
          });
        });
      });
    });
  });
//endregion Unit tests

});