import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {
  ConverterController,
  IDForceCToken__factory,
  IERC20Metadata__factory,
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
import {Misc} from "../../../scripts/utils/Misc";
import {areAlmostEqual} from "../../baseUT/utils/CommonUtils";
import {transferAndApprove} from "../../baseUT/utils/transferUtils";
import {DForceTestUtils, IPrepareToBorrowResults} from "../../baseUT/protocols/dforce/DForceTestUtils";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {DForceHelper} from "../../../scripts/integration/helpers/DForceHelper";
import {TetuConverterApp} from "../../baseUT/helpers/TetuConverterApp";
import {GAS_LIMIT} from "../../baseUT/GasLimit";
import {DForceChangePriceUtils} from "../../baseUT/protocols/dforce/DForceChangePriceUtils";


describe("DForcePoolAdapterIntTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let controllerInstance: ConverterController;
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
    controllerInstance = await TetuConverterApp.createController(deployer);
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
      controllerInstance,
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
      borrowAmountRequired
        ? borrowAmountRequired
        : d.amountToBorrow, // borrowed amount on user's balance
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

  async function testBorrowWbtcMatic(
    collateralAmountNum: number | undefined,
    borrowAmountNum: number | undefined
  ) : Promise<{ret: string, expected: string, prepareResults: IPrepareToBorrowResults}> {
    const collateralAsset = MaticAddresses.WBTC;
    const collateralHolder = MaticAddresses.HOLDER_WBTC;
    const collateralCTokenAddress = MaticAddresses.dForce_iWBTC;

    const borrowAsset = MaticAddresses.WMATIC;
    const borrowCTokenAddress = MaticAddresses.dForce_iMATIC;

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
        describe("WBTC : Matic", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await testBorrowWbtcMatic(1, 10);
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
  });

  describe("Borrow using small health factors", () => {
    interface ITestSmallHealthFactorResults {
      d: IPrepareToBorrowResults;
      resultHealthFactor18: BigNumber;
    }
    async function makeTestSmallHealthFactor(
      collateralAsset: string,
      collateralHolder: string,
      collateralCToken: string,
      borrowAsset: string,
      borrowCToken: string,
      targetHealthFactor2: number,
      minHealthFactor2: number
    ) : Promise<ITestSmallHealthFactorResults> {

      const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
      const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

      const collateralAmount = parseUnits("20000", 6);

      const d = await DForceTestUtils.prepareToBorrow(
        deployer,
        controllerInstance,
        collateralToken,
        collateralHolder,
        collateralCToken,
        collateralAmount,
        borrowToken,
        borrowCToken,
        {
          targetHealthFactor2
        }
      );

      await d.controller.setMinHealthFactor2(minHealthFactor2);
      await d.controller.setTargetHealthFactor2(targetHealthFactor2);

      await DForceTestUtils.makeBorrow(deployer, d, undefined);
      const r = await d.dfPoolAdapterTC.getStatus();
      return {
        d,
        resultHealthFactor18: r.healthFactor18
      }
    }
    describe("Good paths", () => {
      describe("health factor is less than liquidationThreshold18/LTV", () => {
        /**
         * Coverage for the following condition, else case:
         *    DForcePlatformAdapter.getConversionPlan:
         *       if (vars.healthFactor18 < uint(healthFactor2_) * 10**(18 - 2)) { ... }
         */
        it("should borrow with health factor = liquidationThreshold18/LTV", async () => {
          const targetHealthFactor2 = 101;

          const collateralAsset = MaticAddresses.USDC;
          const collateralCToken = MaticAddresses.dForce_iUSDC;
          const collateralHolder = MaticAddresses.HOLDER_USDC;
          const borrowAsset = MaticAddresses.DAI;
          const borrowCToken = MaticAddresses.dForce_iDAI;

          // we need to modify borrowFactorMantissa manually to make minHealthFactorAllowedByPlatform > 1
          await DForceChangePriceUtils.setBorrowFactor(
            deployer,
            MaticAddresses.dForce_iDAI,
            parseUnits("0.95", 18)
          );

          const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
          const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

          const collateralAmount = parseUnits("20000", 6);

          const d = await DForceTestUtils.prepareToBorrow(
            deployer,
            controllerInstance,
            collateralToken,
            collateralHolder,
            collateralCToken,
            collateralAmount,
            borrowToken,
            borrowCToken,
            {
              targetHealthFactor2
            }
          );

          const healthFactor = +formatUnits(d.plan.amountCollateralInBorrowAsset36.div(d.plan.amountToBorrow), 18);
          const expectedHealthFactor = 1 / (+formatUnits(d.plan.liquidationThreshold18, 18) * 0.95);

          expect(healthFactor).to.equal(expectedHealthFactor);
        });
      });
      describe("health factor is greater than liquidationThreshold18/LTV", () => {
        it("should borrow with specified health factor", async () => {
          const targetHealthFactor2 = 108;
          const minHealthFactor2 = 101;

          const collateralAsset = MaticAddresses.USDC;
          const collateralCToken = MaticAddresses.dForce_iUSDC;
          const collateralHolder = MaticAddresses.HOLDER_USDC;
          const borrowAsset = MaticAddresses.DAI;
          const borrowCToken = MaticAddresses.dForce_iDAI;

          const r = await makeTestSmallHealthFactor(
            collateralAsset,
            collateralHolder,
            collateralCToken,
            borrowAsset,
            borrowCToken,
            targetHealthFactor2,
            minHealthFactor2
          );
          const collateralInfo = await DForceHelper.getCTokenData(
            deployer,
            await DForceHelper.getController(deployer),
            IDForceCToken__factory.connect(collateralCToken, deployer)
          );
          const minHealthFactorAllowedByPlatform = +formatUnits(collateralInfo.borrowFactorMantissa,18);
          const healthFactor = +formatUnits(r.resultHealthFactor18, 18);

          console.log("healthFactor", healthFactor);
          console.log("minHealthFactorAllowedByPlatform", minHealthFactorAllowedByPlatform);
          const ret = [
            targetHealthFactor2 > minHealthFactorAllowedByPlatform,
            healthFactor >= targetHealthFactor2/100 - 1,
            healthFactor <= targetHealthFactor2/100 + 1
          ].join();
          const expected = [true, true, true].join();

          expect(ret).eq(expected);
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
        controllerInstance,
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
        await d.dfPoolAdapterTC.borrow(d.collateralAmount, borrowAmount, d.userContract.address, {gasLimit: GAS_LIMIT});
      }
      const statusAfterBorrow = await d.dfPoolAdapterTC.getStatus();
      console.log("statusAfterBorrow", statusAfterBorrow);
      const afterBorrow: IUserBalances = {
        collateral: await collateralToken.token.balanceOf(d.userContract.address),
        borrow: await borrowToken.token.balanceOf(d.userContract.address)
      };
      console.log(afterBorrow);
      await TimeUtils.advanceNBlocks(1000);

      const borrowTokenAsUser = IERC20Metadata__factory.connect(
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
          badParams?.forceToClosePosition || false,
          {gasLimit: GAS_LIMIT}
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
        100,
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

          await expect(
            daiUSDC(
              false,
              false,
              undefined,
              {
                repayAsNotUserAndNotTC: true
              }
            )
          ).revertedWith("TC-8 tetu converter only"); // ETU_CONVERTER_ONLY
        });
      });
      describe("Transfer amount less than specified amount to repay", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;

          const usdcDecimals = await IERC20Metadata__factory.connect(MaticAddresses.USDC, deployer).decimals();
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
          ).revertedWith("TC-28 zero balance"); // ZERO_BALANCE
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
          ).revertedWith("TC-55 close position not allowed"); // CLOSE_POSITION_PARTIAL
        });
      });
    });
  });

//endregion Unit tests

});