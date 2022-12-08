import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {
  Controller,
  IERC20__factory,
  ITetuLiquidator,
  ITetuLiquidator__factory,
  SwapManager,
  SwapManager__factory
} from "../../../typechain";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";
import {BigNumber} from "ethers";
import {expect} from "chai";
import {TetuConverterApp} from "../../baseUT/helpers/TetuConverterApp";
import {parseUnits} from "ethers/lib/utils";
import {Misc} from "../../../scripts/utils/Misc";
import {controlGasLimitsEx} from "../../../scripts/utils/hardhatUtils";
import {GAS_LIMIT_SWAP_MANAGER_GET_CONVERTER} from "../../baseUT/GasLimit";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";

describe("TetuLiquidatorSwapTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let signer: SignerWithAddress;
  let controller: Controller;
  let swapManager: SwapManager;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    signer = signers[0];

    // Deploy all application contracts
    controller = await TetuConverterApp.createController(signer, {tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR});

    // Deploy SwapManager
    swapManager = SwapManager__factory.connect(await controller.swapManager(), signer) as SwapManager;
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
    const user = signer;
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
//endregion Test impl

//region Unit tests
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

  describe("getConverter", () => {
    describe("DAI => USDC", () => {
      it("should find conversion strategy successfully", async () => {
        const sourceAmount = parseUnits("1", 18);
        await BalanceUtils.getAmountFromHolder(MaticAddresses.DAI, MaticAddresses.HOLDER_DAI, signer.address, sourceAmount);
        await IERC20__factory.connect(MaticAddresses.DAI, signer).approve(
          await controller.tetuConverter(),
          sourceAmount
        );
        const r = await swapManager.callStatic.getConverter(
          signer.address,
          MaticAddresses.DAI,
          sourceAmount,
          MaticAddresses.USDC,
        );
        const ret = [
          r.converter === Misc.ZERO_ADDRESS,
          r.maxTargetAmount.eq(0),
        ].join();
        const expected = [false, false].join();
        expect(ret).eq(expected);
      });
      it("should fit to gas limit @skip-on-coverage", async () => {
        const sourceAmount = parseUnits("1", 18);
        await BalanceUtils.getAmountFromHolder(MaticAddresses.DAI, MaticAddresses.HOLDER_DAI, signer.address, sourceAmount);
        await IERC20__factory.connect(MaticAddresses.DAI, signer).approve(
          await controller.tetuConverter(),
          sourceAmount
        );
        const gas = await swapManager.estimateGas.getConverter(
          signer.address,
          MaticAddresses.DAI,
          sourceAmount,
          MaticAddresses.USDC,
        );
        console.log("swapManager.estimateGas.getConverter.gas", gas.toString());
        controlGasLimitsEx(gas, GAS_LIMIT_SWAP_MANAGER_GET_CONVERTER, (u, t) => {
          expect(u).to.be.below(t);
        });
      });
    });
    describe("DAI => USDT", () => {
      it("should find conversion strategy successfully", async () => {
        const sourceAmount = parseUnits("1", 18);
        await BalanceUtils.getAmountFromHolder(MaticAddresses.DAI, MaticAddresses.HOLDER_DAI, signer.address, sourceAmount);
        await IERC20__factory.connect(MaticAddresses.DAI, signer).approve(
          await controller.tetuConverter(),
          sourceAmount
        );
        const r = await swapManager.callStatic.getConverter(
          signer.address,
          MaticAddresses.DAI,
          sourceAmount,
          MaticAddresses.USDT,
        );
        const ret = [
          r.converter === Misc.ZERO_ADDRESS,
          r.maxTargetAmount.eq(0),
        ].join();
        const expected = [false, false].join();
        expect(ret).eq(expected);
      });
      it("should fit to gas limit @skip-on-coverage", async () => {
        const sourceAmount = parseUnits("1", 18);
        await BalanceUtils.getAmountFromHolder(MaticAddresses.DAI, MaticAddresses.HOLDER_DAI, signer.address, sourceAmount);
        await IERC20__factory.connect(MaticAddresses.DAI, signer).approve(
          await controller.tetuConverter(),
          sourceAmount
        );
        const gas = await swapManager.estimateGas.getConverter(
          signer.address,
          MaticAddresses.DAI,
          sourceAmount,
          MaticAddresses.USDT,
        );
        console.log("swapManager.estimateGas.getConverter.gas", gas.toString());
        controlGasLimitsEx(gas, GAS_LIMIT_SWAP_MANAGER_GET_CONVERTER, (u, t) => {
          expect(u).to.be.below(t);
        });
      });
    });
    describe("WBTC => WMATIC", () => {
      it("should find conversion strategy successfully", async () => {
        const sourceAmount = parseUnits("0.01", 8);
        await BalanceUtils.getAmountFromHolder(MaticAddresses.WBTC, MaticAddresses.HOLDER_WBTC, signer.address, sourceAmount);
        await IERC20__factory.connect(MaticAddresses.WBTC, signer).approve(
          await controller.tetuConverter(),
          sourceAmount
        );
        const r = await swapManager.callStatic.getConverter(
          signer.address,
          MaticAddresses.WBTC,
          sourceAmount,
          MaticAddresses.WMATIC,
        );
        const ret = [
          r.converter === Misc.ZERO_ADDRESS,
          r.maxTargetAmount.eq(0),
        ].join();
        const expected = [false, false].join();
        expect(ret).eq(expected);
      });
      it("should fit to gas limit @skip-on-coverage", async () => {
        const sourceAmount = parseUnits("0.01", 18);
        await BalanceUtils.getAmountFromHolder(MaticAddresses.WBTC, MaticAddresses.HOLDER_WBTC, signer.address, sourceAmount);
        await IERC20__factory.connect(MaticAddresses.WBTC, signer).approve(
          await controller.tetuConverter(),
          sourceAmount
        );
        const gas = await swapManager.estimateGas.getConverter(
          signer.address,
          MaticAddresses.WBTC,
          sourceAmount,
          MaticAddresses.WMATIC,
        );
        console.log("swapManager.estimateGas.getConverter.gas", gas.toString());
        controlGasLimitsEx(gas, GAS_LIMIT_SWAP_MANAGER_GET_CONVERTER, (u, t) => {
          expect(u).to.be.below(t);
        });
      });
    });
  });
//endregion Unit tests
});