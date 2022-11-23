import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {Aave3PlatformFabric} from "../baseUT/fabrics/Aave3PlatformFabric";
import {BorrowRepayUsesCase, IMakeTestSingleBorrowInstantRepayResults} from "../baseUT/uses-cases/BorrowRepayUsesCase";
import {isPolygonForkInUse} from "../baseUT/utils/NetworkUtils";
import {HundredFinancePlatformFabric} from "../baseUT/fabrics/HundredFinancePlatformFabric";
import {DForcePlatformFabric} from "../baseUT/fabrics/DForcePlatformFabric";
import {AaveTwoPlatformFabric} from "../baseUT/fabrics/AaveTwoPlatformFabric";
import {
  GAS_LIMIT_INIT_BORROW_AAVE3,
  GAS_LIMIT_REPAY_AAVE3,
  GAS_LIMIT_INIT_BORROW_AAVE_TWO,
  GAS_LIMIT_REPAY_AAVE_TWO,
  GAS_LIMIT_INIT_BORROW_DFORCE,
  GAS_LIMIT_REPAY_DFORCE,
  GAS_LIMIT_INIT_BORROW_HUNDRED_FINANCE,
  GAS_LIMIT_REPAY_HUNDRED_FINANCE
} from "../baseUT/GasLimit";
import {controlGasLimitsEx} from "../../scripts/utils/hardhatUtils";

