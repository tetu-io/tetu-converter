import {expect} from "chai";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {TokenDataTypes} from "../../baseUT/types/TokenDataTypes";
import {BigNumber} from "ethers";
import {
  Compound3TestUtils,
  IBorrowResults,
  IPrepareToBorrowResults
} from "../../baseUT/protocols/compound3/Compound3TestUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";
import {parseUnits} from "ethers/lib/utils";
import {areAlmostEqual} from "../../baseUT/utils/CommonUtils";

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

//endregion Integration tests
})
