import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {DForceChangePriceUtils} from "../baseUT/protocols/dforce/DForceChangePriceUtils";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {BorrowRepayUsesCase} from "../baseUT/uses-cases/app/BorrowRepayUsesCase";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import {
  BorrowManager__factory, IBorrowManager,
  IERC20__factory, IERC20Metadata__factory,
  IPlatformAdapter__factory,
  IPoolAdapter__factory, ITetuConverter__factory
} from "../../typechain";
import {BalanceUtils} from "../baseUT/utils/BalanceUtils";
import {parseUnits} from "ethers/lib/utils";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {ITestSingleBorrowParams} from "../baseUT/types/BorrowRepayDataTypes";
import {HardhatUtils, POLYGON_NETWORK_ID} from "../../scripts/utils/HardhatUtils";
import {Misc} from "../../scripts/utils/Misc";
import {TetuConverterApp} from "../baseUT/app/TetuConverterApp";
import {AaveTwoPlatformFabric} from "../baseUT/logic/fabrics/AaveTwoPlatformFabric";
import {Aave3PlatformFabric} from "../baseUT/logic/fabrics/Aave3PlatformFabric";

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
    // DForce-prices deprecate before DForce tests are run,
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

    interface IMakeRepayTheBorrow {
      amountMultiplier?: number;
      amountDivider?: number;
      notClosePosition?: boolean;
      useAaveTwo?: boolean; // by default - aave 3
    }
    interface IMakeRepayTheBorrowResults {
      countPlatformAdaptersBefore: number;
      userCollateralBalanceBefore: BigNumber;
      userBorrowBalanceBefore: BigNumber;

      countPlatformAdaptersAfter: number;
      userCollateralBalanceAfter: BigNumber;
      userBorrowBalanceAfter: BigNumber;
      p: ITestSingleBorrowParams;

      onTransferAmountsAssets: string[];
      onTransferAmountsAmounts: BigNumber[];
    }

    async function makeRepayTheBorrow(
      params?: IMakeRepayTheBorrow
    ): Promise<IMakeRepayTheBorrowResults> {
      // setup TetuConverter app
      const {controller} = await TetuConverterApp.buildApp(
        deployer,
        {networkId: POLYGON_NETWORK_ID}, // disable swap
        [
          params?.useAaveTwo
            ? new AaveTwoPlatformFabric()
            : new Aave3PlatformFabric()
        ],
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

      const amountToPay = (params?.amountMultiplier && params?.amountDivider)
        ? status.amountToPay.mul(params?.amountMultiplier).div(params?.amountDivider)
        : Misc.MAX_UINT;

      await borrower.setUpRequireAmountBack(
        amountToPay,
        amountToPay,
        0,
        0,
        Misc.ZERO_ADDRESS, // poolAdapter.address,
        0,
        Misc.ZERO_ADDRESS, // amountProvider,
        false
      );


      // move time to increase our debt a bit
      await TimeUtils.advanceNBlocks(2000);

      const closePosition = !params?.notClosePosition;
      const userCollateralBalanceBefore = await IERC20__factory.connect(p.collateral.asset, deployer).balanceOf(borrower.address);
      const userBorrowBalanceBefore = await IERC20__factory.connect(p.borrow.asset, deployer).balanceOf(borrower.address);

      await tcAsGov.repayTheBorrow(poolAdapter.address, closePosition);

      const userCollateralBalanceAfter = await IERC20__factory.connect(p.collateral.asset, deployer).balanceOf(borrower.address);
      const userBorrowBalanceAfter = await IERC20__factory.connect(p.borrow.asset, deployer).balanceOf(borrower.address);

      // unregister the platform adapter from Borrow Manager
      const countPlatformAdaptersBefore = await borrowManagerAsGov.platformAdaptersLength();
      if (closePosition) {

        if (params?.useAaveTwo) {
          await AaveTwoPlatformFabric.unregisterPlatformAdapter(
            borrowManagerAsGov as unknown as IBorrowManager,
            platformAdapter.address
          );
        } else {
          await Aave3PlatformFabric.unregisterPlatformAdapter(
            borrowManagerAsGov as unknown as IBorrowManager,
            platformAdapter.address
          );
        }
      }
      const countPlatformAdaptersAfter = await borrowManagerAsGov.platformAdaptersLength();

      const onTransferAmountsResults = await borrower.getOnTransferAmountsResults();
      return {
        userCollateralBalanceAfter,
        countPlatformAdaptersAfter: countPlatformAdaptersAfter.toNumber(),
        countPlatformAdaptersBefore: countPlatformAdaptersBefore.toNumber(),
        userCollateralBalanceBefore,
        userBorrowBalanceBefore,
        userBorrowBalanceAfter,
        p,
        onTransferAmountsAssets: onTransferAmountsResults.assets,
        onTransferAmountsAmounts: onTransferAmountsResults.amounts
      }
    }

    describe("Remove lending platform", () =>{
      it("should return collateral to user and unregister AAVE3 platform adapter ", async () => {

        const r = await makeRepayTheBorrow();

        const ret = [
          r.countPlatformAdaptersBefore,
          r.countPlatformAdaptersAfter,
          r.userCollateralBalanceAfter.sub(r.userCollateralBalanceBefore).gt(parseUnits(r.p.collateralAmount.toString(), 18)),
          // aave status returns amount-to-pay a bit bigger then it's necessary required because of dust tokens
          // this amount should be returned back on full repay
          r.onTransferAmountsAmounts[0].gt(0),
          r.onTransferAmountsAmounts[1].gt(0),
        ].join();

        const expected = [
          1,
          0,
          true,
          true,
          true
        ].join();

        console.log(r);

        expect(ret).eq(expected);
      });
      it("should return collateral to user and unregister AAVETwo platform adapter ", async () => {
        const r = await makeRepayTheBorrow({useAaveTwo: true});

        const ret = [
          r.countPlatformAdaptersBefore,
          r.countPlatformAdaptersAfter,
          r.userCollateralBalanceAfter.sub(r.userCollateralBalanceBefore).gt(parseUnits(r.p.collateralAmount.toString(), 18)),
          // aave status returns amount-to-pay a bit bigger then it's necessary required because of dust tokens
          // this amount should be returned back on full repay
          r.onTransferAmountsAmounts[0].gt(0),
          r.onTransferAmountsAmounts[1].gt(0),
        ].join();

        const expected = [
          1,
          0,
          true,
          true,
          true
        ].join();

        console.log(r);

        expect(ret).eq(expected);
      });
    });
    describe("Not close position", () => {
      it("should make partial repayment if amount is less than required", async () => {
        const r = await makeRepayTheBorrow(
          {
            amountMultiplier: 1,
            amountDivider: 2,
            notClosePosition: true
          }
        );

        const ret = [
          r.countPlatformAdaptersBefore,
          r.countPlatformAdaptersAfter,
          r.userCollateralBalanceAfter.sub(r.userCollateralBalanceBefore).gt(0)
        ].join();

        const expected = [
          1,
          1,
          true
        ].join();

        expect(ret).eq(expected);
      });
    });
  });
//endregion Unit tests
});