describe("BorrowRepayTest", () => {
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
  describe("Borrow & repay", async () => {
    describe("Good paths", () => {
      describe("Single borrow, single instant complete repay", () => {
        describe("Dai=>USDC", () => {
          const ASSET_COLLATERAL = MaticAddresses.DAI;
          const HOLDER_COLLATERAL = MaticAddresses.HOLDER_DAI;
          const ASSET_BORROW = MaticAddresses.USDC;
          const HOLDER_BORROW = MaticAddresses.HOLDER_USDC;
          const AMOUNT_COLLATERAL = 1_000;
          const INITIAL_LIQUIDITY_COLLATERAL = 100_000;
          const INITIAL_LIQUIDITY_BORROW = 80_000;
          const HEALTH_FACTOR2 = 200;
          const COUNT_BLOCKS = 1_000;
          describe("Mock", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const ret = await BorrowRepayUsesCase.makeTestSingleBorrowInstantRepay_Mock(deployer,
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
                  countBlocks: COUNT_BLOCKS
                }, {
                  collateral: {
                    liquidity: INITIAL_LIQUIDITY_COLLATERAL * 2,
                    collateralFactor: 0.5,
                    borrowRate: getBigNumberFrom(1, 10),
                    decimals: 6
                  },
                  borrow: {
                    liquidity: INITIAL_LIQUIDITY_COLLATERAL * 2,
                    collateralFactor: 0.8,
                    borrowRate: getBigNumberFrom(1, 8),
                    decimals: 24
                  }
                }
              );
              expect(ret.sret).eq(ret.sexpected);
            });
          });
          describe("AAVE3", () => {
            let results: IMakeTestSingleBorrowInstantRepayResults;
            before(async function () {
              results = await BorrowRepayUsesCase.makeTestSingleBorrowInstantRepay(deployer,
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
                new Aave3PlatformFabric(),
                {},
              );
            });
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              expect(results.sret).eq(results.sexpected);
            });
            it("should not exceed gas limits", async () => {
              controlGasLimitsEx(results.gasUsedByBorrow, GAS_LIMIT_INIT_BORROW_AAVE3, (u, t) => {
                expect(u).to.be.below(t + 1);
              });
              controlGasLimitsEx(results.gasUsedByRepay, GAS_LIMIT_REPAY_AAVE3, (u, t) => {
                expect(u).to.be.below(t + 1);
              });
            });
          });
          describe("AAVETwo", () => {
            let results: IMakeTestSingleBorrowInstantRepayResults;
            before(async function () {
              results = await BorrowRepayUsesCase.makeTestSingleBorrowInstantRepay(deployer,
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
                new AaveTwoPlatformFabric(),
                {},
              );
            });
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              expect(results.sret).eq(results.sexpected);
            });
            it("should not exceed gas limits", async () => {
              controlGasLimitsEx(results.gasUsedByBorrow, GAS_LIMIT_INIT_BORROW_AAVE_TWO, (u, t) => {
                expect(u).to.be.below(t + 1);
              });
              controlGasLimitsEx(results.gasUsedByRepay, GAS_LIMIT_REPAY_AAVE_TWO, (u, t) => {
                expect(u).to.be.below(t + 1);
              });
            });
          });
          describe("Hundred finance", () => {
            let results: IMakeTestSingleBorrowInstantRepayResults;
            before(async function () {
              results = await BorrowRepayUsesCase.makeTestSingleBorrowInstantRepay(deployer,
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
                new HundredFinancePlatformFabric(),
                {
                  resultCollateralCanBeLessThenInitial: true
                }
              );
            });
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              expect(results.sret).eq(results.sexpected);
            });
            it("should not exceed gas limits", async () => {
              controlGasLimitsEx(results.gasUsedByBorrow, GAS_LIMIT_INIT_BORROW_HUNDRED_FINANCE, (u, t) => {
                expect(u).to.be.below(t + 1);
              });
              controlGasLimitsEx(results.gasUsedByRepay, GAS_LIMIT_REPAY_HUNDRED_FINANCE, (u, t) => {
                expect(u).to.be.below(t + 1);
              });
            });
          });
          describe("dForce", () => {
            let results: IMakeTestSingleBorrowInstantRepayResults;
            before(async function () {
              results = await BorrowRepayUsesCase.makeTestSingleBorrowInstantRepay(deployer,
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
                new DForcePlatformFabric(),
                {}
              );
            });
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              expect(results.sret).eq(results.sexpected);
            });
            it("should not exceed gas limits", async () => {
              controlGasLimitsEx(results.gasUsedByBorrow, GAS_LIMIT_INIT_BORROW_DFORCE, (u, t) => {
                expect(u).to.be.below(t + 1);
              });
              controlGasLimitsEx(results.gasUsedByRepay, GAS_LIMIT_REPAY_DFORCE, (u, t) => {
                expect(u).to.be.below(t + 1);
              });
            });
          });
        });
      });

      describe("Borrow-time-borrow, repay-time-complete repay", () => {
        describe("Dai=>USDC", () => {
          const ASSET_COLLATERAL = MaticAddresses.DAI;
          const HOLDER_COLLATERAL = MaticAddresses.HOLDER_DAI;
          const ASSET_BORROW = MaticAddresses.USDC;
          const HOLDER_BORROW = MaticAddresses.HOLDER_USDC;
          const AMOUNT_COLLATERAL = 1_000;
          const AMOUNT_COLLATERAL2 = 3_000;
          const AMOUNT_REPAY1 = 10;
          const INITIAL_LIQUIDITY_COLLATERAL = 10_000;
          const INITIAL_LIQUIDITY_BORROW = 8_000;
          const HEALTH_FACTOR2 = 200;
          const COUNT_BLOCKS = 1;
          const DELTA_BLOCKS_BORROW = 100;
          const DELTA_BLOCKS_REPAY = 10;
          describe("Mock", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const ret = await BorrowRepayUsesCase.makeTestTwoBorrowsTwoRepays_Mock(deployer,
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
                  collateralAmount2: AMOUNT_COLLATERAL2,
                  deltaBlocksBetweenBorrows: DELTA_BLOCKS_BORROW,
                  deltaBlocksBetweenRepays: DELTA_BLOCKS_REPAY,
                  repayAmount1: AMOUNT_REPAY1
                }, {
                  collateral: {
                    liquidity: INITIAL_LIQUIDITY_COLLATERAL * 2,
                    collateralFactor: 0.5,
                    borrowRate: getBigNumberFrom(1, 10),
                    decimals: 6,
                  },
                  borrow: {
                    liquidity: INITIAL_LIQUIDITY_COLLATERAL * 2,
                    collateralFactor: 0.8,
                    borrowRate: getBigNumberFrom(1, 8),
                    decimals: 24
                  }
                }
              );
              expect(ret.sret).eq(ret.sexpected);
            });
          });
          describe("AAVE3", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const ret = await BorrowRepayUsesCase.makeTestTwoBorrowsTwoRepays(deployer,
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
                  collateralAmount2: AMOUNT_COLLATERAL2,
                  deltaBlocksBetweenBorrows: DELTA_BLOCKS_BORROW,
                  deltaBlocksBetweenRepays: DELTA_BLOCKS_REPAY,
                  repayAmount1: AMOUNT_REPAY1,
                }, new Aave3PlatformFabric(),
                {
                  resultCollateralCanBeLessThenInitial: false
                }
              );
              expect(ret.sret).eq(ret.sexpected);
            });
          });
          describe("AAVETwo", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const ret = await BorrowRepayUsesCase.makeTestTwoBorrowsTwoRepays(deployer,
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
                  collateralAmount2: AMOUNT_COLLATERAL2,
                  deltaBlocksBetweenBorrows: DELTA_BLOCKS_BORROW,
                  deltaBlocksBetweenRepays: DELTA_BLOCKS_REPAY,
                  repayAmount1: AMOUNT_REPAY1,
                }, new AaveTwoPlatformFabric(),
                {
                  resultCollateralCanBeLessThenInitial: false
                }
              );
              expect(ret.sret).eq(ret.sexpected);
            });
          });
          describe("dForce", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const ret = await BorrowRepayUsesCase.makeTestTwoBorrowsTwoRepays(deployer,
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
                  collateralAmount2: AMOUNT_COLLATERAL2,
                  deltaBlocksBetweenBorrows: DELTA_BLOCKS_BORROW,
                  deltaBlocksBetweenRepays: DELTA_BLOCKS_REPAY,
                  repayAmount1: AMOUNT_REPAY1,
                }, new DForcePlatformFabric(),
                {
                  resultCollateralCanBeLessThenInitial: false
                }
              );
              expect(ret.sret).eq(ret.sexpected);
            });
          });
          describe("Hundred finance", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const ret = await BorrowRepayUsesCase.makeTestTwoBorrowsTwoRepays(deployer,
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
                  collateralAmount2: AMOUNT_COLLATERAL2,
                  deltaBlocksBetweenBorrows: DELTA_BLOCKS_BORROW,
                  deltaBlocksBetweenRepays: DELTA_BLOCKS_REPAY,
                  repayAmount1: AMOUNT_REPAY1,
                }, new HundredFinancePlatformFabric(),
                {
                  resultCollateralCanBeLessThenInitial: false
                }
              );
              expect(ret.sret).eq(ret.sexpected);
            });
          });
        });
      });
    });
  });
//endregion Unit tests

});