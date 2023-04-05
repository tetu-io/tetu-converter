import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {
  Aave3PoolAdapter__factory,
  DebtMonitor__factory,
  BorrowManager__factory,
  IERC20Metadata__factory,
  IPoolAdapter__factory,
  ConverterController,
  Aave3PoolAdapter,
  Aave3PoolMock__factory,
  ITetuConverter__factory,
  IERC20__factory
} from "../../../typechain";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {TokenDataTypes} from "../../baseUT/types/TokenDataTypes";
import {Misc} from "../../../scripts/utils/Misc";
import {IAave3UserAccountDataResults} from "../../baseUT/apr/aprAave3";
import {
  AaveRepayToRebalanceUtils,
  IMakeRepayToRebalanceResults
} from "../../baseUT/protocols/aaveShared/aaveRepayToRebalanceUtils";
import {
  AaveBorrowToRebalanceUtils,
  IMakeBorrowToRebalanceBadPathParams,
  IMakeBorrowToRebalanceResults
} from "../../baseUT/protocols/aaveShared/aaveBorrowToRebalanceUtils";
import {
  IMakeRepayRebalanceBadPathParams,
  IMakeRepayToRebalanceInputParams
} from "../../baseUT/protocols/shared/sharedDataTypes";
import {SharedRepayToRebalanceUtils} from "../../baseUT/protocols/shared/sharedRepayToRebalanceUtils";
import {makeInfinityApprove, transferAndApprove} from "../../baseUT/utils/transferUtils";
import {
  Aave3TestUtils,
  IPrepareToBorrowResults,
  IBorrowResults,
  IMakeBorrowOrRepayBadPathsParams, IMakeRepayBadPathsParams
} from "../../baseUT/protocols/aave3/Aave3TestUtils";
import {AdaptersHelper} from "../../baseUT/helpers/AdaptersHelper";
import {TetuConverterApp} from "../../baseUT/helpers/TetuConverterApp";
import {MocksHelper} from "../../baseUT/helpers/MocksHelper";
import {parseUnits} from "ethers/lib/utils";
import {areAlmostEqual} from "../../baseUT/utils/CommonUtils";
import {IPoolAdapterStatus} from "../../baseUT/types/BorrowRepayDataTypes";
import {Aave3ChangePricesUtils} from "../../baseUT/protocols/aave3/Aave3ChangePricesUtils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {controlGasLimitsEx} from "../../../scripts/utils/hardhatUtils";
import {GAS_FULL_REPAY, GAS_SWAP_SIMULATE} from "../../baseUT/GasLimit";

/**
 * Unit tests that use fixtures
 */
