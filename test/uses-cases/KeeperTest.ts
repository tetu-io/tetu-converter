import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {expect} from "chai";
import {Keeper} from "../baseUT/keeper/Keeper";
import {MocksHelper} from "../baseUT/helpers/MocksHelper";
import {TetuConverterApp} from "../baseUT/helpers/TetuConverterApp";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";
import {BorrowRepayUsesCase} from "../baseUT/uses-cases/BorrowRepayUsesCase";
import {BorrowAction} from "../baseUT/actions/BorrowAction";
import {TokenDataTypes} from "../baseUT/types/TokenDataTypes";
import {
  Aave3PoolAdapter__factory,
  Borrower,
  BorrowManager,
  BorrowManager__factory,
  Controller,
  DebtMonitor,
  DebtMonitor__factory,
  IDebtMonitor__factory,
  IERC20__factory,
  IPlatformAdapter__factory,
  IPoolAdapter__factory,
  ITetuConverter,
  LendingPlatformMock__factory,
  PoolAdapterMock__factory,
  TetuConverter__factory
} from "../../typechain";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {isPolygonForkInUse} from "../baseUT/utils/NetworkUtils";
import {IReConverter, ReConverterMock, ReConverterUsingPA} from "../baseUT/keeper/ReСonverters";
import {LendingPlatformManagerMock} from "../baseUT/keeper/LendingPlatformManagerMock";
import {PoolAdapterState01} from "../baseUT/keeper/ILendingPlatformManager";
import {ITestSingleBorrowParams} from "../baseUT/types/BorrowRepayDataTypes";
import {setInitialBalance} from "../baseUT/utils/CommonUtils";
import {LendingPlatformManagerAave3} from "../baseUT/keeper/LendingPlatformManagerAave3";
import {ILendingPlatformFabric} from "../baseUT/fabrics/ILendingPlatformFabric";
import {Aave3PlatformFabric} from "../baseUT/fabrics/Aave3PlatformFabric";
import {AaveTwoPlatformFabric} from "../baseUT/fabrics/AaveTwoPlatformFabric";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import {RepayAction} from "../baseUT/actions/RepayAction";
import {KeeperTestMockUtils} from "../baseUT/keeper/KeeperTestMockUtils";

