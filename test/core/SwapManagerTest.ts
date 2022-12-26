import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {
  Controller, IMockERC20__factory,
  MockERC20, MockERC20__factory, PriceOracleMock__factory, SwapManager, SwapManager__factory, TetuLiquidatorMock,
} from "../../typechain";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {BigNumber} from "ethers";
import {TetuConverterApp} from "../baseUT/helpers/TetuConverterApp";
import {CoreContractsHelper} from "../baseUT/helpers/CoreContractsHelper";
import {MocksHelper} from "../baseUT/helpers/MocksHelper";
import {Misc} from "../../scripts/utils/Misc";
import {controlGasLimitsEx} from "../../scripts/utils/hardhatUtils";
import {GAS_FIND_SWAP_STRATEGY} from "../baseUT/GasLimit";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import {BalanceUtils} from "../baseUT/utils/BalanceUtils";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";

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

    it("PRICE_IMPACT_TOLERANCE_DEFAULT", async () => {
      expect(await swapManager.PRICE_IMPACT_TOLERANCE_DEFAULT()).eq(BigNumber.from('2000'))
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
    interface IMakeGetConverterTest {
      userBalanceBefore: BigNumber;
      userBalanceAfter: BigNumber;
      converter: string;
      maxTargetAmount: BigNumber;
      expectedMaxTargetAmount: BigNumber;
      gasUsed: BigNumber;
    }
    async function makeGetConverterTest(
      priceImpactPercent: number
    ): Promise<IMakeGetConverterTest> {
      const sourceToken = usdc.address;
      const targetToken = matic.address; // matic has price != 1
      const tetuConverter = await controller.tetuConverter();

      await liquidator.setPriceImpact(BigNumber.from(priceImpactPercent).mul('1000')); // 1 %
      const tokenInDecimals = await IMockERC20__factory.connect(sourceToken, user).decimals();
      const sourceAmount = parseUnits('100', tokenInDecimals);

      await MockERC20__factory.connect(sourceToken, user).mint(user.address, sourceAmount);
      await MockERC20__factory.connect(sourceToken, user).approve(tetuConverter, sourceAmount);
      console.log(`User ${user.address} has approved ${sourceAmount.toString()} to ${tetuConverter}`);

      const userBalanceBefore = await MockERC20__factory.connect(sourceToken, user).balanceOf(user.address);
      const results = await swapManager.callStatic.getConverter(
        user.address,
        sourceToken,
        sourceAmount,
        targetToken
      );
      const gasUsed = await swapManager.estimateGas.getConverter(
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

      const loss = sourceAmount.mul(priceImpactPercent).div(100); // one-side-conversion-loss
      const expectedMaxTargetAmount = (sourceAmount.sub(loss))
        .mul($usdc)
        .div($matic)
        .mul(parseUnits("1", 18)) // matic decimals
        .div(parseUnits("1", 6)); // usdc decimals
      return {
        userBalanceBefore,
        userBalanceAfter,
        converter: results.converter,
        gasUsed,
        maxTargetAmount: results.maxTargetAmount,
        expectedMaxTargetAmount,
      };
    }
    describe("Good paths", () => {
      it("Should return expected converter and not zero max target amount when price impact is 0", async () => {
        const ret: string[] = [];
        const expected: string[] = [];
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

            ret.push([converter.converter, converter.maxTargetAmount.eq(0)].join());
            expected.push([swapManager.address, false].join());
          }
        }

        expect(ret.join("\n")).eq(expected.join("\n"));
      });
      describe("Convert USDC (price 1) to Matic (price 0.4), price impact is low", () => {
        it("Should return expected values", async () => {
          const r = await makeGetConverterTest(1);

          const ret = [
            r.converter,
            r.maxTargetAmount,
          ].join();

          const expected = [
            swapManager.address,
            r.expectedMaxTargetAmount,
          ].join();

          expect(ret).eq(expected);
        });
        it("Should not change user balance", async () => {
          const r = await makeGetConverterTest(1);
          const ret = [
            r.userBalanceBefore.eq(r.userBalanceAfter),
            r.converter === Misc.ZERO_ADDRESS
          ].join();
          const expected = [true, false].join();
          expect(ret).eq(expected);
        });
      });
    });
    describe("Bad paths", () => {
      describe("price impact is high and !PRICE error is generated", () => {
        it("Should return expected values", async () => {
          const r = await makeGetConverterTest(
            90 // (!)
          );

          const ret = [
            r.converter,
            r.maxTargetAmount,
          ].join();

          const expected = [
            Misc.ZERO_ADDRESS,
            0,
          ].join();

          expect(ret).eq(expected);
        });
        it("Should not change user balance", async () => {
          const r = await makeGetConverterTest(90);
          const ret = [
            r.userBalanceBefore.eq(r.userBalanceAfter),
            r.converter === Misc.ZERO_ADDRESS
          ].join();
          const expected = [true, true].join();
          expect(ret).eq(expected);
        });
      });
    });
    describe("Gas estimation @skip-on-coverage", () => {
      it("should return expected values", async () => {
        const r = await makeGetConverterTest(1);
        controlGasLimitsEx(r.gasUsed, GAS_FIND_SWAP_STRATEGY, (u, t) => {
          expect(u).to.be.below(t);
        });
      });
    });
  });

  describe("getApr18", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        // we need to multiple one-side-conversion-loss on 2 to get loss for there and back conversion
        const sourceAmount = parseUnits("2", 18);
        const targetAmount = parseUnits("1", 6);
        const ret = await swapManager.getApr18(dai.address, sourceAmount, usdc.address, targetAmount);
        const targetAmountInTermsSourceTokens = targetAmount
          .mul($usdc)
          .div($dai)
          .mul(parseUnits("1", 18))
          .div(parseUnits("1", 6));
        const expectedApr18 = sourceAmount
          .sub(targetAmountInTermsSourceTokens)
          .mul(2)
          .mul(Misc.WEI)
          .div(sourceAmount);
        expect(ret.eq(expectedApr18)).eq(true);
      })
      it("Should return right APR for all asset pairs", async () => {
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

              const r = await swapManager.callStatic.getConverter(
                user.address,
                sourceToken,
                sourceAmount,
                targetToken
              );
              const apr18 = await swapManager.getApr18(sourceToken, sourceAmount, targetToken, r.maxTargetAmount);
              // we need to multiple one-side-conversion-loss on 2 to get loss for there and back conversion
              const loss = sourceAmount.mul(priceImpactPercent).div(100).mul(2);

              ret.push([
                r.converter,
                apr18.toString()
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
    });
    describe("Bad paths", () => {
      it("should revert if collateral price is zero", async () => {
        const sourceAmount = parseUnits("2", 18);
        const targetAmount = parseUnits("1", 6);
        await PriceOracleMock__factory.connect(await controller.priceOracle(), deployer).changePrices([dai.address], [0]);
        await expect(
          swapManager.getApr18(dai.address, sourceAmount, usdc.address, targetAmount)
        ).revertedWith("TC-4 zero price"); // ZERO_PRICE
      });
      it("should revert if borrow price is zero", async () => {
        const sourceAmount = parseUnits("2", 18);
        const targetAmount = parseUnits("1", 6);
        await PriceOracleMock__factory.connect(await controller.priceOracle(), deployer).changePrices([usdc.address], [0]);
        await expect(
          swapManager.getApr18(dai.address, sourceAmount, usdc.address, targetAmount)
        ).revertedWith("TC-4 zero price"); // ZERO_PRICE
      });
    });
  });

  describe("swap", () => {
    async function makeSwapTest(tokenIn: MockERC20, tokenOut: MockERC20) : Promise<boolean> {
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
      await swapManager.swap(tokenIn.address, sourceAmount, tokenOut.address, user.address);

      const balanceOutAfter = await tokenOut.balanceOf(user.address);
      const amountOut = balanceOutAfter.sub(balanceOutBefore);
      console.log('amountOut', amountOut);

      return amountOut.eq(targetAmount)
    }

    describe("Good paths", () => {
      it("Should make swap for provided amount out", async () => {
        const ret: boolean[] = [];
        const expected: boolean[] = [];
        for (const tokenIn of tokens) {
          for (const tokenOut of tokens) {
            if (tokenIn === tokenOut) continue;
            ret.push(await makeSwapTest(tokenIn, tokenOut));
            expected.push(true);
          }
        }

        expect(ret.join()).eq(expected.join());
      });
    });

    describe("Bad paths", () => {
      describe("the price is too different from the value calculated using PriceOracle", () => {
        it("should revert if the result amount is too low", async () => {
          await liquidator.changePrices([usdc.address], [$usdc.mul(100)]);
          await expect(
            makeSwapTest(usdc, usdt)
          ).revertedWith("TC-54 price impact"); // TOO_HIGH_PRICE_IMPACT
        });
        it("should revert if the result amount is too high", async () => {
          await liquidator.changePrices([usdc.address], [$usdc.div(100)]);
          await expect(
            makeSwapTest(usdc, usdt)
          ).revertedWith("TC-54 price impact"); // TOO_HIGH_PRICE_IMPACT
        });
      });
    });
  });

  describe("simulateSwap", () => {
    describe("Good paths", () => {
      it("should change balances in expected way", async () => {
        const swapManagerAsSwapManager = SwapManager__factory.connect(
          swapManager.address,
          await DeployerUtils.startImpersonate(swapManager.address)
        );
        const sourceAmount = parseUnits('100', 18); // dai

        await MockERC20__factory.connect(dai.address, user).mint(user.address, sourceAmount);
        await MockERC20__factory.connect(dai.address, user).approve(await controller.tetuConverter(), sourceAmount);
        const estimatedMaxTargetAmount = await swapManagerAsSwapManager.callStatic.simulateSwap(
          user.address,
          dai.address,
          sourceAmount,
          usdc.address
        );
        await swapManagerAsSwapManager.simulateSwap(
          user.address,
          dai.address,
          sourceAmount,
          usdc.address
        );
        const usdcBalanceSwapManagerAfter = await usdc.balanceOf(swapManager.address);
        const daiBalanceUserAfter = await usdc.balanceOf(dai.address);

        const ret = [
          usdcBalanceSwapManagerAfter.toString(),
          daiBalanceUserAfter.toString()
        ].join();
        const expected = [
          estimatedMaxTargetAmount.toString(),
          "0"
        ].join();

        expect(ret).eq(expected);
      });
    });
    describe("Bad paths", () => {
      it("should revert if not swap manager", async () => {
        const swapManagerAsRandomUser = SwapManager__factory.connect(
          swapManager.address,
          await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address)
        );
        const sourceAmount = parseUnits('100', 18); // dai

        await MockERC20__factory.connect(dai.address, user).mint(user.address, sourceAmount);
        await MockERC20__factory.connect(dai.address, user).approve(await controller.tetuConverter(), sourceAmount);
        await expect(
          swapManagerAsRandomUser.simulateSwap(
            user.address,
            dai.address,
            sourceAmount,
            usdc.address
          )
        ).revertedWith("TC-53 swap manager only"); // ONLY_SWAP_MANAGER
      });
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
          swapManagerFabric: async c => (await CoreContractsHelper.createSwapManager(deployer, c.address)).address,
          tetuLiquidatorAddress: tetuLiquidator,
          priceOracleFabric: async c => (await MocksHelper.getPriceOracleMock(
              deployer,
              [sourceAsset.address, targetAsset.address],
              [Misc.WEI, Misc.WEI]
            )
          ).address
        }
      );

      const localSwapManager = SwapManager__factory.connect(await localController.swapManager(), deployer);
      await sourceAsset.mint(localSwapManager.address, parseUnits("1"));
      await expect(
        localSwapManager.swap(
          sourceAsset.address,
          parseUnits("1"),
          targetAsset.address,
          receiver
        )
      ).to.emit(localSwapManager, "OnSwap").withArgs(
        sourceAsset.address,
        parseUnits("1"),
        targetAsset.address,
        receiver,
        parseUnits("1"),
      );
    });
  });

  describe("setPriceImpactTolerance", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        const customValueUSDC = BigNumber.from(10_000);
        const customValueDAI = BigNumber.from(5_000);
        await swapManager.setPriceImpactTolerance(usdt.address, 0);
        await swapManager.setPriceImpactTolerance(usdc.address, customValueUSDC);
        await swapManager.setPriceImpactTolerance(dai.address, customValueDAI);

        const ret = [
          await swapManager.priceImpactTolerances(usdt.address),
          await swapManager.priceImpactTolerances(usdc.address),
          await swapManager.priceImpactTolerances(dai.address)
       ].map(x => BalanceUtils.toString(x)).join("\n");
        const expected = [
          0,
          customValueUSDC,
          customValueDAI
        ].map(x => BalanceUtils.toString(x)).join("\n");
        expect(ret).eq(expected);
      });

      describe("clear custom price impact tolerance", () => {
        it("should return default value", async () => {
          const defaultValue = await swapManager.PRICE_IMPACT_TOLERANCE_DEFAULT();
          const customValue = BigNumber.from(10_000);

          await swapManager.setPriceImpactTolerance(usdc.address, customValue);
          const before = await swapManager.getPriceImpactTolerance(usdc.address);
          await swapManager.setPriceImpactTolerance(usdc.address, 0);
          const after = await swapManager.getPriceImpactTolerance(usdc.address);

          const ret = [before.toString(), after.toString()].join();
          const expected = [customValue.toString(), defaultValue.toString()].join();
          expect(ret).eq(expected);
        });
      });
    });
    describe("Bad paths", () => {
      it("should revert if not gov", async () => {
        const notGov = ethers.Wallet.createRandom().address;
        const swapManagerAsNotGov = SwapManager__factory.connect(
          swapManager.address,
          await DeployerUtils.startImpersonate(notGov)
        );

        await expect(
          swapManagerAsNotGov.setPriceImpactTolerance(usdc.address, 10_000)
        ).revertedWith("TC-9 governance only"); // GOVERNANCE_ONLY
      });

      it("should revert if price impact tolerance value is too high", async () => {
        await expect(
          swapManager.setPriceImpactTolerance(
            usdc.address,
            1_000_000 // (!) too high
          )
        ).revertedWith("TC-29 incorrect value"); // INCORRECT_VALUE
      });
    });
  });

  describe("getPriceImpactTolerance", () => {
    it("should return custom value", async() => {
      await swapManager.setPriceImpactTolerance(usdc.address, 10_000);
      const ret = await swapManager.getPriceImpactTolerance(usdc.address);
      expect(ret.eq(10_000)).eq(true);
    });
    it("should return default value", async() => {
      const defaultValue = await swapManager.PRICE_IMPACT_TOLERANCE_DEFAULT();
      const ret = await swapManager.getPriceImpactTolerance(usdc.address);
      expect(ret.eq(defaultValue)).eq(true);
    });
  });

  describe("convertUsingPriceOracle", () => {
    describe("Good paths", () => {
      it("should return expected value", async () => {
        const amountUsdc = parseUnits("100", 6);
        const amountWeth = await swapManager.convertUsingPriceOracle(
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
          swapManager.convertUsingPriceOracle(usdc.address, amountUsdc, MaticAddresses.EURS)
        ).revertedWith("TC-4 zero price"); // ZERO_PRICE
      });
      it("should revert if source asset has zero price", async () => {
        const amountUsdc = parseUnits("100", 6);
        await expect(
          swapManager.convertUsingPriceOracle(MaticAddresses.EURS, amountUsdc, usdc.address)
        ).revertedWith("TC-4 zero price"); // ZERO_PRICE
      });
    });
  });
//endregion Unit tests

});