describe("Aave3PoolAdapterUnitFixTest", () => {
//region Global vars for all tests
  let snapshot: string;
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
//endregion before, after

//region Test impl
  interface IMakeBorrowTestResults {
    init: IPrepareToBorrowResults;
    borrowResults: IBorrowResults;
    collateralToken: TokenDataTypes,
    borrowToken: TokenDataTypes,
  }

  async function makeBorrowTest(
    collateralAsset: string,
    collateralHolder: string,
    borrowAsset: string,
    collateralAmountStr: string,
    badPathsParams?: IMakeBorrowOrRepayBadPathsParams
  ): Promise<IMakeBorrowTestResults> {
    const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
    const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

    const init = await Aave3TestUtils.prepareToBorrow(
      deployer,
      collateralToken,
      [collateralHolder],
      parseUnits(collateralAmountStr, collateralToken.decimals),
      borrowToken,
      false,
      {
        useAave3PoolMock: badPathsParams?.useAave3PoolMock,
        useMockedAavePriceOracle: badPathsParams?.useMockedAavePriceOracle
      }
    );
    const borrowResults = await Aave3TestUtils.makeBorrow(deployer, init, undefined, badPathsParams);
    return {
      init,
      borrowResults,
      collateralToken,
      borrowToken
    }
  }

//endregion Test impl

//region Unit tests
  describe("full repay", () => {
    const collateralAsset = MaticAddresses.DAI;
    const collateralHolder = MaticAddresses.HOLDER_DAI;
    const borrowAsset = MaticAddresses.WMATIC;
    const borrowHolder = MaticAddresses.HOLDER_WMATIC;

    interface IMakeFullRepayTestResults {
      init: IPrepareToBorrowResults;
      borrowResults: IBorrowResults;
      collateralToken: TokenDataTypes;
      borrowToken: TokenDataTypes;
      statusBeforeRepay: IPoolAdapterStatus;
      repayResults: IAave3UserAccountDataResults;
      userBorrowAssetBalanceBeforeRepay: BigNumber;
      userBorrowAssetBalanceAfterRepay: BigNumber;
      repayResultsCollateralAmountOut: BigNumber;
      repayResultsReturnedBorrowAmountOut?: BigNumber;
      gasUsed: BigNumber;
    }

    async function makeFullRepayTest(
      collateralAmountStr: string = "1999",
      badPathsParams?: IMakeRepayBadPathsParams
    ): Promise<IMakeFullRepayTestResults> {
      const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
      const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

      const init = await Aave3TestUtils.prepareToBorrow(
        deployer,
        collateralToken,
        [collateralHolder],
        parseUnits(collateralAmountStr, collateralToken.decimals),
        borrowToken,
        false,
        {
          useAave3PoolMock: badPathsParams?.useAave3PoolMock,
          useMockedAavePriceOracle: badPathsParams?.collateralPriceIsZero
        }
      );
      if (badPathsParams?.useAave3PoolMock) {
        if (badPathsParams?.grabAllBorrowAssetFromSenderOnRepay) {
          await Aave3PoolMock__factory.connect(init.aavePool.address, deployer).setGrabAllBorrowAssetFromSenderOnRepay();
        }
        if (badPathsParams?.ignoreRepay) {
          await Aave3PoolMock__factory.connect(init.aavePool.address, deployer).setIgnoreRepay();
        }
        if (badPathsParams?.ignoreWithdraw) {
          await Aave3PoolMock__factory.connect(init.aavePool.address, deployer).setIgnoreWithdraw();
        }
      }
      const borrowResults = await Aave3TestUtils.makeBorrow(deployer, init, undefined);

      const amountToRepay = badPathsParams?.amountToRepayStr
        ? parseUnits(badPathsParams?.amountToRepayStr, borrowToken.decimals)
        : undefined;
      await Aave3TestUtils.putDoubleBorrowAmountOnUserBalance(init, borrowHolder);

      const userBorrowAssetBalanceBeforeRepay = await init.borrowToken.token.balanceOf(init.userContract.address);
      const statusBeforeRepay: IPoolAdapterStatus = await init.aavePoolAdapterAsTC.getStatus();


      if (badPathsParams?.collateralPriceIsZero) {
        await Aave3ChangePricesUtils.setAssetPrice(deployer, init.collateralToken.address, BigNumber.from(0));
        console.log("Collateral price was set to 0");
      }

      const makeRepayResults = await Aave3TestUtils.makeRepay(
        init,
        amountToRepay,
        badPathsParams?.closePosition,
        {
          makeOperationAsNotTc: badPathsParams?.makeRepayAsNotTc,
        }
      );
      const userBorrowAssetBalanceAfterRepay = await init.borrowToken.token.balanceOf(init.userContract.address);

      return {
        init,
        borrowResults,
        collateralToken,
        borrowToken,
        statusBeforeRepay,
        repayResults: makeRepayResults.userAccountData,
        userBorrowAssetBalanceBeforeRepay,
        userBorrowAssetBalanceAfterRepay,
        repayResultsCollateralAmountOut: makeRepayResults.repayResultsCollateralAmountOut,
        repayResultsReturnedBorrowAmountOut: makeRepayResults.repayResultsReturnedBorrowAmountOut,
        gasUsed: makeRepayResults.gasUsed
      }
    }

    describe("Good paths", () => {
      it("should get expected status", async () => {
        if (!await isPolygonForkInUse()) return;

        const results = await loadFixture(makeFullRepayTest);
        const status = await results.init.aavePoolAdapterAsTC.getStatus();
        console.log("userBorrowAssetBalanceAfterRepay", results.userBorrowAssetBalanceAfterRepay);
        console.log("userBorrowAssetBalanceBeforeRepay", results.userBorrowAssetBalanceBeforeRepay);
        console.log("results.statusBeforeRepay", results.statusBeforeRepay);
        const ret = [
          status.healthFactor18.gt(parseUnits("1", 77)),
          areAlmostEqual(
            results.userBorrowAssetBalanceBeforeRepay.sub(results.userBorrowAssetBalanceAfterRepay),
            results.statusBeforeRepay.amountToPay,
            4
          ),
          status.collateralAmountLiquidated.eq(0),
          status.collateralAmount.eq(0)
        ].join();
        const expected = [true, true, true, true].join();
        expect(ret).eq(expected);
      });
      it("should close position after full repay", async () => {
        if (!await isPolygonForkInUse()) return;

        const results = await loadFixture(makeFullRepayTest);
        const ret = await DebtMonitor__factory.connect(
          await results.init.controller.debtMonitor(),
          await DeployerUtils.startImpersonate(results.init.aavePoolAdapterAsTC.address)
        ).isPositionOpened();
        expect(ret).eq(false);
      });
      it("should assign expected value to collateralBalanceATokens", async () => {
        if (!await isPolygonForkInUse()) return;

        const results = await loadFixture(makeFullRepayTest);
        const collateralBalanceATokens = await results.init.aavePoolAdapterAsTC.collateralBalanceATokens();
        const aaveTokensBalance = await IERC20Metadata__factory.connect(
          results.init.collateralReserveInfo.aTokenAddress,
          deployer
        ).balanceOf(results.init.aavePoolAdapterAsTC.address);
        expect(collateralBalanceATokens.eq(aaveTokensBalance)).eq(true);

      });
      it("should withdraw expected collateral amount", async () => {
        if (!await isPolygonForkInUse()) return;

        const results = await loadFixture(makeFullRepayTest);
        const receivedCollateralAmount = await results.collateralToken.token.balanceOf(results.init.userContract.address);
        expect(areAlmostEqual(receivedCollateralAmount, results.init.collateralAmount)).eq(true);
      });
      it("should return expected collateral amount", async () => {
        if (!await isPolygonForkInUse()) return;

        const results = await loadFixture(makeFullRepayTest);
        expect(areAlmostEqual(results.repayResultsCollateralAmountOut, results.init.collateralAmount)).eq(true);
      });
    });
    describe("Bad paths", () => {
      let snapshotForEach: string;
      beforeEach(async function () {
        snapshotForEach = await TimeUtils.snapshot();
      });

      afterEach(async function () {
        await TimeUtils.rollback(snapshotForEach);
      });

      it("should return exceeded amount if user tries to pay too much", async () => {
        if (!await isPolygonForkInUse()) return;
        const results = await makeFullRepayTest(
          "1999",
          {
            amountToRepayStr: "1500", // amount to repay is ~905, user has 905*2 in total
            closePosition: true
          }
        );
        const ret = areAlmostEqual(
          results.userBorrowAssetBalanceBeforeRepay.sub(results.userBorrowAssetBalanceAfterRepay),
          results.statusBeforeRepay.amountToPay,
          4
        );
        expect(ret).eq(true);
      });
      it("should revert if not tetu converter", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeFullRepayTest(
            "1999",
            {
              makeRepayAsNotTc: true,
              amountToRepayStr: "10" // it's much harder to emulate not-TC call for full repay
            }
          )
        ).revertedWith("TC-8 tetu converter only"); // TETU_CONVERTER_ONLY
      });
      it("should fail if pay too small amount and try to close the position", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeFullRepayTest(
            "1999",
            {amountToRepayStr: "1", closePosition: true}
          )
        ).revertedWith("TC-55 close position not allowed"); // CLOSE_POSITION_PARTIAL
      });
      it("should fail if the debt was completely paid but amount of the debt is still not zero in the pool", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeFullRepayTest(
            "1999",
            {
              useAave3PoolMock: true,
              ignoreWithdraw: true,
              ignoreRepay: true
            }
          )
        ).revertedWith("TC-24 close position failed"); // CLOSE_POSITION_FAILED
      });
      it("should NOT revert if pool has used all amount-to-repay and hasn't sent anything back", async () => {
        if (!await isPolygonForkInUse()) return;
        const r = await makeFullRepayTest(
          "1999",
          {useAave3PoolMock: true, grabAllBorrowAssetFromSenderOnRepay: true}
        );

        // We emulate a situation
        // when the pool adapter takes all amount-to-repay
        // and doesn't return any amount back
        const balanceBorrowAssetOnMock = await r.borrowToken.token.balanceOf(r.init.aavePool.address);
        expect(balanceBorrowAssetOnMock.gt(0)).eq(true);
      });
      it("should fail if collateral price is zero", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeFullRepayTest(
            "1999",
            {
              collateralPriceIsZero: true,
              amountToRepayStr: "1" // we need partial-repay mode in this test to avoid calling getStatus in makeRepayComplete
            }
          )
        ).revertedWith("TC-4 zero price"); // ZERO_PRICE
      });
    });
    describe("Gas estimation @skip-on-coverage", () => {
      it("should get expected status", async () => {
        if (!await isPolygonForkInUse()) return;

        const results = await loadFixture(makeFullRepayTest);

        controlGasLimitsEx(results.gasUsed, GAS_FULL_REPAY, (u, t) => {
          expect(u).to.be.below(t);
        });
      });
    });
//endregion Unit tests

  });
});
