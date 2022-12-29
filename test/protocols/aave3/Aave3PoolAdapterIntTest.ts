import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {
  IERC20Metadata__factory, IPoolAdapter__factory
} from "../../../typechain";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";
import {IAave3ReserveInfo} from "../../../scripts/integration/helpers/Aave3Helper";
import {BalanceUtils, IUserBalances} from "../../baseUT/utils/BalanceUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {TokenDataTypes} from "../../baseUT/types/TokenDataTypes";
import {Misc} from "../../../scripts/utils/Misc";
import {IAave3UserAccountDataResults} from "../../baseUT/apr/aprAave3";
import {
  AaveMakeBorrowAndRepayUtils, IBorrowAndRepayBadParams,
  IMakeBorrowAndRepayResults
} from "../../baseUT/protocols/aaveShared/aaveBorrowAndRepayUtils";
import {AaveBorrowUtils} from "../../baseUT/protocols/aaveShared/aaveBorrowUtils";
import {transferAndApprove} from "../../baseUT/utils/transferUtils";
import {
  Aave3TestUtils,
  IPrepareToBorrowResults,
} from "../../baseUT/protocols/aave3/Aave3TestUtils";
import {parseUnits} from "ethers/lib/utils";

describe("Aave3PoolAdapterIntTest", () => {
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

//region Unit tests
  describe("borrow", () => {
    async function makeBorrowTest(
      collateralToken: TokenDataTypes,
      collateralHolder: string,
      collateralAmountRequired: BigNumber | undefined,
      borrowToken: TokenDataTypes,
      borrowAmountRequired: BigNumber | undefined
    ): Promise<{ sret: string, sexpected: string }> {
      const d = await Aave3TestUtils.prepareToBorrow(
        deployer,
        collateralToken,
        [collateralHolder],
        collateralAmountRequired,
        borrowToken,
        false
      );
      const ret = await Aave3TestUtils.makeBorrow(deployer, d, borrowAmountRequired);

      const sret = [
        await borrowToken.token.balanceOf(d.userContract.address),
        await IERC20Metadata__factory.connect(ret.collateralData.data.aTokenAddress, deployer)
          .balanceOf(d.aavePoolAdapterAsTC.address),
        ret.accountDataAfterBorrow.totalCollateralBase,
        ret.accountDataAfterBorrow.totalDebtBase
      ].map(x => BalanceUtils.toString(x)).join("\n");

      const sexpected = [
        ret.borrowedAmount, // borrowed amount on user's balance
        d.collateralAmount, // amount of collateral tokens on pool-adapter's balance
        d.collateralAmount.mul(d.priceCollateral)  // registered collateral in the pool
          .div(getBigNumberFrom(1, collateralToken.decimals)),
        ret.borrowedAmount.mul(d.priceBorrow) // registered debt in the pool
          .div(getBigNumberFrom(1, borrowToken.decimals)),
      ].map(x => BalanceUtils.toString(x)).join("\n");

      return {sret, sexpected};
    }

    describe("Good paths", () => {
      describe("Borrow fixed small amount", () => {
        describe("DAI-18 : matic-18", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await AaveBorrowUtils.daiWMatic(
              deployer,
              makeBorrowTest,
              100_000,
              10
            );
            expect(r.ret).eq(r.expected);
          });
        });
        describe("DAI-18 : USDC-6", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;

            const r = await AaveBorrowUtils.daiUsdc(
              deployer,
              makeBorrowTest,
              100_000,
              10
            );
            expect(r.ret).eq(r.expected);
          });
        });
        describe("STASIS EURS-2 : Tether-6", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;

            const r = await AaveBorrowUtils.eursTether(
              deployer,
              makeBorrowTest,
              100_000,
              10
            );
            expect(r.ret).eq(r.expected);
          });
        });
        describe("USDC-6 : DAI-18", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;

            const r = await AaveBorrowUtils.eursTether(
              deployer,
              makeBorrowTest,
              100_000,
              10
            );
            expect(r.ret).eq(r.expected);
          });
        });
        describe("WBTC-8 : Tether-6", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;

            const r = await AaveBorrowUtils.wbtcTether(
              deployer,
              makeBorrowTest,
              100,
              10
            );
            expect(r.ret).eq(r.expected);
          });
        });
      });
      describe("Borrow max available amount using all available collateral", () => {
        describe("DAI-18 : matic-18", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;
            const r = await AaveBorrowUtils.daiWMatic(
              deployer,
              makeBorrowTest,
              undefined,
              undefined
            );
            expect(r.ret).eq(r.expected);
          });
        });
        describe("DAI-18 : USDC-6", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;

            const r = await AaveBorrowUtils.daiUsdc(
              deployer,
              makeBorrowTest,
              undefined,
              undefined
            );
            expect(r.ret).eq(r.expected);
          });
        });
        describe("STASIS EURS-2 : Tether-6", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;

            const r = await AaveBorrowUtils.eursTether(
              deployer,
              makeBorrowTest,
              undefined,
              undefined
            );
            expect(r.ret).eq(r.expected);
          });
        });
        describe("USDC-6 : DAI-18", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;

            const r = await AaveBorrowUtils.eursTether(
              deployer,
              makeBorrowTest,
              undefined,
              undefined
            );
            expect(r.ret).eq(r.expected);
          });
        });
        describe("WBTC-8 : Tether-6", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;

            const r = await AaveBorrowUtils.wbtcTether(
              deployer,
              makeBorrowTest,
              undefined,
              undefined
            );
            expect(r.ret).eq(r.expected);
          });
        });
      });
     });
  });

  /**
   *                LTV                LiquidationThreshold
   * DAI:           0.75               0.8
   * WMATIC:        0.65               0.7
   *
   * LTV: what amount of collateral we can use to borrow
   * LiquidationThreshold: if borrow amount exceeds collateral*LiquidationThreshold => liquidation
   *
   * Let's ensure in following test, that LTV and LiquidationThreshold of collateral are used
   * in calculations inside getUserAccountData. The values of borrow asset don't matter there
   */
  describe("Borrow: check LTV and liquidationThreshold", () => {
    async function makeTestBorrowMaxAmount(
      collateralToken: TokenDataTypes,
      collateralHolder: string,
      collateralAmount: BigNumber,
      borrowToken: TokenDataTypes,
    ): Promise<{userAccountData: IAave3UserAccountDataResults, collateralData: IAave3ReserveInfo}> {
      const minHealthFactor2 = 101;
      const targetHealthFactor2 = 202;
      const d = await Aave3TestUtils.prepareToBorrow(deployer,
        collateralToken,
        [collateralHolder],
        collateralAmount,
        borrowToken,
        false,
        {targetHealthFactor2}
      );
      await d.controller.setMinHealthFactor2(minHealthFactor2);
      await d.controller.setTargetHealthFactor2(targetHealthFactor2);
      const collateralData = await d.h.getReserveInfo(deployer, d.aavePool, d.dataProvider, collateralToken.address);
      console.log("collateralData", collateralData);

      // prices of assets in base currency
      const prices = await d.aavePrices.getAssetsPrices([collateralToken.address, borrowToken.address]);
      console.log("prices", prices);

      // let's manually calculate max allowed amount to borrow
      const collateralAmountInBase18 = collateralAmount
        .mul(prices[0])
        .div(getBigNumberFrom(1, collateralToken.decimals));
      const maxAllowedAmountToBorrowInBase18 = collateralAmountInBase18
        .mul(100) // let's take into account min allowed health factor
        .div(minHealthFactor2)
        .mul(collateralData.data.ltv)
        .div(1e4);
      const maxAllowedAmountToBorrow = maxAllowedAmountToBorrowInBase18
        .div(prices[1])
        .mul(getBigNumberFrom(1, borrowToken.decimals));
      console.log("collateralAmountInBase18", collateralAmountInBase18);
      console.log("maxAllowedAmountToBorrowInBase18", maxAllowedAmountToBorrowInBase18);
      console.log("maxAllowedAmountToBorrow", maxAllowedAmountToBorrow);

      await transferAndApprove(
        collateralToken.address,
        d.userContract.address,
        await d.controller.tetuConverter(),
        d.collateralAmount,
        d.aavePoolAdapterAsTC.address
      );

      await d.aavePoolAdapterAsTC.borrow(
        collateralAmount,
        maxAllowedAmountToBorrow,
        d.userContract.address
      );
      console.log("amountToBorrow", maxAllowedAmountToBorrow);

      // check results
      const ret = await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address);
      console.log(ret);
      return {
        userAccountData: ret,
        collateralData
      }
    }
    describe("Good paths", () => {
      it("should move user account in the pool to expected state", async () => {
        if (!await isPolygonForkInUse()) return;

        const collateralAsset = MaticAddresses.DAI;
        const collateralHolder = MaticAddresses.HOLDER_DAI;
        const borrowAsset = MaticAddresses.WMATIC;

        const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
        const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

        const collateralAmount = getBigNumberFrom(100_000, collateralToken.decimals);

        const r = await makeTestBorrowMaxAmount(
          collateralToken
          , collateralHolder
          , collateralAmount
          , borrowToken
        );
        console.log(r);

        const ret = [
          r.userAccountData.ltv,
          r.userAccountData.currentLiquidationThreshold,
          r.userAccountData.totalDebtBase
            .add(r.userAccountData.availableBorrowsBase)
            .mul(1e4)
            .div(r.userAccountData.totalCollateralBase)
        ].map(x => BalanceUtils.toString(x)).join("\n");

        const expected = [
          r.collateralData.data.ltv,
          r.collateralData.data.liquidationThreshold,
          r.collateralData.data.ltv
        ].map(x => BalanceUtils.toString(x)).join("\n");

        expect(ret).eq(expected);
      });
    });
  });

  describe("Borrow in isolated mode", () => {
//region Utils
    interface IBorrowMaxAmountInIsolationModeResults {
      init: IPrepareToBorrowResults;
      maxBorrowAmount: BigNumber;
      maxBorrowAmountByPlan: BigNumber;
      isolationModeTotalDebtDelta: BigNumber;
    }

    interface IBorrowMaxAmountInIsolationModeBadPaths {
      customAmountToBorrow?: BigNumber;
      deltaToMaxAmount?: BigNumber;
    }

    /**
     * Calculate max allowed borrow amount in isolation mode manually and using getConversionPlan
     * Try to make borrow of (the max allowed amount + optional delta)
     */
    async function borrowMaxAmountInIsolationMode (
      collateralToken: TokenDataTypes,
      collateralHolders: string[],
      collateralAmountRequired: BigNumber | undefined,
      borrowToken: TokenDataTypes,
      borrowHolders: string[],
      emode: boolean,
      badPathsParams?: IBorrowMaxAmountInIsolationModeBadPaths
    ) : Promise<IBorrowMaxAmountInIsolationModeResults>{
      const d = await Aave3TestUtils.prepareToBorrow(deployer,
        collateralToken,
        collateralHolders,
        collateralAmountRequired,
        borrowToken,
        emode,
        {borrowHolders}
      );
      console.log("Plan", d.plan);

      const collateralDataBefore = await d.h.getReserveInfo(deployer, d.aavePool, d.dataProvider, collateralToken.address);
      console.log("collateralDataBefore", collateralDataBefore);

      // calculate max amount to borrow manually
      const maxBorrowAmount = d.plan.maxAmountToBorrow;

      await transferAndApprove(
        collateralToken.address,
        d.userContract.address,
        await d.controller.tetuConverter(),
        d.collateralAmount,
        d.aavePoolAdapterAsTC.address
      );

      const amountToBorrow = badPathsParams?.deltaToMaxAmount
        ? maxBorrowAmount // restore real max amount
          .mul(100) // Aave3PlatformAdapter.MAX_BORROW_AMOUNT_FACTOR_DENOMINATOR
          .div(90)  // Aave3PlatformAdapter.MAX_BORROW_AMOUNT_FACTOR
          .add(badPathsParams?.deltaToMaxAmount)
        : badPathsParams?.customAmountToBorrow
          ? badPathsParams?.customAmountToBorrow
          : maxBorrowAmount;

      console.log("Try to borrow", maxBorrowAmount);

      await d.aavePoolAdapterAsTC.borrow(
        d.collateralAmount,
        amountToBorrow,
        d.userContract.address
      );

      // after borrow
      const collateralDataAfter = await d.h.getReserveInfo(deployer, d.aavePool, d.dataProvider, collateralToken.address);
      console.log("collateralDataAfter", collateralDataAfter);
      const isolationModeTotalDebtDelta = BigNumber.from(collateralDataAfter.data.isolationModeTotalDebt)
        .sub(BigNumber.from(collateralDataBefore.data.isolationModeTotalDebt));
      console.log("isolationModeTotalDebtDelta", isolationModeTotalDebtDelta);

      return {
        init: d,
        maxBorrowAmount,
        maxBorrowAmountByPlan: d.plan.maxAmountToBorrow,
        isolationModeTotalDebtDelta
      }
    }
//endregion Utils

    describe("Good paths", () => {
      describe("USDT : DAI", () => {
//region Constants
        const collateralAsset = MaticAddresses.USDT;
        const borrowAsset = MaticAddresses.DAI;
        const collateralHolders = [
          MaticAddresses.HOLDER_USDT,
          MaticAddresses.HOLDER_USDT_1,
          MaticAddresses.HOLDER_USDT_2,
          MaticAddresses.HOLDER_USDT_3
        ];
        const borrowHolders = [
          MaticAddresses.HOLDER_DAI,
          MaticAddresses.HOLDER_DAI_2,
          MaticAddresses.HOLDER_DAI_3,
          MaticAddresses.HOLDER_DAI_4,
          MaticAddresses.HOLDER_DAI_5,
          MaticAddresses.HOLDER_DAI_6
        ];
//endregion Constants
        describe("Try to borrow max amount allowed by debt ceiling", () => {
          it("should return expected values", async () => {
            if (!await isPolygonForkInUse()) return;

            const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
            const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

            const ret = await borrowMaxAmountInIsolationMode(
              collateralToken,
              collateralHolders,
              undefined,
              borrowToken,
              borrowHolders,
              true // emode
            );

            const sret = ret.maxBorrowAmount.toString();
            const sexpected = ret.maxBorrowAmountByPlan.toString();

            expect(sret).eq(sexpected);
          });
        });
      });

      /**
       * The test is disabled
       * because currently there is not enough EURO
       * to cover max allowed amount of USDC or DAI
       */
      describe.skip("EURS : DAI", () => {
        const collateralAsset = MaticAddresses.EURS;
        const borrowAsset = MaticAddresses.DAI;
        const collateralHolders = [
          MaticAddresses.HOLDER_EURS,
          MaticAddresses.HOLDER_EURS_2,
          MaticAddresses.HOLDER_EURS_3,
          MaticAddresses.HOLDER_EURS_4,
          MaticAddresses.HOLDER_EURS_5,
          MaticAddresses.HOLDER_EURS_6,
          MaticAddresses.HOLDER_EURS_7,
          MaticAddresses.HOLDER_EURS_8,
          MaticAddresses.HOLDER_EURS_9,
        ];
        const borrowHolders = [MaticAddresses.HOLDER_DAI];

        describe("Try to borrow max amount allowed by debt ceiling", () => {
          it("should return expected values", async () => {
            if (!await isPolygonForkInUse()) return;
            const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
            const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

            const ret = await borrowMaxAmountInIsolationMode(
              collateralToken,
              collateralHolders,
              undefined,
              borrowToken,
              borrowHolders,
              true // emode
            );

            const sret = ret.maxBorrowAmount.toString();
            const sexpected = ret.maxBorrowAmountByPlan.toString();

            // Error 36 means "there is not enough EURO on balances of the EURO holders
            expect(sret).eq(sexpected);
          });
        });
      });

      describe("EURS : USDT", () => {
        const collateralAsset = MaticAddresses.EURS;
        const borrowAsset = MaticAddresses.USDT;
        const collateralHolders = [
          MaticAddresses.HOLDER_EURS,
          MaticAddresses.HOLDER_EURS_2,
          MaticAddresses.HOLDER_EURS_3,
          MaticAddresses.HOLDER_EURS_4,
          MaticAddresses.HOLDER_EURS_5,
          MaticAddresses.HOLDER_EURS_6,
          MaticAddresses.HOLDER_EURS_7,
          MaticAddresses.HOLDER_EURS_8,
          MaticAddresses.HOLDER_EURS_9,
        ];
        const borrowHolders = [MaticAddresses.HOLDER_USDT];

        describe("Try to borrow max amount allowed by debt ceiling", () => {
          it("should return expected values", async () => {
            if (!await isPolygonForkInUse()) return;
            const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
            const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

            const ret = await borrowMaxAmountInIsolationMode(
              collateralToken,
              collateralHolders,
              undefined,
              borrowToken,
              borrowHolders,
              true // emode
            );

            const sret = ret.maxBorrowAmount.toString();
            const sexpected = ret.maxBorrowAmountByPlan.toString();

            // Error 36 means "there is not enough EURO on balances of the EURO holders
            expect(sret).eq(sexpected);
          });
        });
      });
    });

    describe("Bad paths", () => {
      describe("Debt ceiling exceeded", () => {
        describe("USDT : DAI", () => {
//region Constants
          const collateralAsset = MaticAddresses.USDT;
          const borrowAsset = MaticAddresses.DAI;
          const collateralHolders = [
            MaticAddresses.HOLDER_USDT,
            MaticAddresses.HOLDER_USDT_1,
            MaticAddresses.HOLDER_USDT_2,
            MaticAddresses.HOLDER_USDT_3
          ];
          const borrowHolders = [
            MaticAddresses.HOLDER_DAI,
            MaticAddresses.HOLDER_DAI_2,
            MaticAddresses.HOLDER_DAI_3,
            MaticAddresses.HOLDER_DAI_4,
            MaticAddresses.HOLDER_DAI_5,
            MaticAddresses.HOLDER_DAI_6
          ];
//endregion Constants
          describe("Try to borrow max amount allowed by debt ceiling", () => {
            it("should return expected values", async () => {
              if (!await isPolygonForkInUse()) return;

              const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
              const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

              await expect(
                borrowMaxAmountInIsolationMode(
                  collateralToken,
                  collateralHolders,
                  undefined,
                  borrowToken,
                  borrowHolders,
                  true, // emode
                  {deltaToMaxAmount: Misc.WEI} // 1 DAI
                )
              ).revertedWith("50"); // 50 or 53 are allowed here
            });
          });
        });
        describe("EURS : USDC", () => {
//region Constants
          const collateralAsset = MaticAddresses.EURS;
          const borrowAsset = MaticAddresses.USDC;
          const collateralHolders = [MaticAddresses.HOLDER_EURS
            , MaticAddresses.HOLDER_EURS_2
            , MaticAddresses.HOLDER_EURS_3
          ];
          const borrowHolders = [MaticAddresses.HOLDER_USDC];
//endregion Constants

          describe("Try to borrow max amount allowed by debt ceiling", () => {
            it("should return expected values", async () => {
              if (!await isPolygonForkInUse()) return;
              const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
              const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

              await expect(
                borrowMaxAmountInIsolationMode(
                  collateralToken,
                  collateralHolders,
                  undefined,
                  borrowToken,
                  borrowHolders,
                  true, // emode
                  {deltaToMaxAmount: parseUnits("1", 6)} // 1 USDC
                )
              ).revertedWith("53");
            });
          });
        });
      });
      describe("Not borrowable in isolation mode", () => {
        describe("USDT : WETH", () => {
//region Constants
          const collateralAsset = MaticAddresses.USDT;
          const borrowAsset = MaticAddresses.WETH;
          const collateralHolders = [
            MaticAddresses.HOLDER_USDT,
            MaticAddresses.HOLDER_USDT_1,
            MaticAddresses.HOLDER_USDT_2,
            MaticAddresses.HOLDER_USDT_3
          ];
          const borrowHolders = [
            MaticAddresses.HOLDER_WETH,
          ];
//endregion Constants
          describe("Try to borrow not zero amount", () => {
            it("should return expected values", async () => {
              if (!await isPolygonForkInUse()) return;
              const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
              const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

              await expect(
                borrowMaxAmountInIsolationMode(
                  collateralToken,
                  collateralHolders,
                  undefined,
                  borrowToken,
                  borrowHolders,
                  true, // emode
                  {
                    customAmountToBorrow: parseUnits("1")
                  }
                )
              ).revertedWith("60");
            });
          });
        });
      });
    });
  });

  describe("repay", () => {
    /* Make full or partial repay. Set amountToRepay for partial repay, leave it undefined to full repay */
    async function makeBorrowAndRepay(
      collateralToken: TokenDataTypes,
      collateralHolder: string,
      collateralAmountRequired: BigNumber | undefined,
      borrowToken: TokenDataTypes,
      borrowHolder: string,
      borrowAmountRequired: BigNumber | undefined,
      amountToRepay?: BigNumber,
      initialBorrowAmountOnUserBalance?: BigNumber,
      badParams?: IBorrowAndRepayBadParams
    ) : Promise<IMakeBorrowAndRepayResults>{
      const d = await Aave3TestUtils.prepareToBorrow(deployer,
        collateralToken,
        [collateralHolder],
        collateralAmountRequired,
        borrowToken,
        false
      );
      const collateralData = await d.h.getReserveInfo(deployer, d.aavePool, d.dataProvider, collateralToken.address);
      const borrowAmount = borrowAmountRequired
        ? borrowAmountRequired
        : d.amountToBorrow;
      console.log("collateralAmountRequired", collateralAmountRequired);
      console.log("borrowAmountRequired", borrowAmountRequired);
      console.log("d.collateralAmount", d.collateralAmount);
      console.log("borrowAmount", borrowAmount);

      // borrow asset
      if (initialBorrowAmountOnUserBalance) {
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
          d.aavePoolAdapterAsTC.address
        );

        await d.aavePoolAdapterAsTC.borrow(
          d.collateralAmount,
          borrowAmount,
          d.userContract.address
        );
      }

      const afterBorrow: IUserBalances = {
        collateral: await collateralToken.token.balanceOf(d.userContract.address),
        borrow: await borrowToken.token.balanceOf(d.userContract.address)
      };
      console.log("afterBorrow", afterBorrow);

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
            d.aavePoolAdapterAsTC.address,
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
          d.aavePoolAdapterAsTC.address
        );

        await poolAdapterAsCaller.repay(
          amountToRepay,
          d.userContract.address,
          // normally we don't close position here
          // but in bad paths we need to emulate attempts to close the position
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

      // check results
      const afterRepay: IUserBalances = {
        collateral: await collateralToken.token.balanceOf(d.userContract.address),
        borrow: await borrowToken.token.balanceOf(d.userContract.address)
      };
      console.log("afterRepay", afterRepay);

      const ret = await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address);

      return {
        userBalancesBeforeBorrow: beforeBorrow,
        userBalancesAfterBorrow: afterBorrow,
        userBalancesAfterRepay: afterRepay,
        paATokensBalance: await IERC20Metadata__factory.connect(collateralData.data.aTokenAddress, deployer)
          .balanceOf(d.aavePoolAdapterAsTC.address),
        totalCollateralBase: ret.totalCollateralBase,
        totalDebtBase: ret.totalDebtBase,
        poolAdapter: d.aavePoolAdapterAsTC.address,
        collateralAmount: d.collateralAmount,
        borrowAmount
      }
    }
    describe("Good paths", () => {
      describe("Borrow and repay modest amount", () => {
        describe("Partial repay of borrowed amount", () => {
          describe("DAI => WMATIC", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const r = await AaveMakeBorrowAndRepayUtils.daiWmatic(
                deployer,
                makeBorrowAndRepay,
                false,
                false
              );
              expect(r.ret).eq(r.expected);
            });
          });
          describe("WMATIC => DAI", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const r = await AaveMakeBorrowAndRepayUtils.daiWmatic(
                deployer,
                makeBorrowAndRepay,
                false,
                false
              );
              expect(r.ret).eq(r.expected);
            });
          });
        });
        describe("Full repay of borrowed amount", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;
            const initialBorrowAmountOnUserBalance = 1;
            const r = await AaveMakeBorrowAndRepayUtils.daiWmatic(
              deployer,
              makeBorrowAndRepay,
              true,
              false,
              initialBorrowAmountOnUserBalance
            );
            expect(r.ret).eq(r.expected);
          });
        });
      });
      describe("Borrow max available amount using all available collateral", () => {
        describe("Full repay of borrowed amount", () => {
          describe("DAI => WMATIC", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const initialBorrowAmountOnUserBalance = 1000;
              const r = await AaveMakeBorrowAndRepayUtils.daiWmatic(
                deployer,
                makeBorrowAndRepay,
                true,
                true,
                initialBorrowAmountOnUserBalance
              );
              expect(r.ret).eq(r.expected);
            });
          });
          describe("WMATIC => DAI", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;
              const initialBorrowAmountOnUserBalance = 1000;
              const r = await AaveMakeBorrowAndRepayUtils.daiWmatic(
                deployer,
                makeBorrowAndRepay,
                true,
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
      describe("Transfer amount less than specified amount to repay", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;

          const daiDecimals = await IERC20Metadata__factory.connect(MaticAddresses.DAI, deployer).decimals();
          await expect(
            AaveMakeBorrowAndRepayUtils.wmaticDai(
              deployer,
              makeBorrowAndRepay,
              false,
              false,
              undefined,
              {
                // try to transfer too small amount on balance of the pool adapter
                wrongAmountToRepayToTransfer: getBigNumberFrom(1, daiDecimals)
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
            AaveMakeBorrowAndRepayUtils.daiWmatic(
              deployer,
              makeBorrowAndRepay,
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
            AaveMakeBorrowAndRepayUtils.daiWmatic(
              deployer,
              makeBorrowAndRepay,
              false,
              false,
              undefined,
              {forceToClosePosition: true}
            )
          ).revertedWith("TC-24 close position failed"); // CLOSE_POSITION_FAILED
        });
      });
    });
  });

//endregion Unit tests

});