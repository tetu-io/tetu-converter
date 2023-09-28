import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {MockERC20, PriceOracleMock, SwapLibFacade,} from "../../typechain";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {BigNumber} from "ethers";
import {MocksHelper} from "../baseUT/helpers/MocksHelper";
import {controlGasLimitsEx2, HARDHAT_NETWORK_ID, HardhatUtils} from "../../scripts/utils/HardhatUtils";
import {GAS_SWAP_LIB_CONVERT_USING_PRICE_ORACLE, GAS_SWAP_LIB_IS_CONVERSION_VALID} from "../baseUT/types/GasLimit";

const parseUnits = ethers.utils.parseUnits;

describe("SwapManager", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  // tslint:disable-next-line:one-variable-per-declaration
  let usdc: MockERC20, usdt: MockERC20, dai: MockERC20, matic: MockERC20, weth: MockERC20, euro: MockERC20;
  // tslint:disable-next-line:one-variable-per-declaration
  let $usdc: BigNumber, $usdt: BigNumber, $dai: BigNumber, $matic: BigNumber, $weth: BigNumber;
  let priceOracle: PriceOracleMock;
  let facade: SwapLibFacade;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(HARDHAT_NETWORK_ID);

    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];

    // Deploy Liquidator Mock with Mock tokens
    usdc = await DeployUtils.deployContract(deployer, 'MockERC20', 'USDC', 'USDC', 6) as MockERC20;
    usdt = await DeployUtils.deployContract(deployer, 'MockERC20', 'USDT', 'USDT', 6) as MockERC20;
    dai = await DeployUtils.deployContract(deployer, 'MockERC20', 'Dai', 'DAI', 18) as MockERC20;
    matic = await DeployUtils.deployContract(deployer, 'MockERC20', 'Matic', 'MATIC', 18) as MockERC20;
    weth = await DeployUtils.deployContract(deployer, 'MockERC20', 'Wrapped Ether', 'WETH', 18) as MockERC20;
    euro = await DeployUtils.deployContract(deployer, 'MockERC20', 'Euro', 'Euro', 2) as MockERC20;

    $usdc = parseUnits('1');
    $usdt = parseUnits('1');
    $dai = parseUnits('1');
    $matic = parseUnits('0.4');
    $weth = parseUnits('2000');

    priceOracle = await MocksHelper.getPriceOracleMock(
      deployer,
      [usdt.address, dai.address, matic.address, weth.address, usdc.address],
      [$usdt, $dai, $matic, $weth, $usdc]
    );
    facade = await MocksHelper.getSwapLibFacade(deployer);
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
  describe("convertUsingPriceOracle", () => {
    describe("Good paths", () => {
      it("should return expected value", async () => {
        const amountUsdc = parseUnits("100", 6);
        const amountWeth = await facade.convertUsingPriceOracle(
          priceOracle.address,
          usdc.address, // decimals 6
          amountUsdc,
          weth.address, // decimals 18
        );
        const expectedAmountWeth = amountUsdc
          .mul($usdc)
          .div($weth)
          .mul(parseUnits("1", 18))
          .div(parseUnits("1", 6));
        expect(amountWeth.eq(expectedAmountWeth)).eq(true);
      });
    });
    describe("Bad paths", () => {
      it("should revert if target asset has zero price", async () => {
        const amountUsdc = parseUnits("100", 6);
        await expect(
          facade.convertUsingPriceOracle(priceOracle.address, usdc.address, amountUsdc, euro.address)
        ).revertedWith("TC-4 zero price"); // ZERO_PRICE
      });
      it("should revert if source asset has zero price", async () => {
        const amountUsdc = parseUnits("100", 6);
        await expect(
          facade.convertUsingPriceOracle(priceOracle.address, euro.address, amountUsdc, usdc.address)
        ).revertedWith("TC-4 zero price"); // ZERO_PRICE
      });
    });
    describe("Gas estimation @skip-on-coverage", () => {
      it("should not exceed gas threshold", async () => {
        const amountUsdc = parseUnits("100", 6);
        const gasUsed = await facade.estimateGas.convertUsingPriceOracle(priceOracle.address, usdc.address, amountUsdc, weth.address);
        controlGasLimitsEx2(gasUsed, GAS_SWAP_LIB_CONVERT_USING_PRICE_ORACLE, (u, t) => {
          expect(u).to.be.below(t);
        });
      });
    });
  });

  describe("isConversionValid", () => {
    describe("Good paths", () => {
      it("should return true, no price impact", async () => {
        await priceOracle.changePrices(
          [usdc.address, dai.address],
          [parseUnits("1", 18), parseUnits("1", 18)]
        );
        const ret = await facade.isConversionValid(
          priceOracle.address,
          usdc.address,
          parseUnits("100", 6),
          dai.address,
          parseUnits("100", 18),
          0
        );

        expect(ret).eq(true);
      });
      it("should return true, low negative price impact", async () => {
        await priceOracle.changePrices(
          [usdc.address, dai.address],
          [parseUnits("1", 18), parseUnits("1", 18)]
        );
        const ret = await facade.isConversionValid(
          priceOracle.address,
          usdc.address,
          parseUnits("100", 6),
          dai.address,
          parseUnits("90", 18),
          10_000
        );

        expect(ret).eq(true);
      });
      it("should return false, high negative price impact", async () => {
        await priceOracle.changePrices(
          [usdc.address, dai.address],
          [parseUnits("1", 18), parseUnits("1", 18)]
        );
        const ret = await facade.isConversionValid(
          priceOracle.address,
          usdc.address,
          parseUnits("100", 6),
          dai.address,
          parseUnits("89", 18),
          10_000
        );

        expect(ret).eq(false);
      });
      it("should return true, big positive price impact", async () => {
        await priceOracle.changePrices(
          [usdc.address, dai.address],
          [parseUnits("1", 18), parseUnits("1", 18)]
        );
        const ret = await facade.isConversionValid(
          priceOracle.address,
          usdc.address,
          parseUnits("100", 6),
          dai.address,
          parseUnits("2000", 18),
          10_000
        );

        expect(ret).eq(true);
      });
    });
    describe("Gas estimation @skip-on-coverage", () => {
      it("should not exceed gas limits", async () => {
        const gasUsed = await facade.estimateGas.isConversionValid(
          priceOracle.address,
          usdc.address,
          parseUnits("100", 6),
          dai.address,
          parseUnits("2000", 18),
          10_000
        );
        controlGasLimitsEx2(gasUsed, GAS_SWAP_LIB_IS_CONVERSION_VALID, (u, t) => {
          expect(u).to.be.below(t);
        });
      });
    });
  });
//endregion Unit tests

});
