import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {
  IDForceCToken__factory,
  IDForceRewardDistributor__factory,
  IERC20__factory,
  IERC20Extended__factory,
  IPoolAdapter__factory,
} from "../../../typechain";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";
import {BalanceUtils, IUserBalances} from "../../baseUT/utils/BalanceUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {TokenDataTypes} from "../../baseUT/types/TokenDataTypes";
import {DForceHelper, IDForceMarketData} from "../../../scripts/integration/helpers/DForceHelper";
import {Misc} from "../../../scripts/utils/Misc";
import {IDForceCalcAccountEquityResults} from "../../baseUT/apr/aprDForce";
import {areAlmostEqual, toStringWithRound} from "../../baseUT/utils/CommonUtils";
import {IPoolAdapterStatus} from "../../baseUT/types/BorrowRepayDataTypes";
import {
  IAssetsInputParamsWithCTokens,
  IMakeRepayRebalanceBadPathParams,
  IMakeRepayToRebalanceInputParamsWithCTokens
} from "../../baseUT/protocols/shared/sharedDataTypes";
import {SharedRepayToRebalanceUtils} from "../../baseUT/protocols/shared/sharedRepayToRebalanceUtils";
import {transferAndApprove} from "../../baseUT/utils/transferUtils";
import {DForceTestUtils, IMarketsInfo, IPrepareToBorrowResults} from "../../baseUT/protocols/dforce/DForceTestUtils";


describe("DForce integration tests, pool adapter", () => {
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

//region Make borrow
  async function makeBorrow(
    collateralToken: TokenDataTypes,
    collateralCToken: TokenDataTypes,
    collateralHolder: string,
    collateralAmountRequired: BigNumber | undefined,
    borrowToken: TokenDataTypes,
    borrowCToken: TokenDataTypes,
    borrowAmountRequired: BigNumber | undefined
  ) : Promise<{sret: string, sexpected: string, prepareResults: IPrepareToBorrowResults}>{
    const d = await DForceTestUtils.prepareToBorrow(
      deployer,
      collateralToken,
      collateralHolder,
      collateralCToken.address,
      collateralAmountRequired,
      borrowToken,
      borrowCToken.address
    );

    const borrowResults = await DForceTestUtils.makeBorrow(deployer, d, borrowAmountRequired);

    const sret = [
      borrowResults.userBalanceBorrowAsset,
      borrowResults.poolAdapterBalanceCollateralCToken,
      areAlmostEqual(borrowResults.accountLiquidity.accountEquity, borrowResults.expectedLiquidity),
      borrowResults.accountLiquidity.shortfall,
    ].map(x => BalanceUtils.toString(x)).join("\n");

    const sexpected = [
      d.amountToBorrow, // borrowed amount on user's balance
      d.collateralAmount
        .mul(Misc.WEI)
        .div(borrowResults.marketsInfo.collateralData.exchangeRateStored),
      true,
      0,
    ].map(x => BalanceUtils.toString(x)).join("\n");

    return {sret, sexpected, prepareResults: d};
  }


  async function testBorrowDaiUsdc(
    collateralAmountNum: number | undefined,
    borrowAmountNum: number | undefined
  ) : Promise<{ret: string, expected: string, prepareResults: IPrepareToBorrowResults}> {
    const collateralAsset = MaticAddresses.DAI;
    const collateralHolder = MaticAddresses.HOLDER_DAI;
    const collateralCTokenAddress = MaticAddresses.dForce_iDAI;

    const borrowAsset = MaticAddresses.USDC;
    const borrowCTokenAddress = MaticAddresses.dForce_iUSDC;

    const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
    const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);
    const collateralCToken = await TokenDataTypes.Build(deployer, collateralCTokenAddress);
    const borrowCToken = await TokenDataTypes.Build(deployer, borrowCTokenAddress);

    const collateralAmount = collateralAmountNum
      ? getBigNumberFrom(collateralAmountNum, collateralToken.decimals)
      : undefined;
    const borrowAmount = borrowAmountNum
      ? getBigNumberFrom(borrowAmountNum, borrowToken.decimals)
      : undefined;

    const r = await makeBorrow(
      collateralToken,
      collateralCToken,
      collateralHolder,
      collateralAmount,
      borrowToken,
      borrowCToken,
      borrowAmount,
    );

    return {ret: r.sret, expected: r.sexpected, prepareResults: r.prepareResults};
  }

  async function testBorrowMaticEth(
    collateralAmountNum: number | undefined,
    borrowAmountNum: number | undefined
  ) : Promise<{ret: string, expected: string, prepareResults: IPrepareToBorrowResults}> {
    const collateralAsset = MaticAddresses.WMATIC;
    const collateralHolder = MaticAddresses.HOLDER_WMATIC;
    const collateralCTokenAddress = MaticAddresses.dForce_iMATIC;

    const borrowAsset = MaticAddresses.WETH;
    const borrowCTokenAddress = MaticAddresses.dForce_iWETH;

    const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
    const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);
    const collateralCToken = await TokenDataTypes.Build(deployer, collateralCTokenAddress);
    const borrowCToken = await TokenDataTypes.Build(deployer, borrowCTokenAddress);

    const collateralAmount = collateralAmountNum
      ? getBigNumberFrom(collateralAmountNum, collateralToken.decimals)
      : undefined;
    const borrowAmount = borrowAmountNum
      ? getBigNumberFrom(borrowAmountNum, borrowToken.decimals)
      : undefined;

    const r = await makeBorrow(
      collateralToken,
      collateralCToken,
      collateralHolder,
      collateralAmount,
      borrowToken,
      borrowCToken,
      borrowAmount,
    );

    return {ret: r.sret, expected: r.sexpected, prepareResults: r.prepareResults};
  }
//endregion Make borrow

