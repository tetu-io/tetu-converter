import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {Aave3PlatformFabric} from "../baseUT/fabrics/Aave3PlatformFabric";
import {BorrowRepayUsesCase} from "../baseUT/uses-cases/BorrowRepayUsesCase";
import {isPolygonForkInUse} from "../baseUT/utils/NetworkUtils";
import {HundredFinancePlatformFabric} from "../baseUT/fabrics/HundredFinancePlatformFabric";
import {DForcePlatformFabric} from "../baseUT/fabrics/DForcePlatformFabric";
import {AaveTwoPlatformFabric} from "../baseUT/fabrics/AaveTwoPlatformFabric";
import {
  GAS_LIMIT_SINGLE_BORROW_SINGLE_REPAY_AAVE3_BORROW,
  GAS_LIMIT_SINGLE_BORROW_SINGLE_REPAY_AAVE3_REPAY,
  GAS_LIMIT_SINGLE_BORROW_SINGLE_REPAY_AAVE_TWO_BORROW,
  GAS_LIMIT_SINGLE_BORROW_SINGLE_REPAY_AAVE_TWO_REPAY,
  GAS_LIMIT_SINGLE_BORROW_SINGLE_REPAY_DFORCE_BORROW,
  GAS_LIMIT_SINGLE_BORROW_SINGLE_REPAY_DFORCE_REPAY,
  GAS_LIMIT_SINGLE_BORROW_SINGLE_REPAY_HUNDRED_FINANCE_BORROW,
  GAS_LIMIT_SINGLE_BORROW_SINGLE_REPAY_HUNDRED_FINANCE_REPAY, GAS_LIMIT_SINGLE_BORROW_SINGLE_REPAY_INITIALIZE_PA
} from "../baseUT/GasLimit";
import {controlGasLimitsEx} from "../../scripts/utils/hardhatUtils";

