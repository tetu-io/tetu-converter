import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {EntryKindsFacade} from "../../typechain";
import {MocksHelper} from "../baseUT/helpers/MocksHelper";
import {defaultAbiCoder, parseUnits} from "ethers/lib/utils";
import {expect} from "chai";
import {controlGasLimitsEx} from "../../scripts/utils/hardhatUtils";
import {
  GAS_LIMIT_ENTRY_KINDS_EXACT_BORROW_OUT_FOR_MIN_COLLATERAL_IN,
  GAS_LIMIT_ENTRY_KINDS_EXACT_COLLATERAL_IN_FOR_MAX_BORROW_OUT, GAS_LIMIT_ENTRY_KINDS_EXACT_PROPORTIONS,
  GAS_LIMIT_ENTRY_KINDS_GET_ENTRY_KIND
} from "../baseUT/GasLimit";
import {Misc} from "../../scripts/utils/Misc";
import {BalanceUtils} from "../baseUT/utils/BalanceUtils";

describe("EntryKindsTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let facade: EntryKindsFacade;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
    facade = await MocksHelper.getEntryKindsFacade(deployer);
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
  describe("getEntryKind", () => {
    describe("Good paths", () => {
      it("should return expected values for empty entry kind", async () => {
        const ret = await facade.getEntryKind("0x");
        expect(ret.eq(0)).eq(true);
      });
      it("should return expected values for entry kind 0", async () => {
        const ret = await facade.getEntryKind(defaultAbiCoder.encode(['uint256'], [0]));
        expect(ret.eq(0)).eq(true);
      });
      it("should return expected values for entry kind 1", async () => {
        const ret = await facade.getEntryKind(defaultAbiCoder.encode(
          ['uint256', 'uint256', 'uint256'],
          [1, 1, 1]
        ));
        expect(ret.eq(1)).eq(true);
      });
    });
    describe("Bad paths", () => {
      it("should return expected values for unknown entry kind", async () => {
        const ret = await facade.getEntryKind(defaultAbiCoder.encode(
          ['uint256', 'uint256[]', 'uint256'],
          [489, [1, 2, 3], 1]
        ));
        expect(ret.eq(489)).eq(true);
      });
    });
    describe("Gas estimation @skip-on-coverage", () => {
      it("should not exceed gas limits", async () => {
        const gasUsed = await facade.estimateGas.getEntryKind(defaultAbiCoder.encode(['uint256'], [0]));
        controlGasLimitsEx(gasUsed, GAS_LIMIT_ENTRY_KINDS_GET_ENTRY_KIND, (u, t) => {
          expect(u).to.be.below(t);
        });
      });
    });
  });

  describe("exactCollateralInForMaxBorrowOut", () => {
    describe("Good paths", () => {
      describe("Price decimals = 18", () => {
        it("should return expected values", async () => {
          const collateralAmount = parseUnits("200", 14);
          const healthFactor18 = parseUnits("2", 18);
          const liquidationThreshold18 = parseUnits("0.85", 18);
          const priceCollateral = parseUnits("10", 18);
          const priceBorrow = parseUnits("0.5", 18);
          const rc10powDec = parseUnits("1", 14);
          const rb10powDec = parseUnits("1", 27);
          const ret = await facade.exactCollateralInForMaxBorrowOut(
            collateralAmount,
            healthFactor18,
            liquidationThreshold18,
            {priceCollateral, priceBorrow, rc10powDec, rb10powDec},
            false
          );
          const expected = Misc.WEI.mul(collateralAmount).div(healthFactor18)
            .mul(liquidationThreshold18).mul(priceCollateral).div(priceBorrow)
            .mul(rb10powDec).div(Misc.WEI).div(rc10powDec);
          console.log("expected", expected);

          // 200*0.85/2*10/0.5 = 1700
          expect(ret.eq(expected)).eq(true);
        });
      });
      describe("Price decimals = 36", () => {
        it("should return expected values", async () => {
          // $200 mln
          const collateralAmount = parseUnits("200", 18+6);
          const healthFactor18 = parseUnits("2", 18);
          const liquidationThreshold18 = parseUnits("0.85", 18);
          const priceCollateral = parseUnits("10", 36);
          const priceBorrow = parseUnits("0.5", 36);
          const rc10powDec = parseUnits("1", 18);
          const rb10powDec = parseUnits("1", 18);
          const ret = await facade.exactCollateralInForMaxBorrowOut(
            collateralAmount,
            healthFactor18,
            liquidationThreshold18,
            {priceCollateral, priceBorrow, rc10powDec, rb10powDec},
            true // it will revert if false
          );
          const expected = Misc.WEI.mul(collateralAmount).div(healthFactor18)
            .mul(liquidationThreshold18).mul(priceCollateral).div(priceBorrow)
            .mul(rb10powDec).div(Misc.WEI).div(rc10powDec);
          console.log("expected", expected);

          // 200*0.85/2*10/0.5 = 1700 mln
          expect(ret.eq(expected)).eq(true);
        });
      });
    });
    describe("Gas estimation @skip-on-coverage", () => {
      it("should not exceed gas limits", async () => {
        const gasUsed = await facade.estimateGas.exactCollateralInForMaxBorrowOut(
          parseUnits("200", 14),
          parseUnits("2", 18),
          parseUnits("0.85", 18),
          {
            priceCollateral: parseUnits("10", 18),
            priceBorrow: parseUnits("0.5", 18),
            rc10powDec: parseUnits("1", 14),
            rb10powDec: parseUnits("1", 27)
          },
          false
        );
        controlGasLimitsEx(gasUsed, GAS_LIMIT_ENTRY_KINDS_EXACT_COLLATERAL_IN_FOR_MAX_BORROW_OUT, (u, t) => {
          expect(u).to.be.below(t);
        });
      });
    });
  });

  describe("exactBorrowOutForMinCollateralIn", () => {
    describe("Good paths", () => {
      describe("Price decimals = 18", () => {
        it("should return expected values", async () => {
          const borrowAmount = parseUnits("1700", 27);
          const healthFactor18 = parseUnits("2", 18);
          const liquidationThreshold18 = parseUnits("0.85", 18);
          const priceCollateral = parseUnits("10", 18);
          const priceBorrow = parseUnits("0.5", 18);
          const rc10powDec = parseUnits("1", 14);
          const rb10powDec = parseUnits("1", 27);
          const ret = await facade.exactBorrowOutForMinCollateralIn(
            borrowAmount,
            healthFactor18,
            liquidationThreshold18,
            {priceCollateral, priceBorrow, rc10powDec, rb10powDec},
            false
          );

          const expected = borrowAmount
            .mul(healthFactor18)
            .mul(rc10powDec)
            .mul(priceBorrow)
            .div(liquidationThreshold18)
            .div(priceCollateral)
            .div(rb10powDec);

          console.log("ret", ret);
          console.log("expected", expected);

          // 1700/0.85*2/10*0.5 = 200
          expect(ret.eq(expected)).eq(true);
        });
      });
      describe("Price decimals = 36", () => {
        it("should return expected values", async () => {
          // $200 mln
          const borrowAmount = parseUnits("1700", 18+6);
          const healthFactor18 = parseUnits("2", 18);
          const liquidationThreshold18 = parseUnits("0.85", 18);
          const priceCollateral = parseUnits("10", 36);
          const priceBorrow = parseUnits("0.5", 36);
          const rc10powDec = parseUnits("1", 18);
          const rb10powDec = parseUnits("1", 18);

          const ret = await facade.exactBorrowOutForMinCollateralIn(
            borrowAmount,
            healthFactor18,
            liquidationThreshold18,
            {priceCollateral, priceBorrow, rc10powDec, rb10powDec},
            true
          );
          console.log("ret", ret);

          const expected = borrowAmount
            .mul(healthFactor18)
            .mul(rc10powDec)
            .mul(priceBorrow)
            .div(liquidationThreshold18)
            .div(priceCollateral)
            .div(rb10powDec);
          console.log("expected", expected);

          // 1700/0.85*2/10*0.5 = 200 mln
          expect(ret.eq(expected)).eq(true);
        });
      });
      describe("Reverse to exactCollateralInForMaxBorrowOut", () => {
        it("should return expected values", async () => {
          const collateralAmount = parseUnits("1400", 14);
          const healthFactor18 = parseUnits("2", 18);
          const liquidationThreshold18 = parseUnits("0.85", 18);
          const priceCollateral = parseUnits("10", 18);
          const priceBorrow = parseUnits("0.5", 18);
          const rc10powDec = parseUnits("1", 14);
          const rb10powDec = parseUnits("1", 27);
          const amountToBorrowOut = await facade.exactCollateralInForMaxBorrowOut(
            collateralAmount,
            healthFactor18,
            liquidationThreshold18,
            {priceCollateral, priceBorrow, rc10powDec, rb10powDec},
            false
          );
          console.log("amountToBorrowOut", amountToBorrowOut);
          const ret = await facade.exactBorrowOutForMinCollateralIn(
            amountToBorrowOut,
            healthFactor18,
            liquidationThreshold18,
            {priceCollateral, priceBorrow, rc10powDec, rb10powDec},
            false
          );
          console.log("ret", ret);

          expect(ret.eq(collateralAmount)).eq(true);
        });
      });
    });
    describe("Gas estimation @skip-on-coverage", () => {
      it("should not exceed gas limits", async () => {
        const gasUsed = await facade.estimateGas.exactBorrowOutForMinCollateralIn(
          parseUnits("1700", 14),
          parseUnits("2", 18),
          parseUnits("0.85", 18),
          {
            priceCollateral: parseUnits("10", 18),
            priceBorrow: parseUnits("0.5", 18),
            rc10powDec: parseUnits("1", 14),
            rb10powDec: parseUnits("1", 27)
          },
          false
        );
        controlGasLimitsEx(gasUsed, GAS_LIMIT_ENTRY_KINDS_EXACT_BORROW_OUT_FOR_MIN_COLLATERAL_IN, (u, t) => {
          expect(u).to.be.below(t);
        });
      });
    });
  });

  describe("exactProportion", () => {
    describe("Good paths", () => {
      describe("Price decimals = 18, equal proportions", () => {
        it("should return expected values, prices and decimals are equal", async () => {
          const collateralAmount = parseUnits("1000", 18);
          const healthFactor18 = parseUnits("2", 18);
          const liquidationThreshold18 = parseUnits("0.5", 18);
          const priceCollateral = parseUnits("1", 18);
          const priceBorrow = parseUnits("1", 18);
          const rc10powDec = parseUnits("1", 18);
          const rb10powDec = parseUnits("1", 18);
          const partX = 5; // proportions ..
          const partY = 5; // ... 1:1
          const r = await facade.exactProportion(
            collateralAmount,
            healthFactor18,
            liquidationThreshold18,
            {priceCollateral, priceBorrow, rc10powDec, rb10powDec},
            defaultAbiCoder.encode(
              ["uint256", "uint256", "uint256"],
              [1, partX, partY] // ENTRY_KIND_EXACT_PROPORTION_1
            ),
            false
          );
          const ret = [
            r.collateralAmountOut,
            r.amountToBorrowOut
          ].map(x => BalanceUtils.toString(x)).join("\n");

          // 1000 => 200 + 800, 800 is converted to 200
          const expected = [
            parseUnits("800", 18),
            parseUnits("200", 18)
          ].map(x => BalanceUtils.toString(x)).join("\n");
          expect(ret).eq(expected);
        });
        it("should return expected values, prices are equal, decimals are different", async () => {
          const collateralAmount = parseUnits("1000", 7);
          const healthFactor18 = parseUnits("2", 18);
          const liquidationThreshold18 = parseUnits("0.5", 18);
          const priceCollateral = parseUnits("1", 18);
          const priceBorrow = parseUnits("1", 18);
          const rc10powDec = parseUnits("1", 7);
          const rb10powDec = parseUnits("1", 23);
          const partX = 1; // proportions ..
          const partY = 1; // ... 1:1
          const r = await facade.exactProportion(
            collateralAmount,
            healthFactor18,
            liquidationThreshold18,
            {priceCollateral, priceBorrow, rc10powDec, rb10powDec},
            defaultAbiCoder.encode(
              ["uint256", "uint256", "uint256"],
              [1, partX, partY] // ENTRY_KIND_EXACT_PROPORTION_1
            ),
            false
          );
          const ret = [
            r.collateralAmountOut,
            r.amountToBorrowOut
          ].map(x => BalanceUtils.toString(x)).join("\n");

          // 1000 => 200 + 800, 800 is converted to 200
          const expected = [
            parseUnits("800", 7),
            parseUnits("200", 23)
          ].map(x => BalanceUtils.toString(x)).join("\n");
          expect(ret).eq(expected);
        });
        it("should return expected values, prices are different, decimals are equal", async () => {
          const collateralAmount = parseUnits("1000", 18);
          const healthFactor18 = parseUnits("2", 18);
          const liquidationThreshold18 = parseUnits("0.5", 18);
          const priceCollateral = parseUnits("2", 18);
          const priceBorrow = parseUnits("0.5", 18);
          const rc10powDec = parseUnits("1", 18);
          const rb10powDec = parseUnits("1", 18);
          const partX = 1; // proportions ..
          const partY = 1; // ... 1:1
          const r = await facade.exactProportion(
            collateralAmount,
            healthFactor18,
            liquidationThreshold18,
            {priceCollateral, priceBorrow, rc10powDec, rb10powDec},
            defaultAbiCoder.encode(
              ["uint256", "uint256", "uint256"],
              [1, partX, partY] // ENTRY_KIND_EXACT_PROPORTION_1
            ),
            false
          );
          const ret = [
            r.collateralAmountOut,
            r.amountToBorrowOut
          ].map(x => BalanceUtils.toString(x)).join("\n");

          // 1000 => 200 + 800, 800 is converted to 200*4
          const expected = [
            parseUnits("800", 18),
            parseUnits("800", 18)
          ].map(x => BalanceUtils.toString(x)).join("\n");
          expect(ret).eq(expected);
        });
      });
      describe("Price decimals = 18, not equal proportions", () => {
        it("should return expected values, prices and decimals are equal", async () => {
          const collateralAmount = parseUnits("1000", 18);
          const healthFactor18 = parseUnits("2", 18);
          const liquidationThreshold18 = parseUnits("1", 18); // 1 is for simplicity here
          const priceCollateral = parseUnits("1", 18);
          const priceBorrow = parseUnits("1", 18);
          const rc10powDec = parseUnits("1", 18);
          const rb10powDec = parseUnits("1", 18);
          const partX = 2; // proportions ..
          const partY = 1; // ... 2:1
          const r = await facade.exactProportion(
            collateralAmount,
            healthFactor18,
            liquidationThreshold18,
            {priceCollateral, priceBorrow, rc10powDec, rb10powDec},
            defaultAbiCoder.encode(
              ["uint256", "uint256", "uint256"],
              [1, partX, partY] // ENTRY_KIND_EXACT_PROPORTION_1
            ),
            false
          );
          const ret = [
            r.collateralAmountOut,
            r.amountToBorrowOut
          ].map(x => BalanceUtils.toString(x)).join("\n");

          // 1000 => 500 + 500, 500 is converted to 250, 500:250 = 2:1
          const expected = [
            parseUnits("500", 18),
            parseUnits("250", 18)
          ].map(x => BalanceUtils.toString(x)).join("\n");
          expect(ret).eq(expected);
        });
        it("should return expected values, prices and decimals are different", async () => {
          const collateralAmount = parseUnits("1000", 7);
          const healthFactor18 = parseUnits("2", 18);
          const liquidationThreshold18 = parseUnits("0.5", 18);
          const priceCollateral = parseUnits("2", 18);
          const priceBorrow = parseUnits("1", 18);
          const rc10powDec = parseUnits("1", 7);
          const rb10powDec = parseUnits("1", 9);
          const partX = 100; // proportions ..
          const partY = 225; // ... 1:2.25
          const r = await facade.exactProportion(
            collateralAmount,
            healthFactor18,
            liquidationThreshold18,
            {priceCollateral, priceBorrow, rc10powDec, rb10powDec},
            defaultAbiCoder.encode(
              ["uint256", "uint256", "uint256"],
              [1, partX, partY] // ENTRY_KIND_EXACT_PROPORTION_1
            ),
            false
          );
          const ret = [
            r.collateralAmountOut,
            r.amountToBorrowOut
          ].map(x => BalanceUtils.toString(x)).join("\n");

          // 1000 => 100 + 900, 900 is converted to 225*2
          // we will have proportion 100:225 in USD
          const expected = [
            parseUnits("900", 7),
            parseUnits("450", 9)
          ].map(x => BalanceUtils.toString(x)).join("\n");
          expect(ret).eq(expected);
        });
      });
      describe("Price decimals = 36", () => {
        it("should return expected values", async () => {
          // $200 mln
          const collateralAmount = parseUnits("200", 18+6);
          const healthFactor18 = parseUnits("2", 18);
          const liquidationThreshold18 = parseUnits("0.85", 18);
          const priceCollateral = parseUnits("10", 36);
          const priceBorrow = parseUnits("0.5", 36);
          const rc10powDec = parseUnits("1", 18);
          const rb10powDec = parseUnits("1", 18);
          const ret = await facade.exactCollateralInForMaxBorrowOut(
            collateralAmount,
            healthFactor18,
            liquidationThreshold18,
            {priceCollateral, priceBorrow, rc10powDec, rb10powDec},
            true // it will revert if false
          );
          const expected = Misc.WEI.mul(collateralAmount).div(healthFactor18)
            .mul(liquidationThreshold18).mul(priceCollateral).div(priceBorrow)
            .mul(rb10powDec).div(Misc.WEI).div(rc10powDec);
          console.log("expected", expected);

          // 200*0.85/2*10/0.5 = 1700 mln
          expect(ret.eq(expected)).eq(true);
        });
      });
    });
    describe("Gas estimation @skip-on-coverage", () => {
      it("should not exceed gas limits", async () => {
        const collateralAmount = parseUnits("1000", 7);
        const healthFactor18 = parseUnits("2", 18);
        const liquidationThreshold18 = parseUnits("0.5", 18);
        const priceCollateral = parseUnits("2", 18);
        const priceBorrow = parseUnits("1", 18);
        const rc10powDec = parseUnits("1", 7);
        const rb10powDec = parseUnits("1", 9);
        const partX = 100; // proportions ..
        const partY = 225; // ... 1:2.25
        const gasUsed = await facade.estimateGas.exactProportion(
          collateralAmount,
          healthFactor18,
          liquidationThreshold18,
          {priceCollateral, priceBorrow, rc10powDec, rb10powDec},
          defaultAbiCoder.encode(
            ["uint256", "uint256", "uint256"],
            [1, partX, partY] // ENTRY_KIND_EXACT_PROPORTION_1
          ),
          false
        );
        controlGasLimitsEx(gasUsed, GAS_LIMIT_ENTRY_KINDS_EXACT_PROPORTIONS, (u, t) => {
          expect(u).to.be.below(t);
        });
      });
    });
  });

  describe("getCollateralAmountToConvert", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        const collateralAmount = parseUnits("1000", 7);
        const healthFactor18 = parseUnits("2", 18);
        const liquidationThreshold18 = parseUnits("0.2", 18);

        const partX = 6; // proportions ..
        const partY = 1; // ... 6:1
        const ret = await facade.getCollateralAmountToConvert(
          defaultAbiCoder.encode(
            ["uint256", "uint256", "uint256"],
            [1, partX, partY] // ENTRY_KIND_EXACT_PROPORTION_1
          ),
          collateralAmount,
          healthFactor18,
          liquidationThreshold18
        );
        // C2' = C' / (1 + a), a = (X * LT)/(HF * Y)
        // a = (6 * 0.2) / (2 * 1) = 0.6
        // C2' = 1000  / (1 + 0.6) = 625
        const expected = parseUnits("625", 7);
        expect(ret).eq(expected);
      });
    });
    describe("Bad paths", () => {
      it("should revert if x == 0", async () => {
        const collateralAmount = parseUnits("1000", 7);
        const healthFactor18 = parseUnits("2", 18);
        const liquidationThreshold18 = parseUnits("0.2", 18);

        const partX = 0; // (!)
        const partY = 1;
        await expect(
          facade.getCollateralAmountToConvert(
          defaultAbiCoder.encode(
            ["uint256", "uint256", "uint256"],
            [1, partX, partY] // ENTRY_KIND_EXACT_PROPORTION_1
          ),
          collateralAmount,
          healthFactor18,
          liquidationThreshold18
        )).revertedWith("TC-56 zero not allowed"); // ZERO_VALUE_NOT_ALLOWED
      });

      it("should revert if y == 0", async () => {
        const collateralAmount = parseUnits("1000", 7);
        const healthFactor18 = parseUnits("2", 18);
        const liquidationThreshold18 = parseUnits("0.2", 18);

        const partX = 1; // (!)
        const partY = 0;
        await expect(
          facade.getCollateralAmountToConvert(
            defaultAbiCoder.encode(
              ["uint256", "uint256", "uint256"],
              [1, partX, partY] // ENTRY_KIND_EXACT_PROPORTION_1
            ),
            collateralAmount,
            healthFactor18,
            liquidationThreshold18
          )).revertedWith("TC-56 zero not allowed"); // ZERO_VALUE_NOT_ALLOWED
      });
    });
  });
//endregion Unit tests
});