//region Unit tests
  describe("borrow", () => {
    describe("Good paths", () => {
      describe("Borrow small fixed amount", () => {
        describe("DAI-18 : usdc-6", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await testBorrowDaiUsdc(100_000, 10);
            expect(r.ret).eq(r.expected);
          });
        });
      });
      describe("Borrow max available amount using all available collateral", () => {
        describe("DAI-18 : usdc-6", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await testBorrowDaiUsdc(undefined, undefined);
            expect(r.ret).eq(r.expected);
          });
        });
        describe("Matic-18 : ETH-18", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await testBorrowMaticEth(undefined, undefined);
            expect(r.ret).eq(r.expected);
          });
        });
      });
    });
    describe("Bad paths", () => {
      describe("Not borrowable", () => {
        it("", async () =>{
          if (!await isPolygonForkInUse()) return;
          expect.fail("TODO");
        });
      });
      describe("Not usable as collateral", () => {
        it("", async () =>{
          if (!await isPolygonForkInUse()) return;
          expect.fail("TODO");
        });
      });
    });
  });

  describe("borrowToRebalance", () => {
    const minHealthFactorInitial2 = 1000;
    const targetHealthFactorInitial2 = 2000;
    const maxHealthFactorInitial2 = 4000;
    const minHealthFactorUpdated2 = 500;
    const targetHealthFactorUpdated2 = 1000;
    const maxHealthFactorUpdated2 = 2000;

    interface IMakeBorrowToRebalanceResults {
      afterBorrow: IDForceCalcAccountEquityResults;
      afterBorrowHealthFactor18: BigNumber;
      afterBorrowToRebalance: IDForceCalcAccountEquityResults;
      afterBorrowToRebalanceHealthFactor18: BigNumber;
      userBalanceAfterBorrow: BigNumber;
      userBalanceAfterBorrowToRebalance: BigNumber;
      expectedAdditionalBorrowAmount: BigNumber;
    }
    interface IMakeBorrowToRebalanceBadPathParams {
      makeBorrowToRebalanceAsDeployer?: boolean;
      skipBorrow?: boolean;
      additionalAmountCorrectionFactor?: number;
    }
    /**
     * Prepare aave3 pool adapter.
     * Set high health factors.
     * Make borrow.
     * Reduce health factor twice.
     * Make additional borrow.
     */
    async function makeBorrowToRebalance (
      collateralToken: TokenDataTypes,
      collateralHolder: string,
      collateralCTokenAddress: string,
      collateralAmount: BigNumber,
      borrowToken: TokenDataTypes,
      borrowCTokenAddress: string,
      borrowHolder: string,
      badPathsParams?: IMakeBorrowToRebalanceBadPathParams
    ) : Promise<IMakeBorrowToRebalanceResults>{
      const d = await DForceTestUtils.prepareToBorrow(
        deployer,
        collateralToken,
        collateralHolder,
        collateralCTokenAddress,
        collateralAmount,
        borrowToken,
        borrowCTokenAddress,
        targetHealthFactorInitial2
      );

      // const info = await getMarketsInfo(d, collateralCTokenAddress, borrowCTokenAddress);

      // setup high values for all health factors
      await d.controller.setMaxHealthFactor2(maxHealthFactorInitial2);
      await d.controller.setTargetHealthFactor2(targetHealthFactorInitial2);
      await d.controller.setMinHealthFactor2(minHealthFactorInitial2);

      // make borrow
      const amountToBorrow = d.amountToBorrow;
      if (! badPathsParams?.skipBorrow) {
        await transferAndApprove(
          collateralToken.address,
          d.userContract.address,
          await d.controller.tetuConverter(),
          d.collateralAmount,
          d.dfPoolAdapterTC.address
        );
        await d.dfPoolAdapterTC.borrow(
          collateralAmount,
          amountToBorrow,
          d.userContract.address // receiver
        );
      }
      const afterBorrow = await d.comptroller.calcAccountEquity(d.dfPoolAdapterTC.address);
      const statusAfterBorrow = await d.dfPoolAdapterTC.getStatus();
      const userBalanceAfterBorrow = await borrowToken.token.balanceOf(d.userContract.address);
      console.log("after borrow:", afterBorrow, userBalanceAfterBorrow);

      // reduce all health factors down on 2 times to have possibility for additional borrow
      await d.controller.setMinHealthFactor2(minHealthFactorUpdated2);
      await d.controller.setTargetHealthFactor2(targetHealthFactorUpdated2);
      await d.controller.setMaxHealthFactor2(maxHealthFactorUpdated2);

      const expectedAdditionalBorrowAmount = amountToBorrow.mul(
        badPathsParams?.additionalAmountCorrectionFactor
          ? badPathsParams.additionalAmountCorrectionFactor
          : 1
      );
      console.log("expectedAdditionalBorrowAmount", expectedAdditionalBorrowAmount);

      // make additional borrow
      const poolAdapterSigner = badPathsParams?.makeBorrowToRebalanceAsDeployer
        ? IPoolAdapter__factory.connect(d.dfPoolAdapterTC.address, deployer)
        : d.dfPoolAdapterTC;
      await poolAdapterSigner.borrowToRebalance(
        expectedAdditionalBorrowAmount,
        d.userContract.address // receiver
      );

      const afterBorrowToRebalance = await d.comptroller.calcAccountEquity(d.dfPoolAdapterTC.address);
      const statusAfterBorrowToRebalance = await d.dfPoolAdapterTC.getStatus();
      const userBalanceAfterBorrowToRebalance = await borrowToken.token.balanceOf(d.userContract.address);
      console.log("after borrow to rebalance:", afterBorrowToRebalance, userBalanceAfterBorrowToRebalance);

      return {
        afterBorrow,
        afterBorrowHealthFactor18: statusAfterBorrow.healthFactor18,
        afterBorrowToRebalance,
        afterBorrowToRebalanceHealthFactor18: statusAfterBorrowToRebalance.healthFactor18,
        userBalanceAfterBorrow,
        userBalanceAfterBorrowToRebalance,
        expectedAdditionalBorrowAmount
      }
    }

    async function testDaiUSDC(
      badPathParams?: IMakeBorrowToRebalanceBadPathParams
    ) : Promise<IMakeBorrowToRebalanceResults> {
      const collateralAsset = MaticAddresses.DAI;
      const collateralHolder = MaticAddresses.HOLDER_DAI;
      const collateralCTokenAddress = MaticAddresses.dForce_iDAI;

      const borrowAsset = MaticAddresses.USDC;
      const borrowCTokenAddress = MaticAddresses.dForce_iUSDC;
      const borrowHolder = MaticAddresses.HOLDER_USDC;

      const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
      const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);
      console.log("collateralToken.decimals", collateralToken.decimals);
      console.log("borrowToken.decimals", borrowToken.decimals);

      const collateralAmount = getBigNumberFrom(100_000, collateralToken.decimals);
      console.log(collateralAmount, collateralAmount);

      const r = await makeBorrowToRebalance(
        collateralToken,
        collateralHolder,
        collateralCTokenAddress,
        collateralAmount,
        borrowToken,
        borrowCTokenAddress,
        borrowHolder,
        badPathParams
      );

      console.log(r);
      return r;
    }

    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        const r = await testDaiUSDC();
        const ret = [
          Math.round(r.afterBorrowHealthFactor18.div(getBigNumberFrom(1, 15)).toNumber() / 10.),
          Math.round(r.afterBorrowToRebalanceHealthFactor18.div(getBigNumberFrom(1, 15)).toNumber() / 10.),
          toStringWithRound(r.userBalanceAfterBorrow, 6),
          toStringWithRound(r.userBalanceAfterBorrowToRebalance, 6),
        ].join();
        const expected = [
          targetHealthFactorInitial2,
          targetHealthFactorUpdated2,
          toStringWithRound(r.expectedAdditionalBorrowAmount, 6), // TODO: decimals
          toStringWithRound(r.expectedAdditionalBorrowAmount.mul(2), 6), // TODO: decimals
        ].join();
        expect(ret).eq(expected);
      });
    });
    describe("Bad paths", () => {
      describe("Not TetuConverter", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            testDaiUSDC({makeBorrowToRebalanceAsDeployer: true})
          ).revertedWith("TC-8");
        });
      });
      describe("Position is not registered", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            testDaiUSDC({skipBorrow: true})
          ).revertedWith("TC-11");
        });
      });
      describe("Result health factor is less min allowed one", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            testDaiUSDC({additionalAmountCorrectionFactor: 10})
          ).revertedWith("TC-3: wrong health factor");
        });
      });
    });
  });

  describe("repay", () =>{
    interface IBorrowAndRepayResults {
      userBalancesBeforeBorrow: IUserBalances;
      userBalancesAfterBorrow: IUserBalances;
      userBalancesAfterRepay: IUserBalances;
      paCTokensBalance: BigNumber;
      totalCollateralBase: BigNumber;
      totalDebtBase: BigNumber;
      /* Actually borrowed amount */
      borrowAmount: BigNumber;
      /* Actual collateral amount*/
      collateralAmount: BigNumber;
    }

    interface IBorrowAndRepayBadParams {
      /**
       * Try to make repay without borrowing
       */
      skipBorrow?: boolean;

      /**
       * What amount of borrow asset should be transferred to pool adapter's balance
       * before calling of repay().
       * We can emulate following problems:
       *    Try to transfer an amount LARGER than amount-to-pay - should revert
       *    Try to transfer an amount less than amount-to-pay - should revert
       */
      wrongAmountToRepayToTransfer?: BigNumber;

      forceToClosePosition?: boolean;

      repayAsNotUserAndNotTC?: boolean;
    }

    interface IAssetInfo {
      asset: string;
      holder: string;
      cToken: string;
    }

    async function makeBorrowAndRepay(
      collateralToken: TokenDataTypes,
      collateralCToken: TokenDataTypes,
      collateralHolder: string,
      collateralAmountRequired: BigNumber | undefined,
      borrowToken: TokenDataTypes,
      borrowCToken: TokenDataTypes,
      borrowHolder: string,
      borrowAmountRequired: BigNumber | undefined,
      amountToRepay?: BigNumber,
      initialBorrowAmountOnUserBalance?: BigNumber,
      badParams?: IBorrowAndRepayBadParams
    ) : Promise<IBorrowAndRepayResults>{
      const d = await DForceTestUtils.prepareToBorrow(
        deployer,
        collateralToken,
        collateralHolder,
        collateralCToken.address,
        collateralAmountRequired,
        borrowToken,
        borrowCToken.address
      );

      const borrowAmount = borrowAmountRequired
        ? borrowAmountRequired
        : d.amountToBorrow;
      console.log("collateralAmountRequired", collateralAmountRequired);
      console.log("borrowAmountRequired", borrowAmountRequired);
      console.log("d.collateralAmount", d.collateralAmount);

      console.log("borrowAmount", borrowAmount);
      // borrow asset
      if (initialBorrowAmountOnUserBalance && !initialBorrowAmountOnUserBalance.eq(0)) {
        await borrowToken.token
          .connect(await DeployerUtils.startImpersonate(borrowHolder))
          .transfer(d.userContract.address, initialBorrowAmountOnUserBalance);
      }

      const beforeBorrow: IUserBalances = {
        collateral: await collateralToken.token.balanceOf(d.userContract.address),
        borrow: await borrowToken.token.balanceOf(d.userContract.address)
      };

      // make borrow
      if (! badParams?.skipBorrow) {
        await transferAndApprove(
          collateralToken.address,
          d.userContract.address,
          await d.controller.tetuConverter(),
          d.collateralAmount,
          d.dfPoolAdapterTC.address
        );
        await d.dfPoolAdapterTC.borrow(
          d.collateralAmount,
          borrowAmount,
          d.userContract.address
        );
      }

      const statusAfterBorrow = await d.dfPoolAdapterTC.getStatus();
      console.log("statusAfterBorrow", statusAfterBorrow);
      const afterBorrow: IUserBalances = {
        collateral: await collateralToken.token.balanceOf(d.userContract.address),
        borrow: await borrowToken.token.balanceOf(d.userContract.address)
      };
      console.log(afterBorrow);

      await TimeUtils.advanceNBlocks(1000);

      const borrowTokenAsUser = IERC20Extended__factory.connect(
        borrowToken.address,
        await DeployerUtils.startImpersonate(d.userContract.address)
      );
      if (amountToRepay) {
        const repayCaller = badParams?.repayAsNotUserAndNotTC
          ? deployer.address // not TC, not user
          : await d.controller.tetuConverter();

        const poolAdapterAsCaller = IPoolAdapter__factory.connect(
          d.dfPoolAdapterTC.address,
          await DeployerUtils.startImpersonate(repayCaller)
        );

        // make partial repay
        const amountBorrowAssetToSendToPoolAdapter = badParams?.wrongAmountToRepayToTransfer
          ? badParams?.wrongAmountToRepayToTransfer
          : amountToRepay;

        await transferAndApprove(
          borrowToken.address,
          d.userContract.address,
          repayCaller,
          amountBorrowAssetToSendToPoolAdapter,
          d.dfPoolAdapterTC.address
        );

        await poolAdapterAsCaller.repay(
          amountToRepay,
          d.userContract.address,
          badParams?.forceToClosePosition || false
        );
      } else {
        console.log("user balance borrow asset before repay", await borrowTokenAsUser.balanceOf(d.userContract.address));
        // make full repayment
        await d.userContract.makeRepayComplete(
          collateralToken.address,
          borrowToken.address,
          d.userContract.address
        );
        console.log("user balance borrow asset after repay", await borrowTokenAsUser.balanceOf(d.userContract.address));
      }

      console.log("repay is done");
      const statusAfterRepay = await d.dfPoolAdapterTC.getStatus();
      console.log("statusAfterRepay", statusAfterRepay);

      // check results
      const afterRepay: IUserBalances = {
        collateral: await collateralToken.token.balanceOf(d.userContract.address),
        borrow: await borrowToken.token.balanceOf(d.userContract.address)
      };
      const cTokenCollateral = await IDForceCToken__factory.connect(collateralCToken.address, deployer);
      const cTokenBorrow = await IDForceCToken__factory.connect(borrowCToken.address, deployer);

      const bBorrowBalance = await cTokenBorrow.borrowBalanceStored(d.dfPoolAdapterTC.address);
      const cTokenBalance = await cTokenCollateral.balanceOf(d.dfPoolAdapterTC.address);

      return {
        userBalancesBeforeBorrow: beforeBorrow,
        userBalancesAfterBorrow: afterBorrow,
        userBalancesAfterRepay: afterRepay,
        paCTokensBalance: await cTokenCollateral.balanceOf(d.dfPoolAdapterTC.address),
        totalCollateralBase: cTokenBalance,
        totalDebtBase: bBorrowBalance,
        borrowAmount,
        collateralAmount: d.collateralAmount
      }
    }

//region Utils
    async function collateralToBorrow(
      useMaxAvailableCollateral: boolean,
      fullRepay: boolean,
      initialBorrowAmountOnUserBalanceNum: number | undefined,
      collateral: IAssetInfo,
      borrow: IAssetInfo,
      defaultCollateralAmount: number = 100_000,
      defaultBorrowAmount: number = 10,
      badPathParams?: IBorrowAndRepayBadParams
    ) : Promise<{ret: string, expected: string}> {
      const collateralToken = await TokenDataTypes.Build(deployer, collateral.asset);
      const borrowToken = await TokenDataTypes.Build(deployer, borrow.asset);
      const collateralCToken = await TokenDataTypes.Build(deployer, collateral.cToken);
      const borrowCToken = await TokenDataTypes.Build(deployer, borrow.cToken);

      const collateralAmount = useMaxAvailableCollateral
        ? undefined
        : getBigNumberFrom(defaultCollateralAmount, collateralToken.decimals);
      const borrowAmount = useMaxAvailableCollateral
        ? undefined
        : getBigNumberFrom(defaultBorrowAmount, borrowToken.decimals);
      const initialBorrowAmountOnUserBalance = getBigNumberFrom(
        initialBorrowAmountOnUserBalanceNum || 0,
        borrowToken.decimals
      );

      const r = await makeBorrowAndRepay(
        collateralToken,
        collateralCToken,
        collateral.holder,
        collateralAmount,
        borrowToken,
        borrowCToken,
        borrow.holder,
        borrowAmount,
        fullRepay ? undefined : borrowAmount,
        initialBorrowAmountOnUserBalance,
        badPathParams
      );

      console.log(`r`, r);
      const ret = [
        r.userBalancesBeforeBorrow.collateral, r.userBalancesBeforeBorrow.borrow,
        r.userBalancesAfterBorrow.collateral, r.userBalancesAfterBorrow.borrow,

        // result collateral is almost same as initial, the difference is less than 1%
        r.collateralAmount.sub(r.userBalancesAfterRepay.collateral)
          .div(r.collateralAmount)
          .mul(100).toNumber() < 1,

        // result borrow balance either 0 or a bit less than initial balance
        initialBorrowAmountOnUserBalance.eq(0)
          ? r.userBalancesAfterRepay.borrow.eq(0)
          : r.userBalancesAfterRepay.borrow.lte(initialBorrowAmountOnUserBalance),

      ].map(x => BalanceUtils.toString(x)).join("\n");

      const expected = [
        r.collateralAmount, initialBorrowAmountOnUserBalance,
        0, r.borrowAmount.add(initialBorrowAmountOnUserBalance),

        true,
        true
      ].map(x => BalanceUtils.toString(x)).join("\n");

      return {ret, expected};
    }

    async function daiWMatic(
      useMaxAvailableCollateral: boolean,
      fullRepay: boolean,
      initialBorrowAmountOnUserBalanceNum?: number,
      badPathParams?: IBorrowAndRepayBadParams
    ) : Promise<{ret: string, expected: string}> {
      const collateralAsset = MaticAddresses.DAI;
      const collateralHolder = MaticAddresses.HOLDER_DAI;
      const collateralCTokenAddress = MaticAddresses.dForce_iDAI;

      const borrowAsset = MaticAddresses.WMATIC;
      const borrowHolder = MaticAddresses.HOLDER_WMATIC;
      const borrowCTokenAddress = MaticAddresses.dForce_iMATIC;

      return collateralToBorrow(
        useMaxAvailableCollateral,
        fullRepay,
        initialBorrowAmountOnUserBalanceNum,
        {
          asset: collateralAsset,
          holder: collateralHolder,
          cToken: collateralCTokenAddress
        },
        {
          asset: borrowAsset,
          holder: borrowHolder,
          cToken: borrowCTokenAddress
        },
        100_000,
        10,
        badPathParams
      );
    }

    async function daiUSDC(
      useMaxAvailableCollateral: boolean,
      fullRepay: boolean,
      initialBorrowAmountOnUserBalanceNum?: number,
      badPathParams?: IBorrowAndRepayBadParams
    ) : Promise<{ret: string, expected: string}> {
      const collateralAsset = MaticAddresses.DAI;
      const collateralHolder = MaticAddresses.HOLDER_DAI;
      const collateralCTokenAddress = MaticAddresses.dForce_iDAI;

      const borrowAsset = MaticAddresses.USDC;
      const borrowHolder = MaticAddresses.HOLDER_USDC;
      const borrowCTokenAddress = MaticAddresses.dForce_iUSDC;

      return collateralToBorrow(
        useMaxAvailableCollateral,
        fullRepay,
        initialBorrowAmountOnUserBalanceNum,
        {
          asset: collateralAsset,
          holder: collateralHolder,
          cToken: collateralCTokenAddress
        },
        {
          asset: borrowAsset,
          holder: borrowHolder,
          cToken: borrowCTokenAddress
        },
        100_000,
        10,
        badPathParams
      );
    }

    async function usdtWETH(
      useMaxAvailableCollateral: boolean,
      fullRepay: boolean,
      initialBorrowAmountOnUserBalanceNum?: number,
      badPathParams?: IBorrowAndRepayBadParams
    ) : Promise<{ret: string, expected: string}> {
      const collateralAsset = MaticAddresses.USDT;
      const collateralHolder = MaticAddresses.HOLDER_USDT;
      const collateralCTokenAddress = MaticAddresses.dForce_iUSDT;

      const borrowAsset = MaticAddresses.WETH;
      const borrowHolder = MaticAddresses.HOLDER_WETH;
      const borrowCTokenAddress = MaticAddresses.dForce_iWETH;

      return collateralToBorrow(
        useMaxAvailableCollateral,
        fullRepay,
        initialBorrowAmountOnUserBalanceNum,
        {
          asset: collateralAsset,
          holder: collateralHolder,
          cToken: collateralCTokenAddress
        },
        {
          asset: borrowAsset,
          holder: borrowHolder,
          cToken: borrowCTokenAddress
        },
        100_000_000,
        1,
        badPathParams
      );
    }

    async function usdtUSDC(
      useMaxAvailableCollateral: boolean,
      fullRepay: boolean,
      initialBorrowAmountOnUserBalanceNum?: number,
      badPathParams?: IBorrowAndRepayBadParams
    ) : Promise<{ret: string, expected: string}> {
      const collateralAsset = MaticAddresses.USDT;
      const collateralHolder = MaticAddresses.HOLDER_USDT;
      const collateralCTokenAddress = MaticAddresses.dForce_iUSDT;

      const borrowAsset = MaticAddresses.USDC;
      const borrowHolder = MaticAddresses.HOLDER_USDC;
      const borrowCTokenAddress = MaticAddresses.dForce_iUSDC;

      return collateralToBorrow(
        useMaxAvailableCollateral,
        fullRepay,
        initialBorrowAmountOnUserBalanceNum,
        {
          asset: collateralAsset,
          holder: collateralHolder,
          cToken: collateralCTokenAddress
        },
        {
          asset: borrowAsset,
          holder: borrowHolder,
          cToken: borrowCTokenAddress
        },
        100_000,
        10,
        badPathParams
      );
    }
//endregion Utils

    describe("Good paths", () => {
      describe("Borrow and repay fixed small amount", () =>{
        describe("Partial repay of borrowed amount", () => {
          describe("DAI => USDC", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;

              const r = await daiUSDC(false, false);
              expect(r.ret).eq(r.expected);
            });
          });
          describe("DAI => WMATIC", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;

              const r = await daiWMatic(false, false);
              expect(r.ret).eq(r.expected);
            });
          });
          describe("USDT => WETH", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;

              const r = await usdtWETH(
                false,
                false,
              );
              expect(r.ret).eq(r.expected);
            });
          });
        });
        describe("Full repay of borrowed amount", () => {
          describe("DAI => USDC", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;

              const initialBorrowAmountOnUserBalance = 100;
              const r = await daiUSDC(
                false,
                true,
                initialBorrowAmountOnUserBalance
              );
              expect(r.ret).eq(r.expected);
            });
          });
          describe("DAI => WMATIC", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;

              const initialBorrowAmountOnUserBalance = 100;
              const r = await daiWMatic(
                false,
                true,
                initialBorrowAmountOnUserBalance
              );
              expect(r.ret).eq(r.expected);
            });
          });
        });
      });
      describe("Borrow max available amount using all available collateral", () =>{
        describe("Partial repay of borrowed amount", () => {
          describe("DAI => USDC", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;

              const r = await daiUSDC(false, false);
              expect(r.ret).eq(r.expected);
            });
          });
          describe("DAI => WMATIC", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;

              const r = await daiWMatic(false, false);
              expect(r.ret).eq(r.expected);
            });
          });
        });
        describe("Full repay of borrowed amount", () => {
          describe("DAI => USDC", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;

              const initialBorrowAmountOnUserBalance = 100;
              const r = await daiUSDC(
                false,
                true,
                initialBorrowAmountOnUserBalance
              );
              expect(r.ret).eq(r.expected);
            });
          });
          describe("DAI => WMATIC", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;

              const initialBorrowAmountOnUserBalance = 100;
              const r = await daiWMatic(
                false,
                true,
                initialBorrowAmountOnUserBalance
              );
              expect(r.ret).eq(r.expected);
            });
          });
          describe("USDT => USDC", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;

              const initialBorrowAmountOnUserBalance = 100;
              const r = await usdtUSDC(
                false,
                true,
                initialBorrowAmountOnUserBalance
              );
              expect(r.ret).eq(r.expected);
            });
          });
        });
      });
    });
    describe("Bad paths", () => {
      describe("Not user, not TC", () => {
        it("should return expected values", async () => {
          if (!await isPolygonForkInUse()) return;

          const usdcDecimals = await IERC20Extended__factory.connect(MaticAddresses.USDC, deployer).decimals();
          await expect(
            daiUSDC(
              false,
              false,
              undefined,
              {
                repayAsNotUserAndNotTC: true
              }
            )
          ).revertedWith("TC-32"); // USER_OR_TETU_CONVERTER_ONLY
        });
      });
      describe("Transfer amount less than specified amount to repay", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;

          const usdcDecimals = await IERC20Extended__factory.connect(MaticAddresses.USDC, deployer).decimals();
          await expect(
            daiUSDC(
              false,
              false,
              undefined,
              {
                // try to transfer too small amount on balance of the pool adapter
                wrongAmountToRepayToTransfer: getBigNumberFrom(1, usdcDecimals)
              }
            )
          ).revertedWith("ERC20: transfer amount exceeds balance");
        });
      });
      describe("Try to repay not opened position", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          const initialBorrowAmountOnUserBalanceNumber = 1000;
          await expect(
            daiUSDC(
              false,
              false,
              initialBorrowAmountOnUserBalanceNumber,
              {skipBorrow: true}
            )
          ).revertedWith("TC-28"); // ZERO_BALANCE
        });
      });
      describe("Try to close position with not zero debt", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            daiUSDC(
              false,
              false,
              undefined,
              {forceToClosePosition: true}
            )
          ).revertedWith("TC-24"); // CLOSE_POSITION_FAILED
        });
      });
    });
  });

  describe("repayToRebalance", () => {
    const minHealthFactorInitial2 = 500;
    const targetHealthFactorInitial2 = 1000;
    const maxHealthFactorInitial2 = 2000;
    const minHealthFactorUpdated2 = 1000+300; // we need small addon for bad paths
    const targetHealthFactorUpdated2 = 2000;
    const maxHealthFactorUpdated2 = 4000;

    interface IMakeRepayToRebalanceResults {
      afterBorrow: IDForceCalcAccountEquityResults;
      afterRepayToRebalance: IDForceCalcAccountEquityResults;
      afterBorrowStatus: IPoolAdapterStatus;
      afterRepayToRebalanceStatus: IPoolAdapterStatus;
      userBalanceAfterBorrow: BigNumber;
      userBalanceAfterRepayToRebalance: BigNumber;
      expectedBorrowAssetAmountToRepay: BigNumber;
      expectedCollateralAssetAmountToRepay: BigNumber;
    }

    /**
     * Prepare DForce pool adapter.
     * Set low health factors.
     * Make borrow.
     * Increase health factor twice.
     * Make repay to rebalance.
     */
    async function makeRepayToRebalance (
      p: IMakeRepayToRebalanceInputParamsWithCTokens
    ) : Promise<IMakeRepayToRebalanceResults>{
      const d = await DForceTestUtils.prepareToBorrow(
        deployer,
        p.collateralToken,
        p.collateralHolder,
        p.collateralCTokenAddress,
        p.collateralAmount,
        p.borrowToken,
        p.borrowCTokenAddress,
        targetHealthFactorInitial2
      );
      const collateralAssetData = await DForceHelper.getCTokenData(
        deployer,
        d.comptroller,
        d.collateralCToken
      );
      console.log("collateralAssetData", collateralAssetData);
      const borrowAssetData = await DForceHelper.getCTokenData(
        deployer,
        d.comptroller,
        d.borrowCToken
      );
      console.log("borrowAssetData", borrowAssetData);

      // prices of assets in base currency
      const priceCollateral = await d.priceOracle.getUnderlyingPrice(d.collateralCToken.address);
      const priceBorrow = await d.priceOracle.getUnderlyingPrice(d.borrowCToken.address);
      console.log("prices", priceCollateral, priceBorrow);

      // setup low values for all health factors
      await d.controller.setMaxHealthFactor2(maxHealthFactorInitial2);
      await d.controller.setTargetHealthFactor2(targetHealthFactorInitial2);
      await d.controller.setMinHealthFactor2(minHealthFactorInitial2);

      // make borrow
      const amountToBorrow = d.amountToBorrow;

      if (! p.badPathsParams?.skipBorrow) {
        await transferAndApprove(
          p.collateralToken.address,
          d.userContract.address,
          await d.controller.tetuConverter(),
          d.collateralAmount,
          d.dfPoolAdapterTC.address
        );
        await d.dfPoolAdapterTC.borrow(
          p.collateralAmount,
          amountToBorrow,
          d.userContract.address // receiver
        );
      }

      const afterBorrow: IDForceCalcAccountEquityResults = await d.comptroller.calcAccountEquity(d.dfPoolAdapterTC.address);
      const userBalanceAfterBorrow = await p.borrowToken.token.balanceOf(d.userContract.address);
      const afterBorrowStatus: IPoolAdapterStatus = await d.dfPoolAdapterTC.getStatus();
      console.log("after borrow:", afterBorrow, userBalanceAfterBorrow);

      // increase all health factors down on 2 times to have possibility for additional borrow
      await d.controller.setMaxHealthFactor2(maxHealthFactorUpdated2);
      await d.controller.setTargetHealthFactor2(targetHealthFactorUpdated2);
      await d.controller.setMinHealthFactor2(minHealthFactorUpdated2);
      console.log("controller", d.controller.address);
      console.log("min", await d.controller.minHealthFactor2());
      console.log("target", await d.controller.targetHealthFactor2());

      // calculate amount-to-repay and (if necessary) put the amount on userContract's balance
      const amountsToRepay = await SharedRepayToRebalanceUtils.prepareAmountsToRepayToRebalance(
        deployer,
        amountToBorrow,
        p.collateralAmount,
        d.userContract,
        p
      );

      // make repayment to rebalance
      const poolAdapterSigner = p.badPathsParams?.makeRepayToRebalanceAsDeployer
        ? IPoolAdapter__factory.connect(d.dfPoolAdapterTC.address, deployer)
        : d.dfPoolAdapterTC;

      await SharedRepayToRebalanceUtils.approveAmountToRepayToUserContract(
        poolAdapterSigner.address,
        p.collateralToken.address,
        p.borrowToken.address,
        amountsToRepay,
        d.userContract.address,
        await d.controller.tetuConverter()
      );

      await poolAdapterSigner.repayToRebalance(
        amountsToRepay.useCollateral
          ? amountsToRepay.amountCollateralAsset
          : amountsToRepay.amountBorrowAsset,
        amountsToRepay.useCollateral
      );

      const afterBorrowToRebalance: IDForceCalcAccountEquityResults = await d.comptroller.calcAccountEquity(d.dfPoolAdapterTC.address);
      const userBalanceAfterRepayToRebalance = await p.borrowToken.token.balanceOf(d.userContract.address);
      const afterBorrowToRebalanceStatus = await d.dfPoolAdapterTC.getStatus();
      console.log("after repay to rebalance:", afterBorrowToRebalance, userBalanceAfterRepayToRebalance);

      return {
        afterBorrow,
        afterRepayToRebalance: afterBorrowToRebalance,
        userBalanceAfterBorrow,
        userBalanceAfterRepayToRebalance,
        afterBorrowStatus,
        afterRepayToRebalanceStatus: afterBorrowToRebalanceStatus,
        expectedBorrowAssetAmountToRepay: amountsToRepay.useCollateral
          ? BigNumber.from(0)
          : amountsToRepay.amountBorrowAsset,
        expectedCollateralAssetAmountToRepay: amountsToRepay.useCollateral
          ? amountsToRepay.amountCollateralAsset
          : BigNumber.from(0)
      }
    }

    async function makeRepayToRebalanceTest(
      assets: IAssetsInputParamsWithCTokens,
      useCollateralAssetToRepay: boolean,
      badPathsParams?: IMakeRepayRebalanceBadPathParams
  ) : Promise<{ret: string, expected: string}> {

      const collateralToken = await TokenDataTypes.Build(deployer, assets.collateralAsset);
      const borrowToken = await TokenDataTypes.Build(deployer, assets.borrowAsset);
      console.log("collateralToken.decimals", collateralToken.decimals);
      console.log("borrowToken.decimals", borrowToken.decimals);

      const collateralAmount = getBigNumberFrom(assets.collateralAmountNum, collateralToken.decimals);
      console.log(collateralAmount, collateralAmount);

      const r = await makeRepayToRebalance({
        collateralToken,
        collateralHolder: assets.collateralHolder,
        collateralAmount,
        borrowToken,
        borrowHolder: assets.borrowHolder,
        badPathsParams,
        useCollateralAssetToRepay,
        collateralCTokenAddress: assets.collateralCTokenAddress,
        borrowCTokenAddress: assets.borrowCTokenAddress
      });

      console.log(r);

      const ret = [
        Math.round(r.afterBorrowStatus.healthFactor18.div(
          getBigNumberFrom(1, 15)).toNumber() / 10.
        ),
        Math.round(r.afterRepayToRebalanceStatus.healthFactor18.div(
          getBigNumberFrom(1, 15)).toNumber() / 10.
        ),
        // actual collateral amount after borrow is a bit less than the initial amount
        areAlmostEqual(r.afterBorrowStatus.collateralAmount, collateralAmount, 4),

        // total collateral amount is increased on expected amount after repay-to-rebalance
        areAlmostEqual(
          r.afterRepayToRebalanceStatus.collateralAmount,
          r.afterBorrowStatus.collateralAmount.add(r.expectedCollateralAssetAmountToRepay),
          4
        ),

        // total collateral amount was increased twice after repay-to-rebalance
        // when the repayment was made using collateral asset
        !useCollateralAssetToRepay || areAlmostEqual(r.afterRepayToRebalanceStatus.collateralAmount,
          r.afterBorrowStatus.collateralAmount.mul(2)
        ),

        r.afterRepayToRebalanceStatus.amountToPay
          .div(getBigNumberFrom(1, borrowToken.decimals)),
      ].join("\n");
      const expected = [
        targetHealthFactorInitial2,
        targetHealthFactorUpdated2,

        // actual collateral amount after borrow is a bit less than the initial amount
        true,

        // total collateral amount is increased on expected amount after repay-to-rebalance
        true,

        // total collateral amount was increased twice after repay-to-rebalance
        // when the repayment was made using collateral asset
        true,

        r.afterBorrowStatus.amountToPay
          .sub(r.expectedBorrowAssetAmountToRepay)
          .div(getBigNumberFrom(1, borrowToken.decimals)),
      ].join("\n");
      console.log("ret", ret);
      console.log("expected", expected);

      return {ret, expected};
    }

    async function daiWMatic(
      useCollateralAssetToRepay: boolean,
      badPathsParams?: IMakeRepayRebalanceBadPathParams
  ) : Promise<{ret: string, expected: string}> {
      const collateralAsset = MaticAddresses.DAI;
      const collateralHolder = MaticAddresses.HOLDER_DAI;
      const collateralCTokenAddress = MaticAddresses.dForce_iDAI;

      const borrowAsset = MaticAddresses.WMATIC;
      const borrowHolder = MaticAddresses.HOLDER_WMATIC;
      const borrowCTokenAddress = MaticAddresses.dForce_iMATIC;

      return makeRepayToRebalanceTest(
        {
          borrowCTokenAddress,
          collateralCTokenAddress,
          collateralAsset,
          borrowAsset,
          borrowHolder,
          collateralAmountNum: 100_000,
          collateralHolder
        },
        useCollateralAssetToRepay,
        badPathsParams
      );
    }

    async function usdcUsdt(
      useCollateralAssetToRepay: boolean,
      badPathsParams?: IMakeRepayRebalanceBadPathParams
    ) : Promise<{ret: string, expected: string}> {
      const collateralAsset = MaticAddresses.USDC;
      const collateralHolder = MaticAddresses.HOLDER_USDC;
      const collateralCTokenAddress = MaticAddresses.dForce_iUSDC;

      const borrowAsset = MaticAddresses.USDT;
      const borrowHolder = MaticAddresses.HOLDER_USDT;
      const borrowCTokenAddress = MaticAddresses.dForce_iUSDT;

      return makeRepayToRebalanceTest(
        {
          borrowCTokenAddress,
          collateralCTokenAddress,
          collateralAsset,
          borrowAsset,
          borrowHolder,
          collateralAmountNum: 100_000,
          collateralHolder
        },
        useCollateralAssetToRepay,
        badPathsParams
      );
    }

    describe("Good paths", () => {
      describe("Use borrow asset to repay", () => {
        describe("Dai : WMatic", () => {
          it("should return expected values", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await daiWMatic(false);

            expect(r.ret).eq(r.expected);
          });
        });
        describe("USDC : USDT", () => {
          it("should return expected values", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await usdcUsdt(false);

            expect(r.ret).eq(r.expected);
          });
        });
      });
      describe("Use collateral asset to repay", () => {
        describe("Dai : WMatic", () => {
          it("should return expected values", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await daiWMatic(true);

            expect(r.ret).eq(r.expected);
          });
        });
        describe("USDC : USDT", () => {
          it("should return expected values", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await usdcUsdt(true);

            expect(r.ret).eq(r.expected);
          });
        });
      });
    });

    describe("Bad paths", () => {
      describe("Not TetuConverter and not user", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            daiWMatic(false,{makeRepayToRebalanceAsDeployer: true})
          ).revertedWith("TC-32");
        });
      });
      describe("Position is not registered", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            daiWMatic(false,{skipBorrow: true})
          ).revertedWith("TC-11"); // BORROW_POSITION_IS_NOT_REGISTERED
        });
      });
      describe("Result health factor is less min allowed one", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            daiWMatic(false,{additionalAmountCorrectionFactorDiv: 100})
          ).revertedWith("TC-3: wrong health factor");
        });
      });
      describe("Try to repay amount greater then the debt", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          await expect(
            daiWMatic(false,{additionalAmountCorrectionFactorMul: 100})
          ).revertedWith("TC-40"); // REPAY_TO_REBALANCE_NOT_ALLOWED
        });
      });
    });
  });

  describe("TODO:updateBalance", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        expect.fail("TODO");
      });
    });
    describe("Bad paths", () => {
      describe("", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          expect.fail("TODO");
        });
      });
    });
  });

  describe("TODO:initialize", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        expect.fail("TODO");
      });
    });
    describe("Bad paths", () => {
      describe("", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          expect.fail("TODO");
        });
      });
    });
  });

  describe("claimRewards", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        const receiver = ethers.Wallet.createRandom().address;
        const comptroller = await DForceHelper.getController(deployer);
        const rd = IDForceRewardDistributor__factory.connect(await comptroller.rewardDistributor(), deployer);
        const rewardToken = await rd.rewardToken();

        // make a borrow
        const r = await testBorrowDaiUsdc(100_000, undefined);
        // wait a bit and check rewards
        await TimeUtils.advanceNBlocks(100);

        const balanceRewardsBefore = await IERC20__factory.connect(rewardToken, deployer).balanceOf(receiver);
        const {rewardTokenOut, amountOut} = await r.prepareResults.dfPoolAdapterTC.callStatic.claimRewards(receiver);
        await r.prepareResults.dfPoolAdapterTC.claimRewards(receiver);
        const balanceRewardsAfter = await IERC20__factory.connect(rewardToken, deployer).balanceOf(receiver);

        console.log("balanceRewardsBefore", balanceRewardsBefore);
        console.log("balanceRewardsAfter", balanceRewardsAfter);
        console.log("amountOut", amountOut);
        console.log("rewardTokenOut", rewardTokenOut);

        const ret = [
          rewardTokenOut,
          amountOut.gt(0),

          // the amounts are not equal because callStatic.claimRewards gives a bit fewer values then next claimRewards
          balanceRewardsAfter.gt(amountOut),
          balanceRewardsAfter.sub(balanceRewardsBefore).eq(0)
        ].join();
        const expected = [
          rewardToken,
          true,

          true,
          false
        ].join();
        expect(ret).eq(expected);
      });
    });
  });

  describe("getConversionKind", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        const d = await DForceTestUtils.prepareToBorrow(
          deployer,
          await TokenDataTypes.Build(deployer, MaticAddresses.DAI),
          MaticAddresses.HOLDER_DAI,
          MaticAddresses.dForce_iDAI,
          undefined,
          await TokenDataTypes.Build(deployer, MaticAddresses.WMATIC),
          MaticAddresses.dForce_iMATIC,
        );
        const ret = await d.dfPoolAdapterTC.getConversionKind();
        expect(ret).eq(2); // CONVERSION_KIND_BORROW_2
      });
    });
  });

  describe("getConfig", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        const d = await DForceTestUtils.prepareToBorrow(
          deployer,
          await TokenDataTypes.Build(deployer, MaticAddresses.DAI),
          MaticAddresses.HOLDER_DAI,
          MaticAddresses.dForce_iDAI,
          undefined,
          await TokenDataTypes.Build(deployer, MaticAddresses.WMATIC),
          MaticAddresses.dForce_iMATIC,
        );
        const r = await d.dfPoolAdapterTC.getConfig();
        const ret = [
          r.outCollateralAsset,
          r.outBorrowAsset,
          r.outUser,
          r.origin
        ].join();
        const expected = [
          MaticAddresses.DAI,
          MaticAddresses.WMATIC,
          d.userContract.address,
          d.converterNormal
        ].join();
        expect(ret).eq(expected);
      });
    });
  });

  describe("TODO:getStatus", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        expect.fail("TODO");
      });
    });
    describe("Bad paths", () => {
      describe("", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          expect.fail("TODO");
        });
      });
    });
  });

  describe("TODO:getAPR18", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        expect.fail("TODO");
      });
    });
    describe("Bad paths", () => {
      describe("", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;
          expect.fail("TODO");
        });
      });
    });
  });
//endregion Unit tests

});