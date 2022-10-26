import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {
  MockERC20,
  TetuLiquidatorMock,
} from "../../typechain";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {BigNumber} from "ethers";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
const parseUnits = ethers.utils.parseUnits;

describe("TetuLiquidatorMock", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;
  let mock: TetuLiquidatorMock;
  let assets: string[];
  let prices: BigNumber[];
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
    user1 = signers[2];

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

    assets = [_usdc, _usdt, _dai, _matic, _weth];
    prices = [$usdc, $usdt, $dai, $matic, $weth];

    mock = await DeployUtils.deployContract(deployer, "TetuLiquidatorMock",
      assets, prices) as TetuLiquidatorMock;
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
  const ONE18 = parseUnits('1', 18);
  const ONE6 = parseUnits('1', 6);

  describe("getPrice", () => {

    it("Should return right prices", async () => {
      expect(await mock.getPrice(_usdc, _usdt, ONE6)).equal(ONE6);
      expect(await mock.getPrice(_usdt, _usdc, ONE6)).equal(ONE6);

      expect(await mock.getPrice(_usdt, _dai, ONE6)).equal(ONE18);
      expect(await mock.getPrice(_dai, _usdc, ONE18)).equal(ONE6);

      expect(await mock.getPrice(_matic, _usdc, ONE18)).equal(ONE6.div(2));
      expect(await mock.getPrice(_matic, _dai, ONE18.mul(2))).equal(ONE18);

      expect(await mock.getPrice(_weth, _usdc, ONE18)).equal(ONE6.mul(1200));
      expect(await mock.getPrice(_weth, _dai, ONE18)).equal(ONE18.mul(1200));

      expect(await mock.getPrice(_weth, _matic, ONE18)).equal(ONE18.mul('2400'));

    });
    it("Should return 0", async () => {
      expect(await mock.getPrice(_usdc, _unknown, ONE6)).equal(0);
      expect(await mock.getPrice(_unknown, _usdt, ONE18)).equal(0);

    });
  });

  describe("liquidate", () => {
    const liquidate = async (
      tokenIn: MockERC20,
      tokenOut: MockERC20,
      amount: BigNumber,
      priceImpactTolerance: BigNumber = BigNumber.from('1000') // 1%
    ) => {
      await tokenIn.mint(mock.address, amount);

      const balanceOutBefore = await tokenOut.balanceOf(deployer.address);
      await mock.liquidate(tokenIn.address, tokenOut.address, amount, priceImpactTolerance);
      const balanceOutAfter = await tokenOut.balanceOf(deployer.address);

      return balanceOutAfter.sub(balanceOutBefore);
    };

    it("Should return right prices", async () => {
      expect(await liquidate(usdc, usdt, ONE6)).equal(ONE6);
      expect(await liquidate(usdt, usdc, ONE6)).equal(ONE6);

      expect(await liquidate(usdt, dai, ONE6)).equal(ONE18);
      expect(await liquidate(dai, usdc, ONE18)).equal(ONE6);

      expect(await liquidate(matic, usdc, ONE18)).equal(ONE6.div(2));
      expect(await liquidate(matic, dai, ONE18.mul(2))).equal(ONE18);

      expect(await liquidate(weth, usdc, ONE18)).equal(ONE6.mul(1200));
      expect(await liquidate(weth, dai, ONE18)).equal(ONE18.mul(1200));

      expect(await liquidate(weth, matic, ONE18)).equal(ONE18.mul('2400'));

    });

    it("Should return 0", async () => {
      expect(await liquidate(usdc, unknown, ONE6)).eq(0);
      expect(await liquidate(unknown, usdt, ONE18)).eq(0);
    });

    it("Should revert priceImpactTolerance", async () => {
      await expect(await liquidate(usdc, usdt, ONE6, BigNumber.from('1000'))).equal(ONE6);
      await mock.setPriceImpact('2000'); // 2%
      await expect(liquidate(usdc, usdt, ONE6, BigNumber.from('1000'))).revertedWith('!PRICE');
    });
  });

  describe("isRouteExist", () => {

    it("Should return true", async () => {
      for (const assetIn of assets)
        for (const assetOut of assets)
          expect(await mock.isRouteExist(assetIn, assetOut)).equal(true);
    });

    it("Should return false", async () => {
      for (const asset of assets) {
          expect(await mock.isRouteExist(asset, _unknown)).equal(false);
          expect(await mock.isRouteExist(_unknown, asset)).equal(false);
        }
    });

  });

  describe("Set up functions", () => {
    it("Should check and setSlippage", async () => {
      expect(await mock.slippage()).equal(BigNumber.from(0));

      await mock.setSlippage(1);
      expect(await mock.slippage()).equal(BigNumber.from(1));

      await mock.setSlippage(0);
      expect(await mock.slippage()).equal(BigNumber.from(0));
    });

    it("Should check and setPriceImpact", async () => {
      expect(await mock.priceImpact()).equal(BigNumber.from(0));

      await mock.setPriceImpact(1);
      expect(await mock.priceImpact()).equal(BigNumber.from(1));

      await mock.setPriceImpact(0);
      expect(await mock.priceImpact()).equal(BigNumber.from(0));
    });

    it("Should check and changePrices", async () => {
      expect(await mock.prices(_usdc)).equal($usdc);
      expect(await mock.prices(_usdt)).equal($usdt);
      expect(await mock.prices(_dai)).equal($dai);
      expect(await mock.prices(_matic)).equal($matic);
      expect(await mock.prices(_weth)).equal($weth);

      const assets2 = [_usdc, _usdt, _dai, _matic];
      const prices2 = [$usdc.mul(2), $usdt.mul(2), $dai.mul(2), $matic.mul(2)];

      await mock.changePrices(assets2, prices2);

      expect(await mock.prices(_usdc)).equal($usdc.mul(2));
      expect(await mock.prices(_usdt)).equal($usdt.mul(2));
      expect(await mock.prices(_dai)).equal($dai.mul(2));
      expect(await mock.prices(_matic)).equal($matic.mul(2));

      // leaved unchanged
      expect(await mock.prices(_weth)).equal($weth);
    });

    it("Should revert on changePrices", async () => {
      await expect(mock.changePrices(assets, prices.slice(0,-1))).revertedWith('wrong lengths');
    });

  });

  describe("Coverage", () => {
    it("Not implemented", async () => {
      const errorText = 'Not implemented';
      await expect(mock.getPriceForRoute([], 0)).revertedWith(errorText);
      await expect(mock.buildRoute(_usdc, _usdt)).revertedWith(errorText);
      await expect(mock.liquidateWithRoute([], 0, 0)).revertedWith(errorText);
    });

  });
//endregion Unit tests

});
