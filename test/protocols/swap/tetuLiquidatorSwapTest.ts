import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {IERC20__factory, ITetuLiquidator, ITetuLiquidator__factory} from "../../../typechain";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";
import {BigNumber} from "ethers";

describe("TetuLiquidatorSwapTest", () => {
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

  interface IPrepareToLiquidateResults {
    sourceAsset: string;
    targetAsset: string;
    sourceAmount: BigNumber;
    tetuLiquidator: ITetuLiquidator;
  }
  async function prepareToLiquidate() : Promise<IPrepareToLiquidateResults> {
    const tetuLiquidatorAddress = MaticAddresses.TETU_LIQUIDATOR;
    const sourceAsset = MaticAddresses.DAI;
    const sourceAssetHolder = MaticAddresses.HOLDER_DAI;
    const targetAsset = MaticAddresses.USDC;
    const user = deployer;
    const sourceAmount = ethers.utils.parseUnits("1000", 18); // 1000 DAI, decimals 18

    // get amount on user balance from the holder
    await IERC20__factory.connect(
      sourceAsset,
      await DeployerUtils.startImpersonate(sourceAssetHolder)
    ).transfer(user.address, sourceAmount);

    // approve the amount for tetu liquidator
    await IERC20__factory.connect(
      sourceAsset,
      user
    ).approve(tetuLiquidatorAddress, sourceAmount);

    const tetuLiquidator = ITetuLiquidator__factory.connect(tetuLiquidatorAddress, user);
    const price = await tetuLiquidator.getPrice(sourceAsset, targetAsset, sourceAmount);
    console.log(price); // no problems here

    return {
      tetuLiquidator,
      targetAsset,
      sourceAmount,
      sourceAsset
    }
  }

  describe("Try to swap DAI to USDT using TetuLiquidator deployed to Polygon", () => {
    it("liquidate should success", async () => {
      if (!await isPolygonForkInUse()) return;

      const p = await prepareToLiquidate();
      // await tetuLiquidator.liquidateWithRoute(route.route, sourceAmount, 100_000 * 2 / 100);
      await p.tetuLiquidator.liquidate(p.sourceAsset, p.targetAsset, p.sourceAmount, 100_000 * 2 / 100);
    });
    it("liquidate should success", async () => {
      if (!await isPolygonForkInUse()) return;

      const p = await prepareToLiquidate();

      const route = await p.tetuLiquidator.buildRoute(p.sourceAsset, p.targetAsset);
      console.log(route);

      await p.tetuLiquidator.liquidateWithRoute(route.route, p.sourceAmount, 100_000 * 2 / 100);
    });
  });
});