import {expect} from "chai";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {TokenDataTypes} from "../../baseUT/types/TokenDataTypes";
import {BigNumber} from "ethers";
import {
  Compound3TestUtils,
  IBorrowResults, IMakeBorrowAndRepayResults,
  IPrepareToBorrowResults
} from "../../baseUT/protocols/compound3/Compound3TestUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";
import {parseUnits} from "ethers/lib/utils";
import {areAlmostEqual} from "../../baseUT/utils/CommonUtils";
import {IUserBalances} from "../../baseUT/utils/BalanceUtils";
import {IBorrowAndRepayBadParams} from "../../baseUT/protocols/aaveShared/aaveBorrowAndRepayUtils";
import {IERC20Metadata__factory, IPoolAdapter__factory} from "../../../typechain";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {transferAndApprove} from "../../baseUT/utils/transferUtils";

describe("Compound3PoolAdapterIntTest", () => {
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

//region Make borrow
  async function makeBorrow(
    collateralAsset: string,
    collateralHolder: string,
    collateralAmountRequired: BigNumber | undefined,
    borrowAsset: string,
    borrowAmountRequired: BigNumber | undefined,
    targetHealthFactor2?: number,
    minHealthFactor2?: number
  ) : Promise<{borrowResults: IBorrowResults, prepareResults: IPrepareToBorrowResults}> {
    const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
    const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);
    const prepareResults = await Compound3TestUtils.prepareToBorrow(
      deployer,
      collateralToken,
      collateralHolder,
      collateralAmountRequired,
      borrowToken,
      [MaticAddresses.COMPOUND3_COMET_USDC],
      MaticAddresses.COMPOUND3_COMET_REWARDS,
      {targetHealthFactor2, minHealthFactor2,}
    )

    const borrowResults = await Compound3TestUtils.makeBorrow(deployer, prepareResults, borrowAmountRequired)

    return {
      borrowResults,
      prepareResults,
    }
  }
//endregion Make borrow

//region Make borrow and repay
  async function makeBorrowAndRepay(
    collateralAsset: string,
    collateralHolder: string,
    collateralAmountRequired: BigNumber | undefined,
    borrowAsset: string,
    borrowAmountRequired: BigNumber | undefined,
    amountToRepay?: BigNumber,
    initialBorrowAmountOnUserBalance?: BigNumber,
    borrowHolder?: string,
    badParams?: IBorrowAndRepayBadParams
  ) : Promise<IMakeBorrowAndRepayResults> {
    const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
    const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);
    const prepareResults = await Compound3TestUtils.prepareToBorrow(
      deployer,
      collateralToken,
      collateralHolder,
      collateralAmountRequired,
      borrowToken,
      [MaticAddresses.COMPOUND3_COMET_USDC],
      MaticAddresses.COMPOUND3_COMET_REWARDS
    )

    if (initialBorrowAmountOnUserBalance && borrowHolder) {
      await borrowToken.token
        .connect(await DeployerUtils.startImpersonate(borrowHolder))
        .transfer(prepareResults.userContract.address, initialBorrowAmountOnUserBalance);
    }

    const userBalancesBeforeBorrow: IUserBalances = {
      collateral: await collateralToken.token.balanceOf(prepareResults.userContract.address),
      borrow: await borrowToken.token.balanceOf(prepareResults.userContract.address)
    }

    const borrowResults = await Compound3TestUtils.makeBorrow(deployer, prepareResults, borrowAmountRequired)

    const userBalancesAfterBorrow: IUserBalances = {
      collateral: await collateralToken.token.balanceOf(prepareResults.userContract.address),
      borrow: await borrowToken.token.balanceOf(prepareResults.userContract.address)
    }

    await TimeUtils.advanceNBlocks(1000);

    const borrowTokenAsUser = IERC20Metadata__factory.connect(
      borrowToken.address,
      await DeployerUtils.startImpersonate(prepareResults.userContract.address)
    );
    if (amountToRepay) {
      const repayCaller = badParams?.repayAsNotUserAndNotTC
        ? deployer.address // not TC, not user
        : await prepareResults.controller.tetuConverter();

      const poolAdapterAsCaller = IPoolAdapter__factory.connect(
        prepareResults.poolAdapter.address,
        await DeployerUtils.startImpersonate(repayCaller)
      );

      // make partial repay
      const amountBorrowAssetToSendToPoolAdapter = badParams?.wrongAmountToRepayToTransfer
        ? badParams?.wrongAmountToRepayToTransfer
        : amountToRepay;

      await transferAndApprove(
        borrowToken.address,
        prepareResults.userContract.address,
        repayCaller,
        amountBorrowAssetToSendToPoolAdapter,
        prepareResults.poolAdapter.address
      );

      await poolAdapterAsCaller.repay(
        amountToRepay,
        prepareResults.userContract.address,
        // normally we don't close position here
        // but in bad paths we need to emulate attempts to close the position
        badParams?.forceToClosePosition || false
      );
    } else {
      console.log("user balance borrow asset before repay", await borrowTokenAsUser.balanceOf(prepareResults.userContract.address));
      // make full repayment
      await prepareResults.userContract.makeRepayComplete(
        collateralToken.address,
        borrowToken.address,
        prepareResults.userContract.address
      );
      console.log("user balance borrow asset after repay", await borrowTokenAsUser.balanceOf(prepareResults.userContract.address));
    }

    const userBalancesAfterRepay: IUserBalances = {
      collateral: await collateralToken.token.balanceOf(prepareResults.userContract.address),
      borrow: await borrowToken.token.balanceOf(prepareResults.userContract.address)
    }

    return {
      userBalancesBeforeBorrow,
      userBalancesAfterBorrow,
      userBalancesAfterRepay,
    }
  }
