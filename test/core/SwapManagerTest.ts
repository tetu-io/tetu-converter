import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {
  Controller, IMockERC20__factory,
  MockERC20, SwapManager, SwapManager__factory, TetuLiquidatorMock,
} from "../../typechain";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {BigNumber} from "ethers";
import {TetuConverterApp} from "../baseUT/helpers/TetuConverterApp";

const parseUnits = ethers.utils.parseUnits;

describe("SwapManager", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let liquidator: TetuLiquidatorMock;
  let controller: Controller;
  let swapManager: SwapManager;
  let assets: string[];
  let prices: BigNumber[];
  let tokens: MockERC20[];
  // tslint:disable-next-line:one-variable-per-declaration
  let usdc: MockERC20, usdt: MockERC20, dai: MockERC20, matic: MockERC20, weth: MockERC20, unknown: MockERC20;
  // tslint:disable-next-line:one-variable-per-declaration
  let _usdc: string, _usdt: string, _dai: string, _matic: string, _weth: string, _unknown: string;
  // tslint:disable-next-line:one-variable-per-declaration
  let $usdc: BigNumber, $usdt: BigNumber, $dai: BigNumber, $matic: BigNumber, $weth: BigNumber;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
    user = signers[1];

    // Deploy Liquidator Mock with Mock tokens
    usdc = await DeployUtils.deployContract(deployer, 'MockERC20', 'USDC', 'USDC', 6) as MockERC20;
    _usdc = usdc.address;
    usdt = await DeployUtils.deployContract(deployer, 'MockERC20', 'USDT', 'USDT', 6) as MockERC20;
    _usdt = usdt.address;
    dai = await DeployUtils.deployContract(deployer, 'MockERC20', 'Dai', 'DAI', 18) as MockERC20;
    _dai = dai.address;
    matic = await DeployUtils.deployContract(deployer, 'MockERC20', 'Matic', 'MATIC', 18) as MockERC20;
    _matic = matic.address;
    weth = await DeployUtils.deployContract(deployer, 'MockERC20', 'Wrapped Ether', 'WETH', 18) as MockERC20;
    _weth = weth.address;
    unknown = await DeployUtils.deployContract(deployer, 'MockERC20', 'Unknown Token', 'UNKNOWN', 18) as MockERC20;
    _unknown = unknown.address;


    $usdc = parseUnits('1');
    $usdt = parseUnits('1');
    $dai = parseUnits('1');
    $matic = parseUnits('0.4');
    $weth = parseUnits('2000');

    tokens = [usdc, usdt, dai, matic, weth];
    assets = [_usdc, _usdt, _dai, _matic, _weth];
    prices = [$usdc, $usdt, $dai, $matic, $weth];

    liquidator = await DeployUtils.deployContract(deployer, "TetuLiquidatorMock",
      assets, prices) as TetuLiquidatorMock;

    // Deploy all application contracts
    controller = await TetuConverterApp.createController(deployer, {tetuLiquidatorAddress: liquidator.address});

    // Deploy SwapManager
    swapManager = SwapManager__factory.connect(await controller.swapManager(), deployer) as SwapManager;
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
  describe("Constants", () => {

    it("SLIPPAGE_NUMERATOR", async () => {
      expect(await swapManager.SLIPPAGE_NUMERATOR()).eq(BigNumber.from('100000'))
    });

    it("SLIPPAGE_TOLERANCE", async () => {
      expect(await swapManager.SLIPPAGE_TOLERANCE()).eq(BigNumber.from('1000'))
    });

    it("PRICE_IMPACT_NUMERATOR", async () => {
      expect(await swapManager.PRICE_IMPACT_NUMERATOR()).eq(BigNumber.from('100000'))
    });

    it("PRICE_IMPACT_TOLERANCE", async () => {
      expect(await swapManager.PRICE_IMPACT_TOLERANCE()).eq(BigNumber.from('2000'))
    });

    it("APR_NUMERATOR", async () => {
      expect(await swapManager.APR_NUMERATOR()).eq(BigNumber.from('10').pow(18))
    });

    it("getConversionKind", async () => {
      expect(await swapManager.getConversionKind()).eq(BigNumber.from('1'))
    });

  });

  describe("Constructor", () => {
    it("Revert on zero controller", async () => {
      await expect(DeployUtils.deployContract(deployer, "SwapManager",
        ethers.constants.AddressZero)).revertedWith('TC-1')
    });
  });

  describe("getConverter", () => {
    it("Should return right converter", async () => {
      for (const sourceToken of assets) {
        for (const targetToken of assets) {
          if (sourceToken === targetToken) continue;
          const tokenInDecimals = await IMockERC20__factory.connect(sourceToken, user).decimals();
          const params = {
            healthFactor2: BigNumber.from(100),
            sourceToken,
            targetToken,
            periodInBlocks: ethers.constants.MaxUint256,
            sourceAmount: parseUnits('100', tokenInDecimals)
          }
          const converter = await swapManager.getConverter(params);

          expect(converter.converter).eq(swapManager.address)
          expect(converter.apr18).eq(BigNumber.from('0'))
        }
      }
    });

    it("Should return right APR", async () => {
      for (const sourceToken of assets) {
        for (const targetToken of assets) {
          if (sourceToken === targetToken) continue;

          const tokenInDecimals = await IMockERC20__factory.connect(sourceToken, user).decimals();
          const sourceAmount = parseUnits('100', tokenInDecimals);
          const params = {
            healthFactor2: BigNumber.from(100),
            sourceToken,
            targetToken,
            periodInBlocks: ethers.constants.MaxUint256,
            sourceAmount
          }

          for (let priceImpactPercent = 1; priceImpactPercent < 5; priceImpactPercent++) {

            await liquidator.setPriceImpact(BigNumber.from(priceImpactPercent).mul('1000')); // 1 %

            const converter = await swapManager.getConverter(params);
            // decrease priceImpactPercent twice
            const returnAmount = sourceAmount
              .mul(100 - priceImpactPercent).div(100)
              .mul(100 - priceImpactPercent).div(100);

            const loss = sourceAmount.sub(returnAmount);
            const one18 = BigNumber.from('10').pow(18);

            expect(converter.converter).eq(swapManager.address);
            expect(converter.apr18).eq(loss.mul(one18).div(sourceAmount));
          }
        }
      }
    });
  });

  describe("swap", () => {

    const swap = async (
      tokenIn: MockERC20,
      tokenOut: MockERC20,
    ) => {
      const tokenInDecimals = await tokenIn.decimals();
      const sourceAmount = parseUnits('1', tokenInDecimals);

      const params = {
        healthFactor2: BigNumber.from(100),
        sourceToken: tokenIn.address,
        targetToken: tokenOut.address,
        periodInBlocks: ethers.constants.MaxUint256,
        sourceAmount
      }
      const converter = await swapManager.getConverter(params);
      const targetAmount = converter.maxTargetAmount;
      console.log('targetAmount', targetAmount);

      await tokenIn.mint(swapManager.address, sourceAmount);
      const balanceOutBefore = await tokenOut.balanceOf(user.address);
      await swapManager.swap(
        tokenIn.address, sourceAmount, tokenOut.address, targetAmount, user.address);
      const balanceOutAfter = await tokenOut.balanceOf(user.address);

      const amountOut = balanceOutAfter.sub(balanceOutBefore);
      console.log('amountOut', amountOut);
      return amountOut.eq(targetAmount)
    };

    it("Should make swap for provided amount out", async () => {
      for (const tokenIn of tokens) {
        for (const tokenOut of tokens) {
          if (tokenIn === tokenOut) continue;
          expect(await swap(tokenIn, tokenOut)).eq(true);
        }
      }
    });

    it("Should revert with slippage", async () => {
      await liquidator.setSlippage('3000');
      await expect(swap(usdc, usdt)).revertedWith('TC-36: SLIPPAGE TOO BIG');

    });
  });

//endregion Unit tests

});
