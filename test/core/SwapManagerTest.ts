import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {
  Controller, IMockERC20__factory,
  MockERC20, MockERC20__factory, SwapManager, SwapManager__factory, TetuLiquidatorMock,
} from "../../typechain";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {BigNumber} from "ethers";
import {TetuConverterApp} from "../baseUT/helpers/TetuConverterApp";
import {CoreContractsHelper} from "../baseUT/helpers/CoreContractsHelper";
import {MocksHelper} from "../baseUT/helpers/MocksHelper";
import {Misc} from "../../scripts/utils/Misc";

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

    tokens = [usdt, dai, matic, weth, usdc];
    assets = [_usdt, _dai, _matic, _weth, _usdc];
    prices = [$usdt, $dai, $matic, $weth, $usdc];

    liquidator = await DeployUtils.deployContract(deployer, "TetuLiquidatorMock",
      assets, prices) as TetuLiquidatorMock;

    // Deploy all application contracts
    controller = await TetuConverterApp.createController(deployer,
      {
        tetuLiquidatorAddress: liquidator.address,
        priceOracleFabric: async c => (await MocksHelper.getPriceOracleMock(
            deployer,
            [usdt.address, dai.address, matic.address, weth.address, usdc.address],
            [$usdt, $dai, $matic, $weth, $usdc]
          )
        ).address
      }
    );

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
        ethers.constants.AddressZero)).revertedWith("TC-1 zero address")
    });
  });

  describe("getConverter", () => {
    it("Should return right converter if price impact is zero", async () => {
      const tetuConverter = await controller.tetuConverter();
      for (const sourceToken of assets) {
        for (const targetToken of assets) {
          if (sourceToken === targetToken) continue;
          const tokenInDecimals = await IMockERC20__factory.connect(sourceToken, user).decimals();
          const sourceAmount = parseUnits('100', tokenInDecimals);

          await MockERC20__factory.connect(sourceToken, user).mint(user.address, sourceAmount);
          await MockERC20__factory.connect(sourceToken, user).approve(tetuConverter, sourceAmount);

          const converter = await swapManager.callStatic.getConverter(
            user.address,
            sourceToken,
            sourceAmount,
            targetToken
          );
          await swapManager.getConverter(
            user.address,
            sourceToken,
            sourceAmount,
            targetToken
          );

          expect(converter.converter).eq(swapManager.address)
          expect(converter.apr18).eq(BigNumber.from('0'))
        }
      }
    });

    it("Should return right APR", async () => {
      // we try to use very high price impacts, so we need to avoid !PRICE exception in getConverter
      await liquidator.setDisablePriceException(true);
      const ret: string[] = [];
      const expected: string[] = [];
      const tetuConverter = await controller.tetuConverter();

      for (const sourceToken of assets) {
        for (const targetToken of assets) {
          if (sourceToken === targetToken) continue;

          const tokenInDecimals = await IMockERC20__factory.connect(sourceToken, user).decimals();
          const sourceAmount = parseUnits('100', tokenInDecimals);
          for (let priceImpactPercent = 0; priceImpactPercent < 3; priceImpactPercent++) {

            await liquidator.setPriceImpact(BigNumber.from(priceImpactPercent).mul('1000')); // 1 %
            await MockERC20__factory.connect(sourceToken, user).mint(user.address, sourceAmount);
            await MockERC20__factory.connect(sourceToken, user).approve(tetuConverter, sourceAmount);
            console.log(`User ${user.address} has approved ${sourceAmount.toString()} to ${tetuConverter}`);

            const converter = await swapManager.callStatic.getConverter(
              user.address,
              sourceToken,
              sourceAmount,
              targetToken
            );
            // we need to multiple one-side-conversion-loss on 2 to get loss for there and back conversion
            const loss = sourceAmount.mul(priceImpactPercent).div(100).mul(2);

            ret.push([
              converter.converter,
              converter.apr18.toString()
            ].join());
            expected.push([
              swapManager.address,
              loss.mul(Misc.WEI).div(sourceAmount).toString()
            ].join());
          }
        }
      }

      expect(ret.join('\n')).eq(expected.join('\n'));
    });

    describe("Ensure that getConverter doesn't change user balances", () => {
      async function makeBalancesTest(
        priceImpactPercent: number
      ) : Promise<{userBalanceBefore: BigNumber, userBalanceAfter: BigNumber, converter: string}> {
        const sourceToken = usdc.address;
        const targetToken = dai.address;
        const tetuConverter = await controller.tetuConverter();

        await liquidator.setPriceImpact(BigNumber.from(priceImpactPercent).mul('1000')); // 1 %
        const tokenInDecimals = await IMockERC20__factory.connect(sourceToken, user).decimals();
        const sourceAmount = parseUnits('100', tokenInDecimals);

        await MockERC20__factory.connect(sourceToken, user).mint(user.address, sourceAmount);
        await MockERC20__factory.connect(sourceToken, user).approve(tetuConverter, sourceAmount);
        console.log(`User ${user.address} has approved ${sourceAmount.toString()} to ${tetuConverter}`);

        const userBalanceBefore = await MockERC20__factory.connect(sourceToken, user).balanceOf(user.address);
        const {converter} = await swapManager.callStatic.getConverter(
          user.address,
          sourceToken,
          sourceAmount,
          targetToken
        );
        await swapManager.getConverter(
          user.address,
          sourceToken,
          sourceAmount,
          targetToken
        );
        const userBalanceAfter = await MockERC20__factory.connect(sourceToken, user).balanceOf(user.address);
        return {userBalanceBefore, userBalanceAfter, converter};
      }
      it("Should not change user balance when price impact is low", async () => {
        const r = await makeBalancesTest(1);
        const ret = [
          r.userBalanceBefore.eq(r.userBalanceAfter),
          r.converter === Misc.ZERO_ADDRESS
        ].join();
        const expected = [true, false].join();
        expect(ret).eq(expected);
      });
      it("Should not change user balance when price impact is high and !PRICE error is generated", async () => {
        const r = await makeBalancesTest(90);
        const ret = [
          r.userBalanceBefore.eq(r.userBalanceAfter),
          r.converter === Misc.ZERO_ADDRESS
        ].join();
        const expected = [true, true].join();
        expect(ret).eq(expected);
      });
    });

  });

  describe("swap", () => {

    const swap = async (
      tokenIn: MockERC20,
      tokenOut: MockERC20,
    ) => {
      const tokenInDecimals = await tokenIn.decimals();
      const sourceAmount = parseUnits('1', tokenInDecimals);

      await MockERC20__factory.connect(tokenIn.address, user).mint(user.address, sourceAmount);
      await MockERC20__factory.connect(tokenIn.address, user).approve(controller.tetuConverter(), sourceAmount);
      const converter = await swapManager.callStatic.getConverter(
        user.address,
        tokenIn.address,
        sourceAmount,
        tokenOut.address
      );
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
      const ret: boolean[] = [];
      const expected: boolean[] = [];
      for (const tokenIn of tokens) {
        for (const tokenOut of tokens) {
          if (tokenIn === tokenOut) continue;
          ret.push(await swap(tokenIn, tokenOut));
          expected.push(true);
        }
      }

      expect(ret.join()).eq(expected.join()); // TODO take slippage into account
    });
  });

  describe("events", () => {
    it("should emit expected events", async () => {
      const sourceAsset = (await MocksHelper.createMockedCToken(deployer))
      const targetAsset = (await MocksHelper.createMockedCToken(deployer));
      const receiver = ethers.Wallet.createRandom().address;
      const tetuLiquidator = (await MocksHelper.createTetuLiquidatorMock(deployer,
        [sourceAsset.address, targetAsset.address],
        [Misc.WEI, Misc.WEI]
      )).address;
      const localController = await TetuConverterApp.createController(
        deployer, {
          borrowManagerFabric: async () => ethers.Wallet.createRandom().address,
          tetuConverterFabric: async () => ethers.Wallet.createRandom().address,
          debtMonitorFabric: async () => ethers.Wallet.createRandom().address,
          keeperFabric: async () => ethers.Wallet.createRandom().address,
          swapManagerFabric: async c => (await CoreContractsHelper.createSwapManager(deployer, c)).address,
          tetuLiquidatorAddress: tetuLiquidator
        }
      );

      const localSwapManager = SwapManager__factory.connect(await localController.swapManager(), deployer);
      await sourceAsset.mint(localSwapManager.address, parseUnits("1"));
      await expect(
        localSwapManager.swap(
          sourceAsset.address,
          parseUnits("1"),
          targetAsset.address,
          parseUnits("1"),
          receiver
        )
      ).to.emit(localSwapManager, "OnSwap").withArgs(
        sourceAsset.address,
        parseUnits("1"),
        targetAsset.address,
        parseUnits("1"),
        receiver,
        parseUnits("1"),
      );
    });
  });
//endregion Unit tests

});