//endregion Make borrow and repay

//region Integration tests
  describe("borrow", () => {
    describe("Good paths", () => {
      describe("Borrow small fixed amount", () => {
        describe("WETH-18 : usdc-6", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;

            const r = await makeBorrow(
              MaticAddresses.WETH,
              MaticAddresses.HOLDER_WETH,
              parseUnits('1'),
              MaticAddresses.USDC,
              parseUnits('100', 6)
            )

            expect(r.borrowResults.userBalanceBorrowAsset).eq(r.borrowResults.borrowedAmount)
            expect(r.borrowResults.borrowedAmount).lte(r.prepareResults.amountToBorrow)
          })
        })
        describe("WMATIC-18 : usdc-6", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;

            const r = await makeBorrow(
              MaticAddresses.WMATIC,
              MaticAddresses.HOLDER_WMATIC,
              parseUnits('1000'),
              MaticAddresses.USDC,
              parseUnits('300', 6)
            )

            expect(r.borrowResults.userBalanceBorrowAsset).eq(r.borrowResults.borrowedAmount)
            expect(r.borrowResults.borrowedAmount).lte(r.prepareResults.amountToBorrow)
          })
        })
      })
      describe("Borrow max available amount using all available collateral", () => {
        describe("WETH-18 : usdc-6", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;

            const r = await makeBorrow(
              MaticAddresses.WETH,
              MaticAddresses.HOLDER_WETH,
              undefined,
              MaticAddresses.USDC,
              undefined
            )

            expect(r.borrowResults.userBalanceBorrowAsset).eq(r.borrowResults.borrowedAmount)
            expect(r.borrowResults.borrowedAmount).lte(r.prepareResults.amountToBorrow)
          })
        })
        describe("WMATIC-18 : usdc-6", () => {
          it("should return expected balances", async () => {
            if (!await isPolygonForkInUse()) return;

            const r = await makeBorrow(
              MaticAddresses.WMATIC,
              MaticAddresses.HOLDER_WMATIC,
              undefined,
              MaticAddresses.USDC,
              undefined
            )

            expect(r.borrowResults.userBalanceBorrowAsset).eq(r.borrowResults.borrowedAmount)
            expect(r.borrowResults.borrowedAmount).lte(r.prepareResults.amountToBorrow)
          })
        })
      })
    })
  })

  describe("Borrow using small health factors", () => {
    describe("health factor is greater than liquidationThreshold18/LTV", () => {
      it("should borrow with specified health factor", async () => {
        if (!await isPolygonForkInUse()) return;

        const targetHealthFactor2 = 108;
        const minHealthFactor2 = 101;

        const r = await makeBorrow(
          MaticAddresses.WETH,
          MaticAddresses.HOLDER_WETH,
          parseUnits('1'),
          MaticAddresses.USDC,
          undefined,
          targetHealthFactor2,
          minHealthFactor2
        )

        const status = await r.prepareResults.poolAdapter.getStatus()

        expect(areAlmostEqual(status.healthFactor18, parseUnits('' + targetHealthFactor2, 16))).eq(true)
        expect(await r.prepareResults.controller.minHealthFactor2()).eq(minHealthFactor2)
      })
    })
  })

  describe("repay", () => {
    describe("Good paths", () => {
      describe("Borrow and repay modest amount", () => {
        describe("Partial repay of borrowed amount", () => {
          describe("WETH => USDC", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;

              const r = await makeBorrowAndRepay(
                MaticAddresses.WETH,
                MaticAddresses.HOLDER_WETH,
                parseUnits('1'),
                MaticAddresses.USDC,
                parseUnits('100', 6),
                parseUnits('50', 6),
              )

              expect(r.userBalancesAfterRepay.borrow).eq(parseUnits('50', 6))
              expect(areAlmostEqual(
                parseUnits('100', 6).div(parseUnits('50', 6)),
                parseUnits('1').div(r.userBalancesAfterRepay.collateral)
              )).eq(true)
            });
          });
          describe("WMATIC => USDC", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;

              const r = await makeBorrowAndRepay(
                MaticAddresses.WMATIC,
                MaticAddresses.HOLDER_WMATIC,
                parseUnits('1000'),
                MaticAddresses.USDC,
                parseUnits('100', 6),
                parseUnits('50', 6),
              )

              expect(r.userBalancesAfterRepay.borrow).eq(parseUnits('50', 6))
              expect(areAlmostEqual(
                parseUnits('100', 6).div(parseUnits('50', 6)),
                parseUnits('1000').div(r.userBalancesAfterRepay.collateral)
              )).eq(true)
            });
          });
        });
        describe("Full repay of borrowed amount", () => {
          describe("WETH => USDC", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;

              const r = await makeBorrowAndRepay(
                MaticAddresses.WETH,
                MaticAddresses.HOLDER_WETH,
                parseUnits('1'),
                MaticAddresses.USDC,
                parseUnits('100', 6),
                undefined,
                parseUnits('10', 6),
                MaticAddresses.HOLDER_USDC
              )

              expect(r.userBalancesAfterRepay.collateral).eq(parseUnits('1'))
            })
          })
          describe("WBTC => USDC", () => {
            it("should return expected balances", async () => {
              if (!await isPolygonForkInUse()) return;

              const r = await makeBorrowAndRepay(
                MaticAddresses.WBTC,
                MaticAddresses.HOLDER_WBTC,
                parseUnits('1', 8),
                MaticAddresses.USDC,
                parseUnits('1000', 6),
                undefined,
                parseUnits('10', 6),
                MaticAddresses.HOLDER_USDC
              )

              expect(r.userBalancesAfterRepay.collateral).eq(parseUnits('1', 8))
            })
          })
        })
      });
    });
    describe("Bad paths", () => {
      describe("Transfer amount less than specified amount to repay", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;

          await expect(makeBorrowAndRepay(
            MaticAddresses.WETH,
            MaticAddresses.HOLDER_WETH,
            parseUnits('1'),
            MaticAddresses.USDC,
            parseUnits('100', 6),
            parseUnits('50', 6),
            undefined,
            undefined,
            {wrongAmountToRepayToTransfer: parseUnits('40', 6)}
          )).revertedWith("ERC20: transfer amount exceeds balance");
        })
      })
      describe("Try to close position with not zero debt", () => {
        it("should revert", async () => {
          if (!await isPolygonForkInUse()) return;

          await expect(makeBorrowAndRepay(
            MaticAddresses.WETH,
            MaticAddresses.HOLDER_WETH,
            parseUnits('1'),
            MaticAddresses.USDC,
            parseUnits('100', 6),
            parseUnits('50', 6),
            undefined,
            undefined,
            {forceToClosePosition: true}
          )).revertedWith("TC-55 close position not allowed");
        })
      })
    })
  })
//endregion Integration tests
})