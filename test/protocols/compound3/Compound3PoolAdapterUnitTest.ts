import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {BigNumber} from "ethers";
import {
  Compound3TestUtils,
  IBorrowResults,
  IPrepareToBorrowResults
} from "../../baseUT/protocols/compound3/Compound3TestUtils";
import {TokenDataTypes} from "../../baseUT/types/TokenDataTypes";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";
import {parseUnits} from "ethers/lib/utils";
import {ICometRewards__factory, IERC20__factory} from "../../../typechain";
import {expect} from "chai";
import {areAlmostEqual} from "../../baseUT/utils/CommonUtils";


describe("Compound3PoolAdapterUnitTest", () => {
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
    collateralAsset: string,
    collateralHolder: string,
    collateralAmount: BigNumber,
    borrowAsset: string,
    targetHealthFactor2?: number,
    minHealthFactor2?: number
  ) : Promise<{borrowResults: IBorrowResults, prepareResults: IPrepareToBorrowResults}> {
    const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
    const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);
    const prepareResults = await Compound3TestUtils.prepareToBorrow(
      deployer,
      collateralToken,
      collateralHolder,
      collateralAmount,
      borrowToken,
      [MaticAddresses.COMPOUND3_COMET_USDC],
      MaticAddresses.COMPOUND3_COMET_REWARDS,
      {targetHealthFactor2, minHealthFactor2,}
    )

    const borrowResults = await Compound3TestUtils.makeBorrow(deployer, prepareResults, undefined)

    return {
      borrowResults,
      prepareResults,
    }
  }
//endregion Test impl

  describe("getConversionKind", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        const d = await Compound3TestUtils.prepareToBorrow(
          deployer,
          await TokenDataTypes.Build(deployer, MaticAddresses.WETH),
          MaticAddresses.HOLDER_WETH,
          undefined,
          await TokenDataTypes.Build(deployer, MaticAddresses.USDC),
          [MaticAddresses.COMPOUND3_COMET_USDC],
          MaticAddresses.COMPOUND3_COMET_REWARDS,
        );
        const ret = await d.poolAdapter.getConversionKind();
        expect(ret).eq(2); // CONVERSION_KIND_BORROW_2
      });
    });
  });

  describe("claimRewards", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;

        const receiver = ethers.Wallet.createRandom().address;

        const r = await makeBorrow(
          MaticAddresses.WETH,
          MaticAddresses.HOLDER_WETH,
          parseUnits('10'),
          MaticAddresses.USDC
        )

        // wait a bit and check rewards
        await TimeUtils.advanceNBlocks(100);

        const rewardsContract = ICometRewards__factory.connect(await r.prepareResults.poolAdapter.cometRewards(), deployer)
        const rewardTokenFromAdapter = (await rewardsContract.rewardConfig(await r.prepareResults.poolAdapter.comet())).token
        const balanceRewardsBefore = await IERC20__factory.connect(rewardTokenFromAdapter, deployer).balanceOf(receiver);
        const {rewardToken, amount} = await r.prepareResults.poolAdapter.callStatic.claimRewards(receiver);

        expect(rewardTokenFromAdapter).eq(rewardToken)

        await r.prepareResults.poolAdapter.claimRewards(receiver);

        // let's try to claim the rewards once more; now we should receive nothing
        const secondAttempt = await r.prepareResults.poolAdapter.callStatic.claimRewards(receiver);
        const balanceRewardsAfter = await IERC20__factory.connect(rewardToken, deployer).balanceOf(receiver);

        expect(amount).gt(0)
        expect(amount).lte(balanceRewardsAfter.sub(balanceRewardsBefore)) // because we accrue interest on claimRewards
        expect(secondAttempt.amount).eq(0)
        expect(secondAttempt.rewardToken).eq(rewardToken)

        console.log('Rewards amount', amount.toString())
      })
    })
  })

  describe("borrowToRebalance", () => {
    it("should return expected values", async () => {
      if (!await isPolygonForkInUse()) return;

      const r = await makeBorrow(
        MaticAddresses.WETH,
        MaticAddresses.HOLDER_WETH,
        parseUnits('10'),
        MaticAddresses.USDC
      )

      const statusAfterBorrow = await r.prepareResults.poolAdapter.getStatus()
      // console.log('Borrowed amount', statusAfterBorrow.amountToPay.toString())
      // console.log('HF after borrow', statusAfterBorrow.healthFactor18.toString())

      await r.prepareResults.controller.setTargetHealthFactor2(150);

      const amountToAdditionalBorrow = statusAfterBorrow.amountToPay.div(5)
      const [resultHealthFactor18,] = await r.prepareResults.poolAdapter.callStatic.borrowToRebalance(amountToAdditionalBorrow, r.prepareResults.userContract.address)
      await r.prepareResults.poolAdapter.borrowToRebalance(amountToAdditionalBorrow, r.prepareResults.userContract.address)

      const statusAfterBorrowToRebalance = await r.prepareResults.poolAdapter.getStatus()
      // console.log('Borrowed amount', statusAfterBorrowToRebalance.amountToPay.toString())
      // console.log('HF after borrow', statusAfterBorrowToRebalance.healthFactor18.toString())
      // console.log('Result HF', resultHealthFactor18.toString())
      expect(statusAfterBorrowToRebalance.healthFactor18).lt(statusAfterBorrow.healthFactor18)
      expect(areAlmostEqual(statusAfterBorrowToRebalance.amountToPay, statusAfterBorrow.amountToPay.add(amountToAdditionalBorrow))).eq(true)
      expect(areAlmostEqual(resultHealthFactor18, statusAfterBorrowToRebalance.healthFactor18)).eq(true)
    })

  })
})