import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {isPolygonForkInUse} from "../baseUT/utils/NetworkUtils";
import {DForceChangePriceUtils} from "../baseUT/protocols/dforce/DForceChangePriceUtils";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {BorrowRepayUsesCase, IMakeTestSingleBorrowInstantRepayResults} from "../baseUT/uses-cases/BorrowRepayUsesCase";
import {Aave3PlatformFabric} from "../baseUT/fabrics/Aave3PlatformFabric";
import {TetuConverterApp} from "../baseUT/helpers/TetuConverterApp";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import {
  BorrowManager__factory,
  IERC20__factory, IERC20Metadata__factory,
  IPlatformAdapter__factory,
  IPoolAdapter__factory, ITetuConverter__factory
} from "../../typechain";
import {BalanceUtils} from "../baseUT/utils/BalanceUtils";
import {generateAssetPairs} from "../baseUT/utils/AssetPairUtils";
import {parseUnits} from "ethers/lib/utils";
import {expect} from "chai";

/**
 * Assume, some lending platform should be deactivated or
 * there is an error in the platform/pool adapter, so we need to replace current versions
 * of the pool/platform adapters by new versions.
 *
 * We can do following:
 * - the lending platform has some opened positions
 * - set tetuConverter on pause
 * - freeze the platform adapter of the lending platform
 * - find all borrows opened for the given lending platform
 * - call repayTheBorrow for each found borrow
 * - unregister the platform adapter from Borrow Manager
 *
 * - deploy new version of the lending platform
 * - register new version of the platform adapter in Borrow Manager
 * - unpause tetuConverter
 * - make new borrow
 */
describe("RepayTheBorrow @skip-on-coverage", () => {
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
    snapshotForEach = await TimeUtils.snapshot();
  });

  afterEach(async function () {
    await TimeUtils.rollback(snapshotForEach);
  });
//endregion before, after

//region Unit tests
  describe("Replace one lending platform by another", () =>{
    describe("Dai=>USDC", () => {
      const ASSET_COLLATERAL = MaticAddresses.DAI;
      const HOLDER_COLLATERAL = MaticAddresses.HOLDER_DAI;
      const ASSET_BORROW = MaticAddresses.USDC;
      const HOLDER_BORROW = MaticAddresses.HOLDER_USDC;
      const AMOUNT_COLLATERAL = 1_000;
      const INITIAL_LIQUIDITY_COLLATERAL = 100_000;
      const INITIAL_LIQUIDITY_BORROW = 80_000;
      const HEALTH_FACTOR2 = 200;
      const COUNT_BLOCKS = 1_000
      describe("Exclude AAVE3", () => {
        it("should return collateral to user and unregister AAVE3 platform adapter ", async () => {
          if (!await isPolygonForkInUse()) return;

          // setup TetuConverter app
          const {controller} = await TetuConverterApp.buildApp(
            deployer,
            [new Aave3PlatformFabric()],
            {} // disable swap
          );
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

          // make a borrow using AAVE3
          const r = await BorrowRepayUsesCase.makeBorrow(deployer, p, controller);
          const borrower = r.uc;
          const governance = await DeployerUtils.startImpersonate(await controller.governance());

          // set tetuConverter on pause
          await controller.connect(governance).setPaused(true);

          // find FIRST borrow opened for the given lending platform (there is only one borrow in our case)
          const borrowManagerAsGov = BorrowManager__factory.connect(await controller.borrowManager(), governance);
          const poolAdapter = IPoolAdapter__factory.connect(await borrowManagerAsGov.listPoolAdapters(0), deployer);

          // freeze the platform adapter of the lending platform
          const config = await poolAdapter.getConfig();
          const platformAdapter = IPlatformAdapter__factory.connect(
            await borrowManagerAsGov.getPlatformAdapter(config.originConverter),
            governance
          );
          await platformAdapter.setFrozen(true);

          // call repayTheBorrow for each found borrow
          const tcAsGov = ITetuConverter__factory.connect(await controller.tetuConverter(), governance);
          const status = await poolAdapter.getStatus();
          await BalanceUtils.getRequiredAmountFromHolders(
            status.amountToPay.mul(2),
            IERC20Metadata__factory.connect(p.borrow.asset, deployer),
            [p.borrow.holder],
            borrower.address
          );
          const userCollateralBalanceBefore = await IERC20__factory.connect(p.collateral.asset, deployer).balanceOf(borrower.address);
          await tcAsGov.repayTheBorrow(poolAdapter.address, true);
          const userCollateralBalanceAfter = await IERC20__factory.connect(p.collateral.asset, deployer).balanceOf(borrower.address);

          // unregister the platform adapter from Borrow Manager
          const countPlatformAdaptersBefore = await borrowManagerAsGov.platformAdaptersLength();
          const assets: string[] = [
            MaticAddresses.DAI,
            MaticAddresses.USDC,
            MaticAddresses.USDT,
            MaticAddresses.EURS,
            MaticAddresses.jEUR,
            MaticAddresses.BALANCER,
            MaticAddresses.WBTC,
            MaticAddresses.WETH,
            MaticAddresses.WMATIC,
            MaticAddresses.SUSHI,
            MaticAddresses.CRV,
            MaticAddresses.agEUR,
          ];
          const assetPairs = generateAssetPairs(assets);
          await borrowManagerAsGov.removeAssetPairs(platformAdapter.address,
            assetPairs.map(x => x.smallerAddress),
            assetPairs.map(x => x.biggerAddress),
          );
          const countPlatformAdaptersAfter = await borrowManagerAsGov.platformAdaptersLength();

          const ret = [
            countPlatformAdaptersBefore.toNumber(),
            countPlatformAdaptersAfter.toNumber(),
            userCollateralBalanceAfter.sub(userCollateralBalanceBefore)
              .gt(parseUnits(p.collateralAmount.toString(), 18))
          ].join();

          const expected = [
            1,
            0,
            true
          ].join();

          expect(ret).eq(expected);
        });
      });
    });
  });

//endregion Unit tests
});