import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {IERC20__factory, ITetuLiquidator__factory} from "../../../typechain";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";

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

  describe("Try to swap DAI to USDT using TetuLiquidator deployed to Polygon", () => {
    it("should return expected values", async () => {
      const tetuLiquidatorAddress = "0xC737eaB847Ae6A92028862fE38b828db41314772";
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

      const route = await tetuLiquidator.buildRoute(sourceAsset, targetAsset);
      console.log(route);

      // (!) we have 'UniswapV2: INSUFFICIENT_INPUT_AMOUNT'" here
      await tetuLiquidator.liquidateWithRoute(route.route, sourceAmount, 100_000 * 2 / 100);
      await tetuLiquidator.liquidate(sourceAsset, targetAsset, sourceAmount, 100_000 * 2 / 100);
    });
  });
});