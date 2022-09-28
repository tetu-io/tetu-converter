import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {
  Controller, IMockERC20__factory,
  MockERC20, SwapManager, TetuLiquidatorMock,
} from "../../typechain";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {BigNumber} from "ethers";
import {COUNT_BLOCKS_PER_DAY} from "../baseUT/utils/aprUtils";

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
    $matic = parseUnits('0.5');
    $weth = parseUnits('1200');

    tokens = [usdc, usdt, dai, matic, weth];
    assets = [_usdc, _usdt, _dai, _matic, _weth];
    prices = [$usdc, $usdt, $dai, $matic, $weth];

    liquidator = await DeployUtils.deployContract(deployer, "TetuLiquidatorMock",
      assets, prices) as TetuLiquidatorMock;

    // Deploy Controller
    controller = await DeployUtils.deployContract(deployer, "Controller",
      COUNT_BLOCKS_PER_DAY, 500, deployer.address) as Controller;

    // Deploy SwapManager
    swapManager = await DeployUtils.deployContract(deployer, "SwapManager",
      controller.address) as SwapManager;

    // Init Controller
    await controller.initialize(
      ethers.Wallet.createRandom().address,
      ethers.Wallet.createRandom().address,
      ethers.Wallet.createRandom().address,
      ethers.Wallet.createRandom().address,
      liquidator.address,
      swapManager.address
    )
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

    it("SLIPPAGE_DENOMINATOR", async () => {
      expect(await swapManager.SLIPPAGE_DENOMINATOR()).eq(BigNumber.from('100000'))
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
            sourceAmount: parseUnits('1', tokenInDecimals)
          }
          const converter = await swapManager.getConverter(params);

          expect(converter.converter).eq(swapManager.address)
          expect(converter.aprForPeriod36).eq(BigNumber.from('0'))
        }
      }
    });
  });

  describe("swap", () => {

    const swap = async (
      tokenIn: MockERC20,
      tokenOut: MockERC20,
      slippageTolerance: string ='2000'
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
        tokenIn.address, sourceAmount, tokenOut.address, targetAmount, user.address, '5000', slippageTolerance
      );
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