describe("BorrowRepayTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;
  let user4: SignerWithAddress;
  let user5: SignerWithAddress;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
    user1 = signers[2];
    user2 = signers[3];
    user3 = signers[4];
    user4 = signers[5];
    user5 = signers[6];
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
          const COUNT_BLOCKS = 10_000;
          describe("Mock", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const ret = await BorrowRepayUsesCase.makeTestSingleBorrowInstantRepay_Mock(deployer
                , {
                  collateral: {
                    asset: ASSET_COLLATERAL,
                    holders: HOLDER_COLLATERAL,
                    initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
                  }, borrow: {
                    asset: ASSET_BORROW,
                    holders: HOLDER_BORROW,
                    initialLiquidity: INITIAL_LIQUIDITY_BORROW,
                  }, collateralAmount: AMOUNT_COLLATERAL
                  , healthFactor2: HEALTH_FACTOR2
                  , countBlocks: COUNT_BLOCKS
                }, {
                  collateral: {
                    liquidity: INITIAL_LIQUIDITY_COLLATERAL * 2
                    , collateralFactor: 0.5
                    , borrowRate: getBigNumberFrom(1, 10)
                    , decimals: 6
                  }, borrow: {
                    liquidity: INITIAL_LIQUIDITY_COLLATERAL * 2
                    , collateralFactor: 0.8
                    , borrowRate: getBigNumberFrom(1, 8)
                    , decimals: 24
                  }
                }
              );
              expect(ret.sret).eq(ret.sexpected);
            });
          });
          describe("AAVE.v3", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const ret = await BorrowRepayUsesCase.makeTestSingleBorrowInstantRepay(deployer
                , {
                  collateral: {
                    asset: ASSET_COLLATERAL,
                    holders: HOLDER_COLLATERAL,
                    initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
                  }, borrow: {
                    asset: ASSET_BORROW,
                    holders: HOLDER_BORROW,
                    initialLiquidity: INITIAL_LIQUIDITY_BORROW,
                  }, collateralAmount: AMOUNT_COLLATERAL
                  , healthFactor2: HEALTH_FACTOR2
                  , countBlocks: COUNT_BLOCKS
                }, new Aave3PlatformFabric()
                , {}
              );
              expect(ret.sret).eq(ret.sexpected);
            });
          });
          describe("Hundred finance", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const ret = await BorrowRepayUsesCase.makeTestSingleBorrowInstantRepay(deployer
                , {
                  collateral: {
                    asset: ASSET_COLLATERAL,
                    holders: HOLDER_COLLATERAL,
                    initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
                  }, borrow: {
                    asset: ASSET_BORROW,
                    holders: HOLDER_BORROW,
                    initialLiquidity: INITIAL_LIQUIDITY_BORROW,
                  }, collateralAmount: AMOUNT_COLLATERAL
                  , healthFactor2: HEALTH_FACTOR2
                  , countBlocks: COUNT_BLOCKS
                }, new HundredFinancePlatformFabric()
                , {
                  resultCollateralCanBeLessThenInitial: true
                }
              );
              expect(ret.sret).eq(ret.sexpected);
            });
          });
          describe("dForce", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const ret = await BorrowRepayUsesCase.makeTestSingleBorrowInstantRepay(deployer
                , {
                  collateral: {
                    asset: ASSET_COLLATERAL,
                    holders: HOLDER_COLLATERAL,
                    initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
                  }, borrow: {
                    asset: ASSET_BORROW,
                    holders: HOLDER_BORROW,
                    initialLiquidity: INITIAL_LIQUIDITY_BORROW,
                  }, collateralAmount: AMOUNT_COLLATERAL
                  , healthFactor2: HEALTH_FACTOR2
                  , countBlocks: COUNT_BLOCKS
                }, new DForcePlatformFabric()
                , {}
              );
              expect(ret.sret).eq(ret.sexpected);
            });
          });
          describe("AAVE.v2", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const ret = await BorrowRepayUsesCase.makeTestSingleBorrowInstantRepay(deployer
                , {
                  collateral: {
                    asset: ASSET_COLLATERAL,
                    holders: HOLDER_COLLATERAL,
                    initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
                  }, borrow: {
                    asset: ASSET_BORROW,
                    holders: HOLDER_BORROW,
                    initialLiquidity: INITIAL_LIQUIDITY_BORROW,
                  }, collateralAmount: AMOUNT_COLLATERAL
                  , healthFactor2: HEALTH_FACTOR2
                  , countBlocks: COUNT_BLOCKS
                }, new AaveTwoPlatformFabric()
                , {}
              );
              expect(ret.sret).eq(ret.sexpected);
            });
          });
        });
        describe("Dai=>Matic", () => {
          const ASSET_COLLATERAL = MaticAddresses.DAI;
          const HOLDER_COLLATERAL = MaticAddresses.HOLDER_DAI;
          const ASSET_BORROW = MaticAddresses.WMATIC;
          const HOLDER_BORROW = MaticAddresses.HOLDER_WMATIC;
          const AMOUNT_COLLATERAL = 1_000;
          const INITIAL_LIQUIDITY_COLLATERAL = 10_000;
          const INITIAL_LIQUIDITY_BORROW = 80_000;
          const HEALTH_FACTOR2 = 200;
          const COUNT_BLOCKS = 1;
          describe("Mock", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const ret = await BorrowRepayUsesCase.makeTestSingleBorrowInstantRepay_Mock(deployer
                , {
                  collateral: {
                    asset: ASSET_COLLATERAL,
                    holders: HOLDER_COLLATERAL,
                    initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
                  }, borrow: {
                    asset: ASSET_BORROW,
                    holders: HOLDER_BORROW,
                    initialLiquidity: INITIAL_LIQUIDITY_BORROW,
                  }, collateralAmount: AMOUNT_COLLATERAL
                  , healthFactor2: HEALTH_FACTOR2
                  , countBlocks: COUNT_BLOCKS
                }, {
                  collateral: {
                    liquidity: INITIAL_LIQUIDITY_COLLATERAL * 10
                    , collateralFactor: 0.5
                    , borrowRate: getBigNumberFrom(1, 10)
                    , decimals: 6
                  }, borrow: {
                    liquidity: INITIAL_LIQUIDITY_COLLATERAL * 10
                    , collateralFactor: 0.8
                    , borrowRate: getBigNumberFrom(1, 8)
                    , decimals: 24
                  }
                }
              );
              expect(ret.sret).eq(ret.sexpected);
            });
          });
          describe("AAVE.v3", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const ret = await BorrowRepayUsesCase.makeTestSingleBorrowInstantRepay(deployer
                , {
                  collateral: {
                    asset: ASSET_COLLATERAL,
                    holders: HOLDER_COLLATERAL,
                    initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
                  }, borrow: {
                    asset: ASSET_BORROW,
                    holders: HOLDER_BORROW,
                    initialLiquidity: INITIAL_LIQUIDITY_BORROW,
                  }, collateralAmount: AMOUNT_COLLATERAL
                  , healthFactor2: HEALTH_FACTOR2
                  , countBlocks: COUNT_BLOCKS
                }, new Aave3PlatformFabric()
                , {}
              );
              expect(ret.sret).eq(ret.sexpected);
            });
          });
          describe("Hundred finance", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const ret = await BorrowRepayUsesCase.makeTestSingleBorrowInstantRepay(deployer
                , {
                  collateral: {
                    asset: ASSET_COLLATERAL,
                    holders: HOLDER_COLLATERAL,
                    initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
                  }, borrow: {
                    asset: ASSET_BORROW,
                    holders: HOLDER_BORROW,
                    initialLiquidity: INITIAL_LIQUIDITY_BORROW,
                  }, collateralAmount: AMOUNT_COLLATERAL
                  , healthFactor2: HEALTH_FACTOR2
                  , countBlocks: COUNT_BLOCKS
                }, new HundredFinancePlatformFabric()
                , {}
              );
              expect(ret.sret).eq(ret.sexpected);
            });
          });
          describe("dForce", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const ret = await BorrowRepayUsesCase.makeTestSingleBorrowInstantRepay(deployer
                , {
                  collateral: {
                    asset: ASSET_COLLATERAL,
                    holders: HOLDER_COLLATERAL,
                    initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
                  }, borrow: {
                    asset: ASSET_BORROW,
                    holders: HOLDER_BORROW,
                    initialLiquidity: INITIAL_LIQUIDITY_BORROW,
                  }, collateralAmount: AMOUNT_COLLATERAL
                  , healthFactor2: HEALTH_FACTOR2
                  , countBlocks: COUNT_BLOCKS
                }, new DForcePlatformFabric()
                , {}
              );
              expect(ret.sret).eq(ret.sexpected);
            });
          });
          describe("AAVE.v2", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const ret = await BorrowRepayUsesCase.makeTestSingleBorrowInstantRepay(deployer
                , {
                  collateral: {
                    asset: ASSET_COLLATERAL,
                    holders: HOLDER_COLLATERAL,
                    initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
                  }, borrow: {
                    asset: ASSET_BORROW,
                    holders: HOLDER_BORROW,
                    initialLiquidity: INITIAL_LIQUIDITY_BORROW,
                  }, collateralAmount: AMOUNT_COLLATERAL
                  , healthFactor2: HEALTH_FACTOR2
                  , countBlocks: COUNT_BLOCKS
                }, new AaveTwoPlatformFabric()
                , {}
              );
              expect(ret.sret).eq(ret.sexpected);
            });
          });
        });
        describe("Matic=>USDC", () => {
          const ASSET_COLLATERAL = MaticAddresses.WMATIC;
          const HOLDER_COLLATERAL = MaticAddresses.HOLDER_WMATIC;
          const ASSET_BORROW = MaticAddresses.USDC;
          const HOLDER_BORROW = MaticAddresses.HOLDER_USDC;
          const AMOUNT_COLLATERAL = 1_000;
          const INITIAL_LIQUIDITY_COLLATERAL = 1_000_000;
          const INITIAL_LIQUIDITY_BORROW = 80_000;
          const HEALTH_FACTOR2 = 200;
          const COUNT_BLOCKS = 1;
          describe("Mock", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const ret = await BorrowRepayUsesCase.makeTestSingleBorrowInstantRepay_Mock(deployer
                , {
                  collateral: {
                    asset: ASSET_COLLATERAL,
                    holders: HOLDER_COLLATERAL,
                    initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
                  }, borrow: {
                    asset: ASSET_BORROW,
                    holders: HOLDER_BORROW,
                    initialLiquidity: INITIAL_LIQUIDITY_BORROW,
                  }, collateralAmount: AMOUNT_COLLATERAL
                  , healthFactor2: HEALTH_FACTOR2
                  , countBlocks: COUNT_BLOCKS
                }, {
                  collateral: {
                    liquidity: INITIAL_LIQUIDITY_COLLATERAL * 10
                    , collateralFactor: 0.5
                    , borrowRate: getBigNumberFrom(1, 10)
                    , decimals: 6
                  }, borrow: {
                    liquidity: INITIAL_LIQUIDITY_COLLATERAL * 10
                    , collateralFactor: 0.8
                    , borrowRate: getBigNumberFrom(1, 8)
                    , decimals: 24
                  }
                }
              );
              expect(ret.sret).eq(ret.sexpected);
            });
          });
          describe("AAVE.v3", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const ret = await BorrowRepayUsesCase.makeTestSingleBorrowInstantRepay(deployer
                , {
                  collateral: {
                    asset: ASSET_COLLATERAL,
                    holders: HOLDER_COLLATERAL,
                    initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
                  }, borrow: {
                    asset: ASSET_BORROW,
                    holders: HOLDER_BORROW,
                    initialLiquidity: INITIAL_LIQUIDITY_BORROW,
                  }, collateralAmount: AMOUNT_COLLATERAL
                  , healthFactor2: HEALTH_FACTOR2
                  , countBlocks: COUNT_BLOCKS
                }, new Aave3PlatformFabric()
                , {
                  resultCollateralCanBeLessThenInitial: false
                }
              );
              expect(ret.sret).eq(ret.sexpected);
            });
          });
          describe("Hundred finance", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const ret = await BorrowRepayUsesCase.makeTestSingleBorrowInstantRepay(deployer
                , {
                  collateral: {
                    asset: ASSET_COLLATERAL,
                    holders: HOLDER_COLLATERAL,
                    initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
                  }, borrow: {
                    asset: ASSET_BORROW,
                    holders: HOLDER_BORROW,
                    initialLiquidity: INITIAL_LIQUIDITY_BORROW,
                  }, collateralAmount: AMOUNT_COLLATERAL
                  , healthFactor2: HEALTH_FACTOR2
                  , countBlocks: COUNT_BLOCKS
                }, new HundredFinancePlatformFabric()
                , {
                  resultCollateralCanBeLessThenInitial: true
                }
              );
              expect(ret.sret).eq(ret.sexpected);
            });
          });
          describe("dForce", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const ret = await BorrowRepayUsesCase.makeTestSingleBorrowInstantRepay(deployer
                , {
                  collateral: {
                    asset: ASSET_COLLATERAL,
                    holders: HOLDER_COLLATERAL,
                    initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
                  }, borrow: {
                    asset: ASSET_BORROW,
                    holders: HOLDER_BORROW,
                    initialLiquidity: INITIAL_LIQUIDITY_BORROW,
                  }, collateralAmount: AMOUNT_COLLATERAL
                  , healthFactor2: HEALTH_FACTOR2
                  , countBlocks: COUNT_BLOCKS
                }, new DForcePlatformFabric()
                , {
                  resultCollateralCanBeLessThenInitial: false
                }
              );
              expect(ret.sret).eq(ret.sexpected);
            });
          });
          describe("AAVE.v2", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const ret = await BorrowRepayUsesCase.makeTestSingleBorrowInstantRepay(deployer
                , {
                  collateral: {
                    asset: ASSET_COLLATERAL,
                    holders: HOLDER_COLLATERAL,
                    initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
                  }, borrow: {
                    asset: ASSET_BORROW,
                    holders: HOLDER_BORROW,
                    initialLiquidity: INITIAL_LIQUIDITY_BORROW,
                  }, collateralAmount: AMOUNT_COLLATERAL
                  , healthFactor2: HEALTH_FACTOR2
                  , countBlocks: COUNT_BLOCKS
                }, new AaveTwoPlatformFabric()
                , {
                  resultCollateralCanBeLessThenInitial: false
                }
              );
              expect(ret.sret).eq(ret.sexpected);
            });
          });
        });
        describe("USDC=>USDT", () => {
          const ASSET_COLLATERAL = MaticAddresses.USDC;
          const HOLDER_COLLATERAL = MaticAddresses.HOLDER_USDC;
          const ASSET_BORROW = MaticAddresses.USDT;
          const HOLDER_BORROW = MaticAddresses.HOLDER_USDT;
          const AMOUNT_COLLATERAL = 100_000;
          const INITIAL_LIQUIDITY_COLLATERAL = 1_000_000;
          const INITIAL_LIQUIDITY_BORROW = 80_000;
          const HEALTH_FACTOR2 = 200;
          const COUNT_BLOCKS = 1;
          describe("Mock", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const ret = await BorrowRepayUsesCase.makeTestSingleBorrowInstantRepay_Mock(deployer
                , {
                  collateral: {
                    asset: ASSET_COLLATERAL,
                    holders: HOLDER_COLLATERAL,
                    initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
                  }, borrow: {
                    asset: ASSET_BORROW,
                    holders: HOLDER_BORROW,
                    initialLiquidity: INITIAL_LIQUIDITY_BORROW,
                  }, collateralAmount: AMOUNT_COLLATERAL
                  , healthFactor2: HEALTH_FACTOR2
                  , countBlocks: COUNT_BLOCKS
                }, {
                  collateral: {
                    liquidity: INITIAL_LIQUIDITY_COLLATERAL * 10
                    , collateralFactor: 0.5
                    , borrowRate: getBigNumberFrom(1, 10)
                    , decimals: 6
                  }, borrow: {
                    liquidity: INITIAL_LIQUIDITY_COLLATERAL * 10
                    , collateralFactor: 0.8
                    , borrowRate: getBigNumberFrom(1, 8)
                    , decimals: 24
                  }
                }
              );
              expect(ret.sret).eq(ret.sexpected);
            });
          });
          describe("AAVE.v3", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const ret = await BorrowRepayUsesCase.makeTestSingleBorrowInstantRepay(deployer
                , {
                  collateral: {
                    asset: ASSET_COLLATERAL,
                    holders: HOLDER_COLLATERAL,
                    initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
                  }, borrow: {
                    asset: ASSET_BORROW,
                    holders: HOLDER_BORROW,
                    initialLiquidity: INITIAL_LIQUIDITY_BORROW,
                  }, collateralAmount: AMOUNT_COLLATERAL
                  , healthFactor2: HEALTH_FACTOR2
                  , countBlocks: COUNT_BLOCKS
                }, new Aave3PlatformFabric()
                , {
                  resultCollateralCanBeLessThenInitial: false
                }
              );
              expect(ret.sret).eq(ret.sexpected);
            });
          });
          describe("Hundred finance", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const ret = await BorrowRepayUsesCase.makeTestSingleBorrowInstantRepay(deployer
                , {
                  collateral: {
                    asset: ASSET_COLLATERAL,
                    holders: HOLDER_COLLATERAL,
                    initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
                  }, borrow: {
                    asset: ASSET_BORROW,
                    holders: HOLDER_BORROW,
                    initialLiquidity: INITIAL_LIQUIDITY_BORROW,
                  }, collateralAmount: AMOUNT_COLLATERAL
                  , healthFactor2: HEALTH_FACTOR2
                  , countBlocks: COUNT_BLOCKS
                }, new HundredFinancePlatformFabric()
                , {
                  resultCollateralCanBeLessThenInitial: true
                }
              );
              expect(ret.sret).eq(ret.sexpected);
            });
          });
          describe("dForce", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const ret = await BorrowRepayUsesCase.makeTestSingleBorrowInstantRepay(deployer
                , {
                  collateral: {
                    asset: ASSET_COLLATERAL,
                    holders: HOLDER_COLLATERAL,
                    initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
                  }, borrow: {
                    asset: ASSET_BORROW,
                    holders: HOLDER_BORROW,
                    initialLiquidity: INITIAL_LIQUIDITY_BORROW,
                  }, collateralAmount: AMOUNT_COLLATERAL
                  , healthFactor2: HEALTH_FACTOR2
                  , countBlocks: COUNT_BLOCKS
                }, new DForcePlatformFabric()
                , {
                  resultCollateralCanBeLessThenInitial: false
                }
              );
              expect(ret.sret).eq(ret.sexpected);
            });
          });
          describe("AAVE.v2", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const ret = await BorrowRepayUsesCase.makeTestSingleBorrowInstantRepay(deployer
                , {
                  collateral: {
                    asset: ASSET_COLLATERAL,
                    holders: HOLDER_COLLATERAL,
                    initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
                  }, borrow: {
                    asset: ASSET_BORROW,
                    holders: HOLDER_BORROW,
                    initialLiquidity: INITIAL_LIQUIDITY_BORROW,
                  }, collateralAmount: AMOUNT_COLLATERAL
                  , healthFactor2: HEALTH_FACTOR2
                  , countBlocks: COUNT_BLOCKS
                }, new AaveTwoPlatformFabric()
                , {
                  resultCollateralCanBeLessThenInitial: false
                }
              );
              expect(ret.sret).eq(ret.sexpected);
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
          const INITIAL_LIQUIDITY_COLLATERAL = 100_000;
          const INITIAL_LIQUIDITY_BORROW = 80_000;
          const HEALTH_FACTOR2 = 200;
          const COUNT_BLOCKS = 1;
          const DELTA_BLOCKS_BORROW = 100;
          const DELTA_BLOCKS_REPAY = 10;
          describe("Mock", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const ret = await BorrowRepayUsesCase.makeTestTwoBorrowsTwoRepays_Mock(deployer
                , {
                  collateral: {
                    asset: ASSET_COLLATERAL,
                    holders: HOLDER_COLLATERAL,
                    initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
                  }, borrow: {
                    asset: ASSET_BORROW,
                    holders: HOLDER_BORROW,
                    initialLiquidity: INITIAL_LIQUIDITY_BORROW,
                  }, collateralAmount: AMOUNT_COLLATERAL
                  , healthFactor2: HEALTH_FACTOR2
                  , countBlocks: COUNT_BLOCKS
                  , collateralAmount2: AMOUNT_COLLATERAL2
                  , deltaBlocksBetweenBorrows: DELTA_BLOCKS_BORROW
                  , deltaBlocksBetweenRepays: DELTA_BLOCKS_REPAY
                  , repayAmount1: AMOUNT_REPAY1
                }, {
                  collateral: {
                    liquidity: INITIAL_LIQUIDITY_COLLATERAL * 2
                    , collateralFactor: 0.5
                    , borrowRate: getBigNumberFrom(1, 10)
                    , decimals: 6
                  }, borrow: {
                    liquidity: INITIAL_LIQUIDITY_COLLATERAL * 2
                    , collateralFactor: 0.8
                    , borrowRate: getBigNumberFrom(1, 8)
                    , decimals: 24
                  }
                }
              );
              expect(ret.sret).eq(ret.sexpected);
            });
          });
          describe("AAVE.v3", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const ret = await BorrowRepayUsesCase.makeTestTwoBorrowsTwoRepays(deployer
                , {
                  collateral: {
                    asset: ASSET_COLLATERAL,
                    holders: HOLDER_COLLATERAL,
                    initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
                  }, borrow: {
                    asset: ASSET_BORROW,
                    holders: HOLDER_BORROW,
                    initialLiquidity: INITIAL_LIQUIDITY_BORROW,
                  }, collateralAmount: AMOUNT_COLLATERAL
                  , healthFactor2: HEALTH_FACTOR2
                  , countBlocks: COUNT_BLOCKS
                  , collateralAmount2: AMOUNT_COLLATERAL2
                  , deltaBlocksBetweenBorrows: DELTA_BLOCKS_BORROW
                  , deltaBlocksBetweenRepays: DELTA_BLOCKS_REPAY
                  , repayAmount1: AMOUNT_REPAY1
                }, new Aave3PlatformFabric()
                , {
                  resultCollateralCanBeLessThenInitial: false
                }
              );
              expect(ret.sret).eq(ret.sexpected);
            });
          });
          describe("Hundred finance", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const ret = await BorrowRepayUsesCase.makeTestTwoBorrowsTwoRepays(deployer
                , {
                  collateral: {
                    asset: ASSET_COLLATERAL,
                    holders: HOLDER_COLLATERAL,
                    initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
                  }, borrow: {
                    asset: ASSET_BORROW,
                    holders: HOLDER_BORROW,
                    initialLiquidity: INITIAL_LIQUIDITY_BORROW,
                  }, collateralAmount: AMOUNT_COLLATERAL
                  , healthFactor2: HEALTH_FACTOR2
                  , countBlocks: COUNT_BLOCKS
                  , collateralAmount2: AMOUNT_COLLATERAL2
                  , deltaBlocksBetweenBorrows: DELTA_BLOCKS_BORROW
                  , deltaBlocksBetweenRepays: DELTA_BLOCKS_REPAY
                  , repayAmount1: AMOUNT_REPAY1
                }, new HundredFinancePlatformFabric()
                , {
                  resultCollateralCanBeLessThenInitial: false
                }
              );
              expect(ret.sret).eq(ret.sexpected);
            });
          });
          describe("dForce", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const ret = await BorrowRepayUsesCase.makeTestTwoBorrowsTwoRepays(deployer
                , {
                  collateral: {
                    asset: ASSET_COLLATERAL,
                    holders: HOLDER_COLLATERAL,
                    initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
                  }, borrow: {
                    asset: ASSET_BORROW,
                    holders: HOLDER_BORROW,
                    initialLiquidity: INITIAL_LIQUIDITY_BORROW,
                  }, collateralAmount: AMOUNT_COLLATERAL
                  , healthFactor2: HEALTH_FACTOR2
                  , countBlocks: COUNT_BLOCKS
                  , collateralAmount2: AMOUNT_COLLATERAL2
                  , deltaBlocksBetweenBorrows: DELTA_BLOCKS_BORROW
                  , deltaBlocksBetweenRepays: DELTA_BLOCKS_REPAY
                  , repayAmount1: AMOUNT_REPAY1
                }, new DForcePlatformFabric()
                , {
                  resultCollateralCanBeLessThenInitial: false
                }
              );
              expect(ret.sret).eq(ret.sexpected);
            });
          });
          describe("AAVE.v2", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const ret = await BorrowRepayUsesCase.makeTestTwoBorrowsTwoRepays(deployer
                , {
                  collateral: {
                    asset: ASSET_COLLATERAL,
                    holders: HOLDER_COLLATERAL,
                    initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
                  }, borrow: {
                    asset: ASSET_BORROW,
                    holders: HOLDER_BORROW,
                    initialLiquidity: INITIAL_LIQUIDITY_BORROW,
                  }, collateralAmount: AMOUNT_COLLATERAL
                  , healthFactor2: HEALTH_FACTOR2
                  , countBlocks: COUNT_BLOCKS
                  , collateralAmount2: AMOUNT_COLLATERAL2
                  , deltaBlocksBetweenBorrows: DELTA_BLOCKS_BORROW
                  , deltaBlocksBetweenRepays: DELTA_BLOCKS_REPAY
                  , repayAmount1: AMOUNT_REPAY1
                }, new AaveTwoPlatformFabric()
                , {
                  resultCollateralCanBeLessThenInitial: false
                }
              );
              expect(ret.sret).eq(ret.sexpected);
            });
          });
        });
      });

      describe("Check gas limits - single borrow, single instant complete repay", () => {
        describe("Dai=>USDC", () => {
          const ASSET_COLLATERAL = MaticAddresses.DAI;
          const HOLDER_COLLATERAL = MaticAddresses.HOLDER_DAI;
          const ASSET_BORROW = MaticAddresses.USDC;
          const HOLDER_BORROW = MaticAddresses.HOLDER_USDC;
          const AMOUNT_COLLATERAL = 1_000;
          const INITIAL_LIQUIDITY_COLLATERAL = 100_000;
          const INITIAL_LIQUIDITY_BORROW = 80_000;
          const HEALTH_FACTOR2 = 200;
          const COUNT_BLOCKS = 1;
          describe("AAVE.v3", () => {
            it("should not exceed gas limit", async () => {

              const r = await BorrowRepayUsesCase.makeTestSingleBorrowInstantRepay(deployer
                , {
                  collateral: {
                    asset: ASSET_COLLATERAL,
                    holders: HOLDER_COLLATERAL,
                    initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
                  }, borrow: {
                    asset: ASSET_BORROW,
                    holders: HOLDER_BORROW,
                    initialLiquidity: INITIAL_LIQUIDITY_BORROW,
                  }, collateralAmount: AMOUNT_COLLATERAL
                  , healthFactor2: HEALTH_FACTOR2
                  , countBlocks: COUNT_BLOCKS
                }, new Aave3PlatformFabric()
                , {}
                , true
              );
              controlGasLimitsEx(r.gasUsedByPaInitialization!, GAS_LIMIT_SINGLE_BORROW_SINGLE_REPAY_INITIALIZE_PA, (u, t) => {
                expect(u).to.be.below(t);
              });
              controlGasLimitsEx(r.gasUsedByBorrow!, GAS_LIMIT_SINGLE_BORROW_SINGLE_REPAY_AAVE3_BORROW, (u, t) => {
                expect(u).to.be.below(t);
              });
              controlGasLimitsEx(r.gasUsedByRepay!, GAS_LIMIT_SINGLE_BORROW_SINGLE_REPAY_AAVE3_REPAY, (u, t) => {
                expect(u).to.be.below(t);
              });
            });
          });
          describe("Hundred finance", () => {
            it("should not exceed gas limit", async () => {
              if (!await isPolygonForkInUse()) return;
              const r = await BorrowRepayUsesCase.makeTestSingleBorrowInstantRepay(deployer
                , {
                  collateral: {
                    asset: ASSET_COLLATERAL,
                    holders: HOLDER_COLLATERAL,
                    initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
                  }, borrow: {
                    asset: ASSET_BORROW,
                    holders: HOLDER_BORROW,
                    initialLiquidity: INITIAL_LIQUIDITY_BORROW,
                  }, collateralAmount: AMOUNT_COLLATERAL
                  , healthFactor2: HEALTH_FACTOR2
                  , countBlocks: COUNT_BLOCKS
                }, new HundredFinancePlatformFabric()
                , {
                  resultCollateralCanBeLessThenInitial: true
                }
                , true
              );
              controlGasLimitsEx(r.gasUsedByPaInitialization!, GAS_LIMIT_SINGLE_BORROW_SINGLE_REPAY_INITIALIZE_PA, (u, t) => {
                expect(u).to.be.below(t);
              });
              controlGasLimitsEx(r.gasUsedByBorrow!, GAS_LIMIT_SINGLE_BORROW_SINGLE_REPAY_HUNDRED_FINANCE_BORROW, (u, t) => {
                expect(u).to.be.below(t);
              });
              controlGasLimitsEx(r.gasUsedByRepay!, GAS_LIMIT_SINGLE_BORROW_SINGLE_REPAY_HUNDRED_FINANCE_REPAY, (u, t) => {
                expect(u).to.be.below(t);
              });
            });
          });
          describe("dForce", () => {
            it("should not exceed gas limit", async () => {
              if (!await isPolygonForkInUse()) return;
              const r = await BorrowRepayUsesCase.makeTestSingleBorrowInstantRepay(deployer
                , {
                  collateral: {
                    asset: ASSET_COLLATERAL,
                    holders: HOLDER_COLLATERAL,
                    initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
                  }, borrow: {
                    asset: ASSET_BORROW,
                    holders: HOLDER_BORROW,
                    initialLiquidity: INITIAL_LIQUIDITY_BORROW,
                  }, collateralAmount: AMOUNT_COLLATERAL
                  , healthFactor2: HEALTH_FACTOR2
                  , countBlocks: COUNT_BLOCKS
                }, new DForcePlatformFabric()
                , {}
                , true
              );
              controlGasLimitsEx(r.gasUsedByPaInitialization!, GAS_LIMIT_SINGLE_BORROW_SINGLE_REPAY_INITIALIZE_PA, (u, t) => {
                expect(u).to.be.below(t);
              });
              controlGasLimitsEx(r.gasUsedByBorrow!, GAS_LIMIT_SINGLE_BORROW_SINGLE_REPAY_DFORCE_BORROW, (u, t) => {
                expect(u).to.be.below(t);
              });
              controlGasLimitsEx(r.gasUsedByRepay!, GAS_LIMIT_SINGLE_BORROW_SINGLE_REPAY_DFORCE_REPAY, (u, t) => {
                expect(u).to.be.below(t);
              });
            });
          });
          describe("AAVE.v2", () => {
            it("should not exceed gas limit", async () => {
              if (!await isPolygonForkInUse()) return;
              const r = await BorrowRepayUsesCase.makeTestSingleBorrowInstantRepay(deployer
                , {
                  collateral: {
                    asset: ASSET_COLLATERAL,
                    holders: HOLDER_COLLATERAL,
                    initialLiquidity: INITIAL_LIQUIDITY_COLLATERAL,
                  }, borrow: {
                    asset: ASSET_BORROW,
                    holders: HOLDER_BORROW,
                    initialLiquidity: INITIAL_LIQUIDITY_BORROW,
                  }, collateralAmount: AMOUNT_COLLATERAL
                  , healthFactor2: HEALTH_FACTOR2
                  , countBlocks: COUNT_BLOCKS
                }, new AaveTwoPlatformFabric()
                , {}
                , true
              );
              controlGasLimitsEx(r.gasUsedByPaInitialization!, GAS_LIMIT_SINGLE_BORROW_SINGLE_REPAY_INITIALIZE_PA, (u, t) => {
                expect(u).to.be.below(t);
              });
              controlGasLimitsEx(r.gasUsedByBorrow!, GAS_LIMIT_SINGLE_BORROW_SINGLE_REPAY_AAVE_TWO_BORROW, (u, t) => {
                expect(u).to.be.below(t);
              });
              controlGasLimitsEx(r.gasUsedByRepay!, GAS_LIMIT_SINGLE_BORROW_SINGLE_REPAY_AAVE_TWO_REPAY, (u, t) => {
                expect(u).to.be.below(t);
              });
            });
          });
        });
      });
    });
    describe("Bad paths", () => {
    });
  });
//endregion Unit tests

});