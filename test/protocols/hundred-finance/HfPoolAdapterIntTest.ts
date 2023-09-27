import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {
  IERC20Metadata__factory,
  IHfCToken__factory,
  IPoolAdapter__factory
} from "../../../typechain";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {BalanceUtils, IUserBalances} from "../../baseUT/utils/BalanceUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {TokenDataTypes} from "../../baseUT/types/TokenDataTypes";
import {Misc} from "../../../scripts/utils/Misc";
import {transferAndApprove} from "../../baseUT/utils/transferUtils";
import {
  HundredFinanceTestUtils,
  IPrepareToBorrowResults
} from "../../baseUT/protocols/hundred-finance/HundredFinanceTestUtils";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {GAS_LIMIT} from "../../baseUT/GasLimit";
import {HardhatUtils, POLYGON_NETWORK_ID} from "../../../scripts/utils/HardhatUtils";

describe.skip("HfPoolAdapterIntTest", () => {

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

//region Test impl
  async function makeBorrow(
    collateralToken: TokenDataTypes,
    collateralCToken: TokenDataTypes,
    collateralHolder: string,
    collateralAmountRequired: BigNumber | undefined,
    borrowToken: TokenDataTypes,
    borrowCToken: TokenDataTypes,
    borrowAmountRequired: BigNumber | undefined
) : Promise<{sret: string, sexpected: string}>{
    const d = await HundredFinanceTestUtils.prepareToBorrow(
      deployer,
      collateralToken,
      collateralHolder,
      collateralCToken.address,
      collateralAmountRequired,
      borrowToken,
      borrowCToken.address
    );
    const borrowResults = await HundredFinanceTestUtils.makeBorrow(deployer, d, borrowAmountRequired);
    const sret = [
      borrowResults.accountLiquidity.error,
      borrowResults.userBalanceBorrowAsset,
      borrowResults.poolAdapterBalanceCollateralCToken,
      borrowResults.accountLiquidity.liquidity,
      borrowResults.accountLiquidity.shortfall,
    ].map(x => BalanceUtils.toString(x)).join("\n");

    const sexpected = [
      0,
      borrowResults.borrowedAmount, // borrowed amount on user's balance
      d.collateralAmount
        .mul(Misc.WEI)
        .div(borrowResults.marketsInfo.collateralData.exchangeRateStored),
      borrowResults.expectedLiquidity,
      0,
    ].map(x => BalanceUtils.toString(x)).join("\n");

    return {sret, sexpected};
  }
//endregion Test impl

//region Unit tests
  describe("borrow", () => {
    describe("Good paths", () => {
//region Utils
      async function testDaiUsdc(
        collateralAmountNum: number | undefined,
        borrowAmountNum: number | undefined
      ) : Promise<{ret: string, expected: string}> {
        const collateralAsset = MaticAddresses.DAI;
        const collateralHolder = MaticAddresses.HOLDER_DAI;
        const collateralCTokenAddress = MaticAddresses.hDAI;

        const borrowAsset = MaticAddresses.USDC;
        const borrowCTokenAddress = MaticAddresses.hUSDC;

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

        return {ret: r.sret, expected: r.sexpected};
      }

      async function testMaticEth(
        collateralAmountNum: number | undefined,
        borrowAmountNum: number | undefined
      ) : Promise<{ret: string, expected: string}> {
        const collateralAsset = MaticAddresses.WMATIC;
        const collateralHolder = MaticAddresses.HOLDER_WMATIC;
        const collateralCTokenAddress = MaticAddresses.hMATIC;

        const borrowAsset = MaticAddresses.WETH;
        const borrowCTokenAddress = MaticAddresses.hETH;

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

        return {ret: r.sret, expected: r.sexpected};
      }
//endregion Utils
      describe("Borrow small fixed amount", () => {
        describe("DAI-18 : usdc-6", () => {
          it("should return expected balances", async () => {
            const r = await testDaiUsdc(100_000, 10);
            expect(r.ret).eq(r.expected);
          });
        });
      });
      describe("Borrow max available amount using all available collateral", () => {
        describe("DAI-18 : usdc-6", () => {
          it("should return expected balances", async () => {
            const r = await testDaiUsdc(undefined, undefined);
            expect(r.ret).eq(r.expected);
          });
        });
        describe("Matic-18 : ETH-18", () => {
          it("should return expected balances", async () => {
            const r = await testMaticEth(undefined, undefined);
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

      const d = await HundredFinanceTestUtils.prepareToBorrow(
        deployer,
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

      await HundredFinanceTestUtils.makeBorrow(deployer, d, undefined);
      const r = await d.hfPoolAdapterTC.getStatus();
      return {
        d,
        resultHealthFactor18: r.healthFactor18
      }
    }
    describe("Good paths", () => {
      describe("health factor is small", () => {
        it("should borrow with specified health factor", async () => {
          const targetHealthFactor2 = 102;
          const minHealthFactor2 = 101;

          const collateralAsset = MaticAddresses.USDC;
          const collateralCToken = MaticAddresses.hUSDC;
          const collateralHolder = MaticAddresses.HOLDER_USDC;
          const borrowAsset = MaticAddresses.DAI;
          const borrowCToken = MaticAddresses.hDAI;

          const r = await makeTestSmallHealthFactor(
            collateralAsset,
            collateralHolder,
            collateralCToken,
            borrowAsset,
            borrowCToken,
            targetHealthFactor2,
            minHealthFactor2
          );
          const healthFactor = +formatUnits(r.resultHealthFactor18, 18);

          console.log("healthFactor", healthFactor);
          const ret = [
            healthFactor >= targetHealthFactor2/100 - 1,
            healthFactor <= targetHealthFactor2/100 + 1
          ].join();
          const expected = [true, true].join();

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
      const d = await HundredFinanceTestUtils.prepareToBorrow(
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
          d.hfPoolAdapterTC.address
        );
        await d.hfPoolAdapterTC.borrow(
          d.collateralAmount,
          borrowAmount,
          d.userContract.address
        );
      }

      const statusAfterBorrow = await d.hfPoolAdapterTC.getStatus();
      const afterBorrow: IUserBalances = {
        collateral: await collateralToken.token.balanceOf(d.userContract.address),
        borrow: await borrowToken.token.balanceOf(d.userContract.address)
      };
      console.log(afterBorrow, statusAfterBorrow);

      await TimeUtils.advanceNBlocks(1000);

      // make repay
      const borrowTokenAsUser = IERC20Metadata__factory.connect(
        borrowToken.address,
        await DeployerUtils.startImpersonate(d.userContract.address)
      );
      if (amountToRepay) {
        const repayCaller = badParams?.repayAsNotUserAndNotTC
          ? deployer.address // not TC, not user
          : await d.controller.tetuConverter();

        const poolAdapterAsCaller = IPoolAdapter__factory.connect(
          d.hfPoolAdapterTC.address,
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
          d.hfPoolAdapterTC.address
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

      // check results
      const statusAfterRepay = await d.hfPoolAdapterTC.getStatus();
      console.log("statusAfterRepay", statusAfterRepay);

      const afterRepay: IUserBalances = {
        collateral: await collateralToken.token.balanceOf(d.userContract.address),
        borrow: await borrowToken.token.balanceOf(d.userContract.address)
      };
      const cTokenCollateral = await IHfCToken__factory.connect(collateralCToken.address, deployer);
      const cTokenBorrow = await IHfCToken__factory.connect(borrowCToken.address, deployer);

      const retCollateral = await cTokenCollateral.getAccountSnapshot(d.hfPoolAdapterTC.address);
      const retBorrow = await cTokenBorrow.getAccountSnapshot(d.hfPoolAdapterTC.address);

      return {
        userBalancesBeforeBorrow: beforeBorrow,
        userBalancesAfterBorrow: afterBorrow,
        userBalancesAfterRepay: afterRepay,
        paCTokensBalance: await cTokenCollateral.balanceOf(d.hfPoolAdapterTC.address),
        totalCollateralBase: retCollateral.tokenBalance,
        totalDebtBase: retBorrow.borrowBalance,
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
      defaultCollateralAmount: string = "100000",
      defaultBorrowAmount: string = "10",
      badPathParams?: IBorrowAndRepayBadParams
    ) : Promise<{ret: string, expected: string}> {
      const collateralToken = await TokenDataTypes.Build(deployer, collateral.asset);
      const borrowToken = await TokenDataTypes.Build(deployer, borrow.asset);
      const collateralCToken = await TokenDataTypes.Build(deployer, collateral.cToken);
      const borrowCToken = await TokenDataTypes.Build(deployer, borrow.cToken);

      const collateralAmount = useMaxAvailableCollateral
        ? undefined
        : parseUnits(defaultCollateralAmount, collateralToken.decimals);
      const borrowAmount = useMaxAvailableCollateral
        ? undefined
        : parseUnits(defaultBorrowAmount, borrowToken.decimals);
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
      const collateralCTokenAddress = MaticAddresses.hDAI;

      const borrowAsset = MaticAddresses.WMATIC;
      const borrowHolder = MaticAddresses.HOLDER_WMATIC;
      const borrowCTokenAddress = MaticAddresses.hMATIC;

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
        "100000",
        "10",
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
      const collateralCTokenAddress = MaticAddresses.hDAI;

      const borrowAsset = MaticAddresses.USDC;
      const borrowHolder = MaticAddresses.HOLDER_USDC;
      const borrowCTokenAddress = MaticAddresses.hUSDC;

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
        "100000",
        "10",
        badPathParams
      );
    }

    async function wbtcUSDT(
      useMaxAvailableCollateral: boolean,
      fullRepay: boolean,
      initialBorrowAmountOnUserBalanceNum?: number,
      badPathParams?: IBorrowAndRepayBadParams
    ) : Promise<{ret: string, expected: string}> {
      const collateralAsset = MaticAddresses.WBTC;
      const collateralHolder = MaticAddresses.HOLDER_WBTC;
      const collateralCTokenAddress = MaticAddresses.hWBTC;

      const borrowAsset = MaticAddresses.USDT;
      const borrowHolder = MaticAddresses.HOLDER_USDT;
      const borrowCTokenAddress = MaticAddresses.hUSDT;

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
        "10",
        "10",
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
      const collateralCTokenAddress = MaticAddresses.hUSDT;

      const borrowAsset = MaticAddresses.USDC;
      const borrowHolder = MaticAddresses.HOLDER_USDC;
      const borrowCTokenAddress = MaticAddresses.hUSDC;

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
        "100000",
        "10",
        badPathParams
      );
    }
//endregion Utils

    describe("Good paths", () => {
      describe("Borrow and repay fixed small amount", () =>{
        describe("Partial repay of borrowed amount", () => {
          describe("DAI => USDC", () => {
            it("should return expected balances", async () => {
              const r = await daiUSDC(false, false);
              expect(r.ret).eq(r.expected);
            });
          });
          describe("DAI => WMATIC", () => {
            it("should return expected balances", async () => {
              const r = await daiWMatic(false, false);
              expect(r.ret).eq(r.expected);
            });
          });
          describe("WBTC => USDT", () => {
            it("should return expected balances", async () => {
              const r = await wbtcUSDT(
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
              const r = await daiUSDC(false, false);
              expect(r.ret).eq(r.expected);
            });
          });
          describe("DAI => WMATIC", () => {
            it("should return expected balances", async () => {
              const r = await daiWMatic(false, false);
              expect(r.ret).eq(r.expected);
            });
          });
        });
        describe("Full repay of borrowed amount", () => {
          describe("DAI => USDC", () => {
            it("should return expected balances", async () => {
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
      describe("Transfer amount less than specified amount to repay", () => {
        it("should revert", async () => {
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