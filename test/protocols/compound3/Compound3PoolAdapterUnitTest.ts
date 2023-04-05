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
})