describe("Keeper test", () => {
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

//region Utils
  async function getBorrowManager(signer: SignerWithAddress, controller: Controller) : Promise<BorrowManager> {
    return BorrowManager__factory.connect(await controller.borrowManager(), signer);
  }
  async function getDebtMonitor(signer: SignerWithAddress, controller: Controller) : Promise<DebtMonitor> {
    return DebtMonitor__factory.connect(await controller.debtMonitor(), signer);
  }
//endregion Utils

//region Tests implementations
  async function prepareToBorrow(
    p: ITestSingleBorrowParams,
    fabrics: ILendingPlatformFabric[]
  ) : Promise<{uc: Borrower, controller: Controller}> {
    console.log("prepareToBorrow.start");
    const collateralToken = await TokenDataTypes.Build(deployer, p.collateral.asset);
    const borrowToken = await TokenDataTypes.Build(deployer, p.borrow.asset);

    const {tc, controller} = await TetuConverterApp.buildApp(deployer, fabrics);
    const uc: Borrower = await MocksHelper.deployBorrower(deployer.address
      , controller
      , p.countBlocks
    );

    // transfer sufficient amount of collateral to the user
    await setInitialBalance(deployer
      , collateralToken.address
      , p.collateral.holder, p.collateral.initialLiquidity, uc.address);

    return {uc, controller};
  }

  async function makeSingleBorrow (
    p: ITestSingleBorrowParams,
    fabrics: ILendingPlatformFabric[]
  ) : Promise<{uc: Borrower, controller: Controller, poolAdapter: string}> {
    console.log("makeSingleBorrow.start");
    const {uc, controller} = await prepareToBorrow(p, fabrics);

    const collateralToken = await TokenDataTypes.Build(deployer, p.collateral.asset);
    const borrowToken = await TokenDataTypes.Build(deployer, p.borrow.asset);

    const collateralAmount = getBigNumberFrom(p.collateralAmount, collateralToken.decimals);

    // make borrow only
    await BorrowRepayUsesCase.makeBorrowRepayActions(deployer
      , uc
      , [
        new BorrowAction(
          collateralToken
          , collateralAmount
          , borrowToken
        )
      ]
    );

    const poolAdapters = await uc.getBorrows(collateralToken.address, borrowToken.address);
    const poolAdapter = poolAdapters[0];
    if (! poolAdapter) {
      throw new Error("pool adapter not found");
    }

    console.log("makeSingleBorrow.end", poolAdapters.length);
    return {uc, controller, poolAdapter};
  }

  /**
   * There are two pool adapters: PA1 and PA2
   * Find the best conversion strategy for borrow, i.e. PA1
   * Make max possible borrow using PA1 (and increase its BR)
   * Find conversion strategy for borrow. Now it should be PA2
   * Make borrow using PA2
   * Repay PA1 (and decrease its BR). Now PA1 is more profitable again.
   * Now the keeper should suggest to make reconversion.
   *
   * It doesn't matter what is PA1 and what is PA2, they can be AAVE3/Two or Two/3.
   */
  async function makeTestForReconversionAave3andTwo(
    reconverter: IReConverter,
    p: ITestSingleBorrowParams,
    collateralHolders: string[]
  ): Promise<{
    statusAfterMaxBorrow: string[],
    statusAfterSmallBorrow: string[],
    statusAfterRepayMaxBorrow: string[],
    statusAfterReconversion: string[]
  }> {
    const {uc, controller} = await prepareToBorrow(p, [
      new Aave3PlatformFabric(),
      new AaveTwoPlatformFabric()
    ]);

    const collateralToken = await TokenDataTypes.Build(deployer, p.collateral.asset);
    const borrowToken = await TokenDataTypes.Build(deployer, p.borrow.asset);
    const collateralAmount = getBigNumberFrom(p.collateralAmount, collateralToken.decimals);

    // create two pool adapters - one for aave3 (normal mode only) and one for aave2
    const bm = await getBorrowManager(deployer, controller);
    const poolAdapters01: string[] = [];
    for (let i = 0; i < 2; ++i) {
      const pa = IPlatformAdapter__factory.connect(await bm.platformAdaptersAt(i), deployer);
      const converter = (await pa.converters())[0];
      await bm.registerPoolAdapter(converter,
        uc.address,
        collateralToken.address,
        borrowToken.address
      );
      poolAdapters01.push(await bm.getPoolAdapter(converter,
        uc.address,
        collateralToken.address,
        borrowToken.address
      ));
    }
    const paAAVE3 = poolAdapters01[0];
    const paAAVETwo = poolAdapters01[1];
    console.log("Pool adapter AAVE3", paAAVE3);
    console.log("Pool adapter AAVETwo", paAAVETwo);

    // let's try to make borrow for all collateral amount that the holder have
    let collateralForMaxBorrow = await IERC20__factory.connect(p.collateral.asset, deployer)
      .balanceOf(p.collateral.holder);
    console.log("Holder's balance of collateral", collateralForMaxBorrow);
    await IERC20__factory.connect(p.collateral.asset
      , await DeployerUtils.startImpersonate(p.collateral.holder)
    ).transfer(uc.address, collateralForMaxBorrow.sub(collateralAmount));

    // Let's borrow max possible amount for provided collateral
    for (const h of collateralHolders) {
      const holderBalance = await IERC20__factory.connect(p.collateral.asset, deployer)
        .balanceOf(h);
      console.log("Holder's balance of collateral", holderBalance);
      await IERC20__factory.connect(p.collateral.asset
        , await DeployerUtils.startImpersonate(h)
      ).transfer(uc.address, holderBalance);
      collateralForMaxBorrow = collateralForMaxBorrow.add(holderBalance);
    }

    await BorrowRepayUsesCase.makeBorrowRepayActions(deployer, uc
      , [new BorrowAction(collateralToken, collateralForMaxBorrow, borrowToken)]
    );
    const statusAfterMaxBorrow = await uc.getBorrows(p.collateral.asset, p.borrow.asset);
    let statusAfterRepayMaxBorrow: string[] = [];

    // Let's make borrow again - now we should use different pool adapter
    await BorrowRepayUsesCase.makeBorrowRepayActions(deployer
      , uc
      , [
        new BorrowAction(
          collateralToken
          , collateralAmount
          , borrowToken
        )
      ]
    );
    const statusAfterSmallBorrow = await uc.getBorrows(p.collateral.asset, p.borrow.asset);

    // let's call keeper job twice: before and after modification of the platform state
    const dest: boolean[] = [];
    for (let i = 0; i < 2; ++i) {
      console.log("Run keeper, step", i);

      // create a keeper
      const keeper: Keeper = new Keeper(
        IDebtMonitor__factory.connect(await controller.debtMonitor(), deployer)
        , p.healthFactor2
        , p.countBlocks
        , reconverter
      );
      await keeper.makeKeeperJob(deployer);

      if (i === 0) {
        // modify platform state
        console.log("Modify platform state", i);

        // Let's repay first borrow
        await IERC20__factory.connect(p.borrow.asset
          , await DeployerUtils.startImpersonate(p.borrow.holder)
        ).transfer(uc.address
          , IERC20__factory.connect(p.borrow.asset, deployer).balanceOf(p.borrow.holder)
        );

        await BorrowRepayUsesCase.makeBorrowRepayActions(deployer
          , uc
          , [
            new RepayAction(
              collateralToken
              , borrowToken
              , undefined // complete repay
              , {
                repayFirstPositionOnly: true
              }
            )
          ]
        );

        statusAfterRepayMaxBorrow = await uc.getBorrows(p.collateral.asset, p.borrow.asset);
      }
    }

    const statusAfterReconversion = await uc.getBorrows(p.collateral.asset, p.borrow.asset);

    return {
      statusAfterMaxBorrow,
      statusAfterSmallBorrow,
      statusAfterRepayMaxBorrow,
      statusAfterReconversion
    };
  }
//endregion Tests implementations

//region Unit tests
  describe("Health checking", async () => {
    describe("Good paths", () => {
      describe("Health factor becomes below allowed minimum", () => {
        describe("DAI => USDC", () => {
//region Constants and utils
          const ASSET_COLLATERAL = MaticAddresses.DAI;
          const HOLDER_COLLATERAL = MaticAddresses.HOLDER_DAI;
          const ASSET_BORROW = MaticAddresses.USDC;
          const HOLDER_BORROW = MaticAddresses.HOLDER_USDC;
          const AMOUNT_COLLATERAL = 1_000;
          const INITIAL_LIQUIDITY_COLLATERAL = 100_000;
          const INITIAL_LIQUIDITY_BORROW = 80_000;
          const HEALTH_FACTOR2 = 200;
          const COUNT_BLOCKS = 1;

          async function makeTestForReconversionCall_Mock(
            platformStateModifierFabric: (
              uc: Borrower, tc: ITetuConverter, controller: Controller, poolAdapter: string
            ) => Promise<PoolAdapterState01>
          ): Promise<boolean[]> {
            // make a borrow
            const {uc, tc, controller, poolAdapter} = await KeeperTestMockUtils.makeSingleBorrow_Mock(
              deployer,
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
                  decimals: 24,
                }
              }
            );

            // create a keeper
            const reconverter = new ReConverterMock();
            const keeper: Keeper = new Keeper(
              IDebtMonitor__factory.connect(await controller.debtMonitor(), deployer)
              , HEALTH_FACTOR2
              , COUNT_BLOCKS
              , reconverter
            );

            // let's call keeper job twice: before and after modification of the platform state
            const dest: boolean[] = [];
            for (let i = 0; i < 2; ++i) {
              console.log("Run keeper, step", i);
              await keeper.makeKeeperJob(deployer);

              // ensure that re-conversion was called for the given poolAdapter
              const keeperResult = reconverter.ensureExpectedPA(poolAdapter);
              console.log("keeperResult", keeperResult);
              dest.push(keeperResult);

              if (i === 0) {
                // modify platform state
                console.log("Modify platform state", i);
                await platformStateModifierFabric(uc, tc, controller, poolAdapter);
              }
            }

            return dest;
          }
//endregion Constants and utils
          describe("Mock", () => {
            describe("Collateral factor is decreased to 10", () => {
              it("should call reconvert", async () => {
                if (!await isPolygonForkInUse()) return; // TODO: replace real DAI and USDC by own tokens

                const modifier = async (
                  uc: Borrower,
                  tc: ITetuConverter,
                  controller: Controller,
                  poolAdapter: string
                ) => {
                  const bm: BorrowManager = await getBorrowManager(deployer, controller);
                  const pa = IPoolAdapter__factory.connect(poolAdapter, deployer);

                  const m = new LendingPlatformManagerMock(
                    PoolAdapterMock__factory.connect(poolAdapter, deployer)
                    , LendingPlatformMock__factory.connect(
                      await bm.getPlatformAdapter((await pa.getConfig()).originConverter)
                      , deployer
                    )
                  );

                  return m.changeCollateralFactor(deployer, 10);
                };
                const ret = await makeTestForReconversionCall_Mock(modifier);
                const expected = [false, true];

                const sret = ret.join("\n");
                const sexpected = expected.join("\n");

                expect(sret).equal(sexpected);
              });
            });
            describe("Collateral price is decreased 10 times", () => {
              it("should call reconvert", async () => {
                if (!await isPolygonForkInUse()) return;

                const modifier = async (
                  uc: Borrower,
                  tc: ITetuConverter,
                  controller: Controller,
                  poolAdapter: string
                ) => {
                  const bm: BorrowManager = await getBorrowManager(deployer, controller);
                  const pa = IPoolAdapter__factory.connect(poolAdapter, deployer);

                  const m = new LendingPlatformManagerMock(
                    PoolAdapterMock__factory.connect(poolAdapter, deployer)
                    , LendingPlatformMock__factory.connect(
                      await bm.getPlatformAdapter((await pa.getConfig()).originConverter)
                      , deployer
                    )
                  );

                  return m.changeAssetPrice(deployer, ASSET_COLLATERAL, false, 10);
                };
                const ret = await makeTestForReconversionCall_Mock(modifier);
                const expected = [false, true];

                const sret = ret.join("\n");
                const sexpected = expected.join("\n");

                expect(sret).equal(sexpected);
              });
            });
            describe("Borrow price is increased 10 times", () => {
              it("should call reconvert", async () => {
                if (!await isPolygonForkInUse()) return;

                const modifier = async (
                  uc: Borrower,
                  tc: ITetuConverter,
                  controller: Controller,
                  poolAdapter: string
                ) => {
                  const bm: BorrowManager = await getBorrowManager(deployer, controller);
                  const pa = IPoolAdapter__factory.connect(poolAdapter, deployer);

                  const m = new LendingPlatformManagerMock(
                    PoolAdapterMock__factory.connect(poolAdapter, deployer)
                    , LendingPlatformMock__factory.connect(
                      await bm.getPlatformAdapter((await pa.getConfig()).originConverter)
                      , deployer
                    )
                  );

                  return m.changeAssetPrice(deployer, ASSET_BORROW, true, 10);
                };
                const ret = await makeTestForReconversionCall_Mock(modifier);
                const expected = [false, true];

                const sret = ret.join("\n");
                const sexpected = expected.join("\n");

                expect(sret).equal(sexpected);
              });
            });
          });
        });

        describe("DAI => WBTC", () => {
//region Constants and utils
          const ASSET_COLLATERAL = MaticAddresses.DAI;
          const HOLDER_COLLATERAL = MaticAddresses.HOLDER_DAI;
          const ASSET_BORROW = MaticAddresses.WBTC;
          const HOLDER_BORROW = MaticAddresses.HOLDER_WBTC;
          const AMOUNT_COLLATERAL = 1_000;
          const INITIAL_LIQUIDITY_COLLATERAL = 100_000;
          const INITIAL_LIQUIDITY_BORROW = 10;
          const HEALTH_FACTOR2 = 200;
          const COUNT_BLOCKS = 1;
          async function makeTestForReconversionCall(
            platformStateModifierFabric: (
              uc: Borrower, controller: Controller, poolAdapter: string
            ) => Promise<PoolAdapterState01>
          ): Promise<boolean[]> {
            // make a borrow
            const {uc, controller, poolAdapter} = await makeSingleBorrow(
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
              }, [new Aave3PlatformFabric()]
            );

            // create a keeper
            const reconverter = new ReConverterMock();
            const keeper: Keeper = new Keeper(
              IDebtMonitor__factory.connect(await controller.debtMonitor(), deployer)
              , HEALTH_FACTOR2
              , COUNT_BLOCKS
              , reconverter
            );

            // let's call keeper job twice: before and after modification of the platform state
            const dest: boolean[] = [];
            for (let i = 0; i < 2; ++i) {
              console.log("Run keeper, step", i);
              await keeper.makeKeeperJob(deployer);

              // ensure that re-conversion was called for the given poolAdapter
              const keeperResult = reconverter.ensureExpectedPA(poolAdapter);
              console.log("keeperResult", keeperResult);
              dest.push(keeperResult);

              if (i === 0) {
                // modify platform state
                console.log("Modify platform state", i);
                await platformStateModifierFabric(uc, controller, poolAdapter);
              }
            }

            return dest;
          }

          async function getLendingPlatformManagerAave3(
            uc: Borrower,
            controller: Controller,
            poolAdapter: string
          ): Promise<LendingPlatformManagerAave3> {
            return new LendingPlatformManagerAave3(
              await Aave3PoolAdapter__factory.connect(poolAdapter, deployer)
              , uc
              , TetuConverter__factory.connect(await controller.tetuConverter(), deployer)
              , {
                asset: ASSET_COLLATERAL,
                holder: HOLDER_COLLATERAL
              }, {
                asset: ASSET_BORROW,
                holder: HOLDER_BORROW
              }
            );
          }
//endregion Constants and utils
          describe("AAVE3", () => {
            describe("Collateral factor is decreased to 25", () => {
              it("should call reconvert", async () => {
                if (!await isPolygonForkInUse()) return; // TODO: replace real DAI and USDC by own tokens

                const modifier = async (
                  uc: Borrower,
                  controller: Controller,
                  poolAdapter: string
                ) => {
                  const m = await getLendingPlatformManagerAave3(uc, controller, poolAdapter);
                  return m.changeCollateralFactor(deployer, 25);
                };
                const ret = await makeTestForReconversionCall(modifier);
                const expected = [false, true];

                const sret = ret.join("\n");
                const sexpected = expected.join("\n");

                expect(sret).equal(sexpected);
              });
            });
            describe("Collateral price is decreased 10 times", () => {
              it("should call reconvert", async () => {
                if (!await isPolygonForkInUse()) return; // TODO: replace real DAI and USDC by own tokens

                const modifier = async (
                  uc: Borrower,
                  controller: Controller,
                  poolAdapter: string
                ) => {
                  const m = await getLendingPlatformManagerAave3(uc, controller, poolAdapter);
                  return m.changeAssetPrice(deployer, ASSET_COLLATERAL, false, 10);
                };
                const ret = await makeTestForReconversionCall(modifier);
                const expected = [false, true];

                const sret = ret.join("\n");
                const sexpected = expected.join("\n");

                expect(sret).equal(sexpected);
              });
            });
            describe("Borrow price is increased 8 times", () => {
              it("should call reconvert", async () => {
                if (!await isPolygonForkInUse()) return; // TODO: replace real DAI and USDC by own tokens

                const modifier = async (
                  uc: Borrower,
                  controller: Controller,
                  poolAdapter: string,
                ) => {
                  const m = await getLendingPlatformManagerAave3(uc, controller, poolAdapter);
                  return m.changeAssetPrice(deployer, ASSET_BORROW, true, 8);
                };
                const ret = await makeTestForReconversionCall(modifier);
                const expected = [false, true];

                const sret = ret.join("\n");
                const sexpected = expected.join("\n");

                expect(sret).equal(sexpected);
              });
            });
          });
        });
      });
    });
  });

  describe("Better converting way checking", async () => {
    describe("Good paths", () => {
      describe("Two pools, select best one", () => {
        describe("DAI => USDC", () => {
//region Constants and utils
          const ASSET_COLLATERAL = MaticAddresses.DAI;
          const HOLDER_COLLATERAL = MaticAddresses.HOLDER_DAI;
          const ASSET_BORROW = MaticAddresses.USDC;
          const HOLDER_BORROW = MaticAddresses.HOLDER_USDC;
          const AMOUNT_COLLATERAL = 1_000;
          const INITIAL_LIQUIDITY_COLLATERAL = 100_000;
          const INITIAL_LIQUIDITY_BORROW = 80_000;
          const HEALTH_FACTOR2 = 200;
          const COUNT_BLOCKS = 1;

          /**
           * Return two booleans:
           *    1) reconversion is required BEFORE modification
           *    2) reconversion is required AFTER modification
           */
          async function makeTestForReconversionCall_Mock(
            platformStateModifierFabric: (
              uc: Borrower, controller: Controller, poolAdapter: string
            ) => Promise<PoolAdapterState01>
          ): Promise<boolean[]> {
            // make a borrow
            const {uc, tc, controller, poolAdapter} = await KeeperTestMockUtils.makeSingleBorrow_Mock(
                deployer,
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
              }, {
                collateral: {
                  liquidity: INITIAL_LIQUIDITY_COLLATERAL * 2,
                  collateralFactor: 0.5,
                  borrowRate: getBigNumberFrom(3, 10),
                  decimals: 6,
                },
                borrow: {
                  liquidity: INITIAL_LIQUIDITY_COLLATERAL * 2,
                  collateralFactor: 0.8,
                  borrowRate: getBigNumberFrom(4, 8),
                  decimals: 24,
                }
              }
              // we create 2 pool adapters, use first one to borrow and later change its borrow rate
              // as result, second pool adapter will have better APR and keeper should find it.
              , 2
            );

            // create a keeper
            const reconverter = new ReConverterMock();
            const keeper: Keeper = new Keeper(
              IDebtMonitor__factory.connect(await controller.debtMonitor(), deployer)
              , HEALTH_FACTOR2
              , COUNT_BLOCKS
              , reconverter
            );

            // let's call keeper job twice: before and after modification of the platform state
            const dest: boolean[] = [];
            for (let i = 0; i < 2; ++i) {
              console.log("Run keeper, step", i);
              await keeper.makeKeeperJob(deployer);

              // ensure that re-conversion was called for the given poolAdapter
              const keeperResult = reconverter.ensureExpectedPA(poolAdapter);
              console.log("keeperResult", keeperResult);
              dest.push(keeperResult);

              if (i === 0) {
                // modify platform state
                console.log("Modify platform state", i);
                await platformStateModifierFabric(uc, controller, poolAdapter);
              }
            }

            return dest;
          }

          /**
           * Return two booleans:
           *    1) reconversion is required BEFORE modification
           *    2) reconversion is required AFTER modification
           */
          async function makeTestChangeBorrowRate_Mock(
            thresholdAprPercents: number,
            changeBorrowRateFactor: number
          ) : Promise<boolean[]> {
            const modifier = async (
              uc: Borrower,
              controller: Controller,
              poolAdapter: string
            ) => {
              const bm: BorrowManager = await getBorrowManager(deployer, controller);
              const pa = IPoolAdapter__factory.connect(poolAdapter, deployer);
              const dm: DebtMonitor = await getDebtMonitor(deployer, controller);
              await dm.setThresholdAPR(thresholdAprPercents); // 200%
              await dm.setThresholdCountBlocks(0); // disable

              const m = new LendingPlatformManagerMock(
                PoolAdapterMock__factory.connect(poolAdapter, deployer)
                , LendingPlatformMock__factory.connect(
                  await bm.getPlatformAdapter((await pa.getConfig()).originConverter)
                  , deployer
                )
              );
              return m.changeBorrowRate(deployer, true, changeBorrowRateFactor);
            };
            return makeTestForReconversionCall_Mock(modifier);
          }

          /**
           * Return two booleans:
           *    1) reconversion is required BEFORE modification
           *    2) reconversion is required AFTER modification
           */
          async function makeTestPeriodSinceLastReconversion_Mock(
            thresholdCountBlocks: number,
            periodBeforeCheckInBlocks: number
          ) : Promise<boolean[]> {
            const modifier = async (
              uc: Borrower,
              controller: Controller,
              poolAdapter: string
            ) => {
              const bm: BorrowManager = await getBorrowManager(deployer, controller);
              const pa = IPoolAdapter__factory.connect(poolAdapter, deployer);
              const dm: DebtMonitor = await getDebtMonitor(deployer, controller);
              await dm.setThresholdAPR(0); // disabled
              await dm.setThresholdCountBlocks(thresholdCountBlocks);

              if (periodBeforeCheckInBlocks) {
                await TimeUtils.advanceNBlocks(periodBeforeCheckInBlocks);
              }

              const m = new LendingPlatformManagerMock(
                PoolAdapterMock__factory.connect(poolAdapter, deployer)
                , LendingPlatformMock__factory.connect(
                  await bm.getPlatformAdapter((await pa.getConfig()).originConverter)
                  , deployer
                )
              );
              return m.makeMaxBorrow(deployer);
            };
            return makeTestForReconversionCall_Mock(modifier);
          }
//endregion Constants and utils

          describe("Mock", () => {
            describe("thresholdAPR", () => {
              describe("Increase borrow rate, thresholdAPR is disabled", () => {
                it("should call reconvert", async () => {
                  if (!await isPolygonForkInUse()) return;

                  const thresholdAprPercents = 0; // disabled
                  const changeBorrowRateFactor = 100;

                  const ret = await makeTestChangeBorrowRate_Mock(
                    thresholdAprPercents,
                    changeBorrowRateFactor
                  );

                  const expected = [false, true];

                  const sret = ret.join("\n");
                  const sexpected = expected.join("\n");

                  expect(sret).equal(sexpected);
                });
              });
              describe("Increase borrow rate, thresholdAPR is not reached", () => {
                it("should NOT call reconvert", async () => {
                  if (!await isPolygonForkInUse()) return;

                  const thresholdAprPercents = 50;
                  const changeBorrowRateFactor = 1.5;

                  const ret = [
                    ...await makeTestChangeBorrowRate_Mock(thresholdAprPercents, changeBorrowRateFactor)
                  ];

                  const expected = [false, false];

                  const sret = ret.join("\n");
                  const sexpected = expected.join("\n");

                  expect(sret).equal(sexpected);
                });
              });
              describe("Increase borrow rate, thresholdAPR is reached", () => {
                it("should call reconvert", async () => {
                  if (!await isPolygonForkInUse()) return;

                  const thresholdAprPercents = 50;
                  const changeBorrowRateFactor = 20;

                  const ret = [
                    ...await makeTestChangeBorrowRate_Mock(thresholdAprPercents, changeBorrowRateFactor)
                  ];

                  const expected = [false, true];

                  const sret = ret.join("\n");
                  const sexpected = expected.join("\n");

                  expect(sret).equal(sexpected);
                });
              });
            });
            describe("thresholdCountBlocks", () => {
              describe("Increase borrow rate, thresholdCountBlocks is disabled", () => {
                it("should call reconvert", async () => {
                  if (!await isPolygonForkInUse()) return;

                  const thresholdCountBlocks = 0;
                  const periodBeforeCheckInBlocks = 100;

                  const ret = await makeTestPeriodSinceLastReconversion_Mock(
                    thresholdCountBlocks,
                    periodBeforeCheckInBlocks
                  );

                  const expected = [false, true];

                  const sret = ret.join("\n");
                  const sexpected = expected.join("\n");

                  expect(sret).equal(sexpected);
                });
              });
              describe("Increase borrow rate, thresholdCountBlocks is not reached", () => {
                it("should NOT call reconvert", async () => {
                  if (!await isPolygonForkInUse()) return;

                  const thresholdCountBlocks = 21;
                  const periodBeforeCheckInBlocks = 10;

                  const ret = await makeTestPeriodSinceLastReconversion_Mock(
                    thresholdCountBlocks,
                    periodBeforeCheckInBlocks
                  );

                  const expected = [false, false];

                  const sret = ret.join("\n");
                  const sexpected = expected.join("\n");

                  expect(sret).equal(sexpected);
                });
              });
              describe("Increase borrow rate, thresholdCountBlocks is reached", () => {
                it("should call reconvert", async () => {
                  if (!await isPolygonForkInUse()) return;

                  const thresholdCountBlocks = 10;
                  const periodBeforeCheckInBlocks = 21;

                  const ret = await makeTestPeriodSinceLastReconversion_Mock(
                    thresholdCountBlocks,
                    periodBeforeCheckInBlocks
                  );

                  const expected = [false, true];

                  const sret = ret.join("\n");
                  const sexpected = expected.join("\n");

                  expect(sret).equal(sexpected);
                });
              });
            });
          });
        });
        describe("DAI => WBTC", () => {
//region Constants
          const ASSET_COLLATERAL = MaticAddresses.DAI;
          const HOLDER_COLLATERAL = MaticAddresses.HOLDER_DAI;
          const ADDITIONAL_COLLATERAL_HOLDERS = [
            MaticAddresses.HOLDER_DAI_2
            , MaticAddresses.HOLDER_DAI_3
            , MaticAddresses.HOLDER_DAI_4
            , MaticAddresses.HOLDER_DAI_5
            , MaticAddresses.HOLDER_DAI_6
          ];
          const ASSET_BORROW = MaticAddresses.WBTC;
          const HOLDER_BORROW = MaticAddresses.HOLDER_WBTC;
          const AMOUNT_COLLATERAL = 1_000;
          const INITIAL_LIQUIDITY_COLLATERAL = 100_000;
          const INITIAL_LIQUIDITY_BORROW = 10;
          const HEALTH_FACTOR2 = 200;
          const COUNT_BLOCKS = 1;
//endregion Constants
          describe("AAVE3 + AAVE2", () => {
            describe("Increase borrow rate significantly, second pool becomes better", () => {
              it("should call reconvert", async () => {
                if (!await isPolygonForkInUse()) return;

                // install the app and prepare to borrow
                const p = {
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
                };

                const reconverter = new ReConverterMock();

                const ret = await makeTestForReconversionAave3andTwo(
                  reconverter
                  , p
                  , ADDITIONAL_COLLATERAL_HOLDERS
                );

                const paInitiallyInefficient = ret.statusAfterMaxBorrow[0];
                const paInitiallyEfficient =  ret.statusAfterSmallBorrow[1];

                const sret = [
                  ret.statusAfterMaxBorrow.join(";"),
                  ret.statusAfterSmallBorrow.join(";"),
                  ret.statusAfterRepayMaxBorrow.join(";"),

                  reconverter.poolAdapters.join(";"),
                ].join("\n");

                const sexpected = [
                  [paInitiallyInefficient].join(";"),
                  [paInitiallyInefficient, paInitiallyEfficient].join(";"),
                  [paInitiallyEfficient].join(";"),

                  [paInitiallyEfficient].join(";"),
                ].join("\n");

                console.log(ret);
                console.log(reconverter.poolAdapters);

                expect(sret).equal(sexpected);
              });
            });
          });
        });
      });
    });
  });

  describe("Make reconversion", () => {
    describe("Good paths", () => {
      describe("Increase borrow rate significantly, second pool becomes better", () => {
        describe("DAI => WBTC", () => {
//region Constants
          const ASSET_COLLATERAL = MaticAddresses.DAI;
          const HOLDER_COLLATERAL = MaticAddresses.HOLDER_DAI;
          const ADDITIONAL_COLLATERAL_HOLDERS = [
            MaticAddresses.HOLDER_DAI_2
            , MaticAddresses.HOLDER_DAI_3
            , MaticAddresses.HOLDER_DAI_4
            , MaticAddresses.HOLDER_DAI_5
            , MaticAddresses.HOLDER_DAI_6
          ];
          const ASSET_BORROW = MaticAddresses.WBTC;
          const HOLDER_BORROW = MaticAddresses.HOLDER_WBTC;
          const AMOUNT_COLLATERAL = 1_000;
          const INITIAL_LIQUIDITY_COLLATERAL = 100_000;
          const INITIAL_LIQUIDITY_BORROW = 10;
          const HEALTH_FACTOR2 = 200;
          const COUNT_BLOCKS = 1;
//endregion Constants
          it("should make reconversion", async () => {
            if (!await isPolygonForkInUse()) return;

            const reconverter = new ReConverterUsingPA();

            const p = {
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
            };
            const ret = await makeTestForReconversionAave3andTwo(
              reconverter
              , p
              , ADDITIONAL_COLLATERAL_HOLDERS
            );

            const paInitiallyInefficient = ret.statusAfterMaxBorrow[0];
            const paInitiallyEfficient = ret.statusAfterSmallBorrow[1];

            const sret = [
              ret.statusAfterMaxBorrow.join(";"),
              ret.statusAfterSmallBorrow.join(";"),
              ret.statusAfterRepayMaxBorrow.join(";"),
              ret.statusAfterReconversion.join(";")
            ].join("\n");

            const sexpected = [
              [paInitiallyInefficient].join(";"),
              [paInitiallyInefficient, paInitiallyEfficient].join(";"),
              [paInitiallyEfficient].join(";"),
              [paInitiallyInefficient].join(";"),
            ].join("\n");

            console.log(ret);

            expect(sret).equal(sexpected);
          });
        });
      });
    });
  });
//endregion Unit tests
});