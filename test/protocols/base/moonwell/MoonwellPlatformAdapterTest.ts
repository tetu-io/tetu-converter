import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BASE_NETWORK_ID, HardhatUtils} from "../../../../scripts/utils/HardhatUtils";
import {BaseAddresses} from "../../../../scripts/addresses/BaseAddresses";
import {
  CompoundLibFacade,
  IMToken__factory,
  IERC20Metadata,
  IERC20Metadata__factory,
  IMToken,
  ConverterController
} from "../../../../typechain";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {DeployUtils} from "../../../../scripts/utils/DeployUtils";
import {ethers} from "hardhat";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {AdaptersHelper} from "../../../baseUT/app/AdaptersHelper";
import {Misc} from "../../../../scripts/utils/Misc";
import {expect} from "chai";
import {TetuConverterApp} from "../../../baseUT/app/TetuConverterApp";

describe("MoonwellPlatformAdapterTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let signer: SignerWithAddress;
  let facade: CompoundLibFacade;
  let usdc: IERC20Metadata;
  let cbEth: IERC20Metadata;
  let dai: IERC20Metadata;
  let weth: IERC20Metadata;

  let cUsdc: IMToken;
  let cCbEth: IMToken;
  let cDai: IMToken;
  let cWeth: IMToken;

  let converterController: ConverterController;

//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(BASE_NETWORK_ID);
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    signer = signers[0];
    facade = await DeployUtils.deployContract(signer, "CompoundLibFacade") as CompoundLibFacade;

    usdc = IERC20Metadata__factory.connect(BaseAddresses.USDC, signer);
    cbEth = IERC20Metadata__factory.connect(BaseAddresses.cbETH, signer);
    dai = IERC20Metadata__factory.connect(BaseAddresses.DAI, signer);
    weth = IERC20Metadata__factory.connect(BaseAddresses.WETH, signer);

    cUsdc = IMToken__factory.connect(BaseAddresses.MOONWELL_USDC, signer);
    cCbEth = IMToken__factory.connect(BaseAddresses.MOONWELL_CBETH, signer);
    cDai = IMToken__factory.connect(BaseAddresses.MOONWELL_DAI, signer);
    cWeth = IMToken__factory.connect(BaseAddresses.MOONWELL_WETH, signer);

    converterController  = await TetuConverterApp.createController(signer,);
  });

  after(async function () {
    await TimeUtils.rollback(snapshot);
  });

//endregion before, after

//region Unit tests

  describe("constructor and converters()", () => {
    interface IParams {
      cTokens?: string[]; // [cUsdc, cDai] by default

      zeroController?: boolean;
      zeroConverter?: boolean;
      zeroComptroller?: boolean;

      assetsToCheck?: string[]; // [usdc, dai] by default
    }
    interface IResults {
      templateAdapterNormalStub: string;

      controller: string;
      comptroller: string;
      converters: string[];
      checkedAssets: string[];
    }
    async function initializePlatformAdapter(p: IParams) : Promise<IResults> {
      const templateAdapterNormalStub = ethers.Wallet.createRandom();
      const cTokens = p.cTokens ?? [BaseAddresses.MOONWELL_USDC, BaseAddresses.MOONWELL_DAI];

      const platformAdapter = await AdaptersHelper.createMoonwellPlatformAdapter(
        signer,
        p?.zeroController ? Misc.ZERO_ADDRESS : converterController.address,
        p?.zeroComptroller ? Misc.ZERO_ADDRESS : BaseAddresses.MOONWELL_COMPTROLLER,
        p?.zeroConverter ? Misc.ZERO_ADDRESS : templateAdapterNormalStub.address,
        cTokens,
      );

      return {
        templateAdapterNormalStub: templateAdapterNormalStub.address,
        controller: await platformAdapter.controller(),
        comptroller: await platformAdapter.comptroller(),
        converters: await platformAdapter.converters(),
        checkedAssets: await Promise.all((p.assetsToCheck ?? [BaseAddresses.USDC, BaseAddresses.DAI]).map(
          async x =>  platformAdapter.activeAssets(x)
        ))
      };
    }
    describe("Good paths", () => {
      describe("Normal case", () => {
        async function initializePlatformAdapterTest(): Promise<IResults> {
          return initializePlatformAdapter({
            cTokens: [BaseAddresses.MOONWELL_USDC, BaseAddresses.MOONWELL_WETH, BaseAddresses.MOONWELL_DAI],
            assetsToCheck: [BaseAddresses.USDC, BaseAddresses.WETH, BaseAddresses.cbETH, BaseAddresses.DAI]
          })
        }
        it("should return expected controller and comptroller", async () => {
          const r = await loadFixture(initializePlatformAdapterTest);
          expect(
            [r.controller, r.comptroller].join().toLowerCase()
          ).eq(
            [converterController.address, BaseAddresses.MOONWELL_COMPTROLLER].join().toLowerCase()
          );
        });
        it("should return expected converters", async () => {
          const r = await loadFixture(initializePlatformAdapterTest);
          expect(r.converters.join()).eq([r.templateAdapterNormalStub].join());
        });
        it("should return expected active assets", async () => {
          const r = await loadFixture(initializePlatformAdapterTest);
          expect(
            r.checkedAssets.join().toLowerCase()
          ).eq(
            [BaseAddresses.MOONWELL_USDC, BaseAddresses.MOONWELL_WETH, Misc.ZERO_ADDRESS, BaseAddresses.MOONWELL_DAI].join().toLowerCase()
          );
        });
      });
    });
    describe("Bad paths", () => {
      it("should revert if aave-pool is zero", async () => {
        await expect(
          initializePlatformAdapter({zeroComptroller: true})
        ).revertedWith("TC-1 zero address");
      });
      it("should revert if controller is zero", async () => {
        await expect(
          initializePlatformAdapter({zeroController: true})
        ).revertedWith("TC-1 zero address");
      });
      it("should revert if template normal is zero", async () => {
        await expect(
          initializePlatformAdapter({zeroConverter: true})
        ).revertedWith("TC-1 zero address");
      });
    });
  });

  // describe("getConversionPlan", () => {
  //   let controller: ConverterController;
  //   let snapshotLocal: string;
  //   before(async function () {
  //     snapshotLocal = await TimeUtils.snapshot();
  //     controller = await TetuConverterApp.createController(deployer,
  //       {tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
  //     );
  //   });
  //   after(async function () {
  //     await TimeUtils.rollback(snapshotLocal);
  //   });
  //   describe("Good paths", () => {
  //     describe("DAI : usdc", () => {
  //       it("should return expected values", async () => {
  //         const collateralAsset = MaticAddresses.DAI;
  //         const collateralCToken = MaticAddresses.hDAI;
  //         const collateralAmount = getBigNumberFrom(1000, 18);
  //
  //         const borrowAsset = MaticAddresses.USDC;
  //         const borrowCToken = MaticAddresses.hUSDC;
  //
  //         const r = await makeTestComparePlanWithDirectCalculations(
  //           controller,
  //           collateralAsset,
  //           collateralAmount,
  //           borrowAsset,
  //           collateralCToken,
  //           borrowCToken
  //         );
  //
  //         expect(r.sret).eq(r.sexpected);
  //       });
  //     });
  //     describe("WMATIC : USDC", () => {
  //       it("should return expected values", async () => {
  //         const collateralAsset = MaticAddresses.WMATIC;
  //         const collateralCToken = MaticAddresses.hMATIC;
  //         const collateralAmount = getBigNumberFrom(1000, 18);
  //
  //         const borrowAsset = MaticAddresses.USDC;
  //         const borrowCToken = MaticAddresses.hUSDC;
  //
  //         const r = await makeTestComparePlanWithDirectCalculations(
  //           controller,
  //           collateralAsset,
  //           collateralAmount,
  //           borrowAsset,
  //           collateralCToken,
  //           borrowCToken
  //         );
  //         console.log(r);
  //
  //         expect(r.sret).eq(r.sexpected);
  //       });
  //     });
  //     describe("USDC : WETH", () => {
  //       it("should return expected values", async () => {
  //         const collateralAsset = MaticAddresses.WMATIC;
  //         const collateralCToken = MaticAddresses.hMATIC;
  //         const collateralAmount = getBigNumberFrom(10, 18);
  //
  //         const borrowAsset = MaticAddresses.WETH;
  //         const borrowCToken = MaticAddresses.hETH;
  //
  //         const r = await makeTestComparePlanWithDirectCalculations(
  //           controller,
  //           collateralAsset,
  //           collateralAmount,
  //           borrowAsset,
  //           collateralCToken,
  //           borrowCToken
  //         );
  //         console.log(r);
  //
  //         expect(r.sret).eq(r.sexpected);
  //       });
  //     });
  //     describe("Try to use huge collateral amount", () => {
  //       it("should return borrow amount equal to max available amount", async () => {
  //         const r = await preparePlan(
  //           controller,
  //           MaticAddresses.DAI,
  //           parseUnits("1", 28),
  //           MaticAddresses.WMATIC,
  //           MaticAddresses.hDAI,
  //           MaticAddresses.hMATIC,
  //         );
  //         expect(r.plan.amountToBorrow).eq(r.plan.maxAmountToBorrow);
  //       });
  //     });
  //     describe("Borrow capacity", () => {
  //       /**
  //        *      totalBorrows    <    borrowCap       <       totalBorrows + available cash
  //        */
  //       it("maxAmountToBorrow is equal to borrowCap - totalBorrows", async () => {
  //         const r = await preparePlan(
  //           controller,
  //           MaticAddresses.DAI,
  //           parseUnits("1", 18),
  //           MaticAddresses.WMATIC,
  //           MaticAddresses.hDAI,
  //           MaticAddresses.hMATIC,
  //           { setMinBorrowCapacityDelta: parseUnits("7", 18) }
  //         );
  //         expect(r.plan.maxAmountToBorrow.eq(parseUnits("7", 18))).eq(true);
  //       });
  //
  //       /**
  //        *      totalBorrows    <     totalBorrows + available cash    <     borrowCap
  //        */
  //       it("maxAmountToBorrow is equal to available cash if borrowCap is huge", async () => {
  //         const r = await preparePlan(
  //           controller,
  //           MaticAddresses.DAI,
  //           parseUnits("1", 18),
  //           MaticAddresses.WMATIC,
  //           MaticAddresses.hDAI,
  //           MaticAddresses.hMATIC,
  //           { setMinBorrowCapacityDelta: parseUnits("7", 48) }
  //         );
  //         const availableCash = await IHfCToken__factory.connect(MaticAddresses.hMATIC, deployer).getCash();
  //         console.log("availableCash", availableCash);
  //         console.log("maxAmountToBorrow", r.plan.maxAmountToBorrow);
  //         expect(r.plan.maxAmountToBorrow.eq(availableCash)).eq(true);
  //       });
  //
  //       /**
  //        *      borrowCap   <     totalBorrows    <   totalBorrows + available cash
  //        */
  //       it("maxAmountToBorrow is zero if borrow capacity is exceeded", async () => {
  //         const r = await preparePlan(
  //           controller,
  //           MaticAddresses.DAI,
  //           parseUnits("1", 18),
  //           MaticAddresses.WMATIC,
  //           MaticAddresses.hDAI,
  //           MaticAddresses.hMATIC,
  //           { setBorrowCapacityExceeded: true }
  //         );
  //         expect(r.plan.maxAmountToBorrow.eq(0)).eq(true);
  //       });
  //     });
  //     describe("Frozen", () => {
  //       it("should return no plan", async () => {
  //
  //         const r = await preparePlan(
  //           controller,
  //           MaticAddresses.DAI,
  //           parseUnits("1", 18),
  //           MaticAddresses.WMATIC,
  //           MaticAddresses.hDAI,
  //           MaticAddresses.hMATIC,
  //           {
  //             frozen: true
  //           }
  //         );
  //         expect(r.plan.converter).eq(Misc.ZERO_ADDRESS);
  //       });
  //     });
  //     describe("EntryKinds", () => {
  //       describe("Use ENTRY_KIND_EXACT_COLLATERAL_IN_FOR_MAX_BORROW_OUT_0", () => {
  //         it("should return not zero borrow amount", async () => {
  //           const collateralAmount = parseUnits("6338.199834", 6);
  //
  //           const r = await preparePlan(
  //             controller,
  //             MaticAddresses.USDC,
  //             collateralAmount,
  //             MaticAddresses.DAI,
  //             MaticAddresses.hUSDC,
  //             MaticAddresses.hDAI,
  //             undefined,
  //             defaultAbiCoder.encode(["uint256"], [AppConstants.ENTRY_KIND_0])
  //           );
  //           console.log("plan", r.plan);
  //           console.log("amountToBorrow, collateralAmount", r.plan.amountToBorrow, r.plan.collateralAmount);
  //
  //           expect(r.plan.amountToBorrow.gt(0)).eq(true);
  //         });
  //       });
  //       describe("Use ENTRY_KIND_EXACT_PROPORTION_1", () => {
  //         it("should split source amount on the parts with almost same cost", async () => {
  //           const collateralAmount = parseUnits("1000", 18);
  //
  //           const r = await preparePlan(
  //             controller,
  //             MaticAddresses.DAI,
  //             collateralAmount,
  //             MaticAddresses.WMATIC,
  //             MaticAddresses.hDAI,
  //             MaticAddresses.hMATIC,
  //             undefined,
  //             defaultAbiCoder.encode(
  //               ["uint256", "uint256", "uint256"],
  //               [AppConstants.ENTRY_KIND_1, 1, 1]
  //             )
  //           );
  //
  //           const sourceAssetUSD = +formatUnits(
  //             collateralAmount.sub(r.plan.collateralAmount).mul(r.priceCollateral),
  //             r.collateralAssetDecimals
  //           );
  //           const targetAssetUSD = +formatUnits(
  //             r.plan.amountToBorrow.mul(r.priceBorrow),
  //             r.borrowAssetDecimals
  //           );
  //
  //           const ret = [
  //             sourceAssetUSD === targetAssetUSD,
  //             r.plan.collateralAmount.lt(collateralAmount)
  //           ].join();
  //           const expected = [true, true].join();
  //
  //           console.log("sourceAssetUSD", sourceAssetUSD);
  //           console.log("targetAssetUSD", targetAssetUSD);
  //
  //           expect(ret).eq(expected);
  //         });
  //       });
  //       describe("Use ENTRY_KIND_EXACT_BORROW_OUT_FOR_MIN_COLLATERAL_IN_2", () => {
  //         it("should return expected collateral amount", async () => {
  //
  //           // let's calculate borrow amount by known collateral amount
  //           const collateralAmount = parseUnits("10", 18);
  //           const d = await preparePlan(
  //             controller,
  //             MaticAddresses.DAI,
  //             collateralAmount,
  //             MaticAddresses.WMATIC,
  //             MaticAddresses.hDAI,
  //             MaticAddresses.hMATIC,
  //           );
  //           const borrowAmount = AprUtils.getBorrowAmount(
  //             collateralAmount,
  //             d.healthFactor2,
  //             d.plan.liquidationThreshold18,
  //             d.priceCollateral,
  //             d.priceBorrow,
  //             d.collateralAssetDecimals,
  //             d.borrowAssetDecimals
  //           );
  //
  //           const r = await preparePlan(
  //             controller,
  //             MaticAddresses.DAI,
  //             borrowAmount,
  //             MaticAddresses.WMATIC,
  //             MaticAddresses.hDAI,
  //             MaticAddresses.hMATIC,
  //             undefined,
  //             defaultAbiCoder.encode(["uint256"], [AppConstants.ENTRY_KIND_2])
  //           );
  //
  //           const ret = [
  //             r.plan.amountToBorrow,
  //             areAlmostEqual(r.plan.collateralAmount, collateralAmount)
  //           ].map(x => BalanceUtils.toString(x)).join("\n");
  //
  //           const expected = [
  //             borrowAmount,
  //             true
  //           ].map(x => BalanceUtils.toString(x)).join("\n");
  //           console.log(d.plan);
  //           console.log(r.plan);
  //
  //           expect(ret).eq(expected);
  //         });
  //       });
  //     });
  //     describe("Collateral and borrow amounts fit to limits", () => {
  //       /**
  //        * maxAmountToSupply is always equal to type(uint).max
  //        */
  //       describe.skip("Allowed collateral exceeds available collateral", () => {
  //         it("should return expected borrow and collateral amounts", async () => {
  //           // let's get max available supply amount
  //           const sample = await preparePlan(
  //             controller,
  //             MaticAddresses.DAI,
  //             parseUnits("1", 18),
  //             MaticAddresses.WMATIC,
  //             MaticAddresses.hDAI,
  //             MaticAddresses.hMATIC,
  //             undefined,
  //             defaultAbiCoder.encode(["uint256"], [AppConstants.ENTRY_KIND_0])
  //           );
  //
  //           // let's try to borrow amount using collateral that exceeds max supply amount
  //           const r = await preparePlan(
  //             controller,
  //             MaticAddresses.DAI,
  //             sample.plan.maxAmountToSupply.add(1000),
  //             MaticAddresses.WMATIC,
  //             MaticAddresses.hDAI,
  //             MaticAddresses.hMATIC,
  //             undefined,
  //             defaultAbiCoder.encode(["uint256"], [AppConstants.ENTRY_KIND_0])
  //           );
  //           console.log(r.plan);
  //
  //           const expectedCollateralAmount = AprUtils.getCollateralAmount(
  //             r.plan.amountToBorrow,
  //             r.healthFactor2,
  //             r.plan.liquidationThreshold18,
  //             r.priceCollateral,
  //             r.priceBorrow,
  //             r.collateralAssetDecimals,
  //             r.borrowAssetDecimals
  //           );
  //
  //           const ret = [
  //             r.plan.amountToBorrow,
  //             areAlmostEqual(r.plan.collateralAmount, expectedCollateralAmount)
  //           ].map(x => BalanceUtils.toString(x)).join("\n");
  //           const expected = [
  //             r.plan.maxAmountToBorrow,
  //             true
  //           ].map(x => BalanceUtils.toString(x)).join("\n");
  //
  //           expect(ret).eq(expected);
  //         });
  //       });
  //       describe("Allowed borrow amounts exceeds available borrow amount", () => {
  //         it("should return expected borrow and collateral amounts", async () => {
  //           // let's get max available borrow amount
  //           const sample = await preparePlan(
  //             controller,
  //             MaticAddresses.DAI,
  //             parseUnits("1", 18),
  //             MaticAddresses.WMATIC,
  //             MaticAddresses.hDAI,
  //             MaticAddresses.hMATIC,
  //             undefined,
  //             defaultAbiCoder.encode(["uint256"], [AppConstants.ENTRY_KIND_0])
  //           );
  //
  //           // let's try to borrow amount using collateral that exceeds max supply amount
  //           const r = await preparePlan(
  //             controller,
  //             MaticAddresses.DAI,
  //             sample.plan.maxAmountToBorrow.add(1000),
  //             MaticAddresses.WMATIC,
  //             MaticAddresses.hDAI,
  //             MaticAddresses.hMATIC,
  //             undefined,
  //             defaultAbiCoder.encode(["uint256"], [AppConstants.ENTRY_KIND_2])
  //           );
  //           console.log(r.plan);
  //
  //           const expectedCollateralAmount = AprUtils.getCollateralAmount(
  //             sample.plan.maxAmountToBorrow,
  //             r.healthFactor2,
  //             r.plan.liquidationThreshold18,
  //             r.priceCollateral,
  //             r.priceBorrow,
  //             r.collateralAssetDecimals,
  //             r.borrowAssetDecimals,
  //           );
  //
  //           const ret = [
  //             r.plan.amountToBorrow,
  //             areAlmostEqual(r.plan.collateralAmount, expectedCollateralAmount)
  //           ].map(x => BalanceUtils.toString(x)).join("\n");
  //           const expected = [
  //             r.plan.maxAmountToBorrow,
  //             true
  //           ].map(x => BalanceUtils.toString(x)).join("\n");
  //
  //           expect(ret).eq(expected);
  //         });
  //       });
  //     });
  //   });
  //   describe("Bad paths", () => {
  //     async function tryGetConversionPlan(
  //       badPathsParams: IGetConversionPlanBadPaths,
  //       collateralAsset: string = MaticAddresses.DAI,
  //       borrowAsset: string = MaticAddresses.USDC,
  //       collateralCToken: string = MaticAddresses.hDAI,
  //       borrowCToken: string = MaticAddresses.hUSDC,
  //       collateralAmount: BigNumber = getBigNumberFrom(1000, 18)
  //     ) : Promise<IConversionPlan> {
  //       return (await preparePlan(
  //         controller,
  //         collateralAsset,
  //         collateralAmount,
  //         borrowAsset,
  //         collateralCToken,
  //         borrowCToken,
  //         badPathsParams
  //       )).plan;
  //     }
  //     describe("incorrect input params", () => {
  //       describe("collateral token is zero", () => {
  //         it("should revert", async () => {
  //
  //           await expect(
  //             tryGetConversionPlan({ zeroCollateralAsset: true })
  //           ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
  //         });
  //       });
  //       describe("borrow token is zero", () => {
  //         it("should revert", async () => {
  //           await expect(
  //             tryGetConversionPlan({ zeroBorrowAsset: true })
  //           ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
  //         });
  //       });
  //       describe("healthFactor2_ is less than min allowed", () => {
  //         it("should revert", async () => {
  //           await expect(
  //             tryGetConversionPlan({ incorrectHealthFactor2: 100 })
  //           ).revertedWith("TC-3 wrong health factor"); // WRONG_HEALTH_FACTOR
  //         });
  //       });
  //       describe("countBlocks_ is zero", () => {
  //         it("should revert", async () => {
  //           await expect(
  //             tryGetConversionPlan({ zeroCountBlocks: true })
  //           ).revertedWith("TC-29 incorrect value"); // INCORRECT_VALUE
  //         });
  //       });
  //       describe("collateralAmount_ is zero", () => {
  //         it("should revert", async () => {
  //           await expect(
  //             tryGetConversionPlan({ zeroCollateralAmount: true })
  //           ).revertedWith("TC-29 incorrect value"); // INCORRECT_VALUE
  //         });
  //       });
  //     });
  //     describe("cToken is not registered", () => {
  //       it("should fail if collateral token is not registered", async () => {
  //         expect((await tryGetConversionPlan(
  //           {},
  //           MaticAddresses.agEUR
  //         )).converter).eq(Misc.ZERO_ADDRESS);
  //       });
  //       it("should fail if borrow token is not registered", async () => {
  //
  //         expect((await tryGetConversionPlan(
  //           {},
  //           MaticAddresses.DAI,
  //           MaticAddresses.agEUR,
  //         )).converter).eq(Misc.ZERO_ADDRESS);
  //       });
  //     });
  //     describe("capacity", () => {
  //       it("should return expected maxAmountToBorrow if borrowCapacity is limited", async () => {
  //         const planBorrowCapacityNotLimited = await tryGetConversionPlan(
  //           {},
  //           MaticAddresses.DAI,
  //           MaticAddresses.USDC,
  //           MaticAddresses.hDAI,
  //           MaticAddresses.hUSDC,
  //           getBigNumberFrom(12345, 18)
  //         );
  //         console.log("planBorrowCapacityNotLimited", planBorrowCapacityNotLimited);
  //         const plan = await tryGetConversionPlan(
  //           {setMinBorrowCapacity: true},
  //           MaticAddresses.DAI,
  //           MaticAddresses.USDC,
  //           MaticAddresses.hDAI,
  //           MaticAddresses.hUSDC,
  //           getBigNumberFrom(12345, 18)
  //         );
  //         console.log("plan", plan);
  //         const ret = [
  //           plan.amountToBorrow.eq(plan.maxAmountToBorrow),
  //           plan.amountToBorrow.lt(planBorrowCapacityNotLimited.maxAmountToBorrow),
  //           planBorrowCapacityNotLimited.amountToBorrow.lt(planBorrowCapacityNotLimited.maxAmountToBorrow)
  //         ].join("\n");
  //         const expected = [true, true, true].join("\n");
  //         expect(ret).eq(expected);
  //       });
  //     });
  //     describe("paused", () => {
  //       it("should fail if mintPaused is true for collateral", async () => {
  //         expect((await tryGetConversionPlan({setCollateralMintPaused: true})).converter).eq(Misc.ZERO_ADDRESS);
  //       });
  //       it("should fail if borrowPaused for borrow", async () => {
  //         expect((await tryGetConversionPlan({setBorrowPaused: true})).converter).eq(Misc.ZERO_ADDRESS);
  //       });
  //     });
  //   });
  //   describe("Check gas limit @skip-on-coverage", () => {
  //     it("should not exceed gas limits @skip-on-coverage", async () => {
  //       const hfPlatformAdapter = await AdaptersHelper.createHundredFinancePlatformAdapter(
  //         deployer,
  //         controller.address,
  //         MaticAddresses.HUNDRED_FINANCE_COMPTROLLER,
  //         ethers.Wallet.createRandom().address,
  //         [MaticAddresses.hDAI, MaticAddresses.hUSDC],
  //       );
  //
  //       const gasUsed = await hfPlatformAdapter.estimateGas.getConversionPlan(
  //         {
  //           collateralAsset: MaticAddresses.DAI,
  //           amountIn: parseUnits("1", 18),
  //           borrowAsset: MaticAddresses.USDC,
  //           countBlocks: 1000,
  //           entryData: "0x",
  //           user: Misc.ZERO_ADDRESS
  //         },
  //         200,
  //         {gasLimit: GAS_LIMIT},
  //       );
  //       controlGasLimitsEx2(gasUsed, GAS_LIMIT_HUNDRED_FINANCE_GET_CONVERSION_PLAN, (u, t) => {
  //         expect(u).to.be.below(t);
  //       });
  //     });
  //   });
  // });
  //
  // describe("getBorrowRateAfterBorrow", () => {
  //   describe("Good paths", () => {
  //     async function makeTest(
  //       collateralAsset: string,
  //       collateralCToken: string,
  //       borrowAsset: string,
  //       borrowCToken: string,
  //       collateralHolders: string[],
  //       part10000: number
  //     ) : Promise<{br: BigNumber, brPredicted: BigNumber}> {
  //       const borrowToken = IHfCToken__factory.connect(borrowCToken, deployer);
  //       const collateralToken = IHfCToken__factory.connect(collateralCToken, deployer);
  //       const comptroller = await HundredFinanceHelper.getComptroller(deployer);
  //
  //       return PredictBrUsesCase.makeTest(
  //         deployer,
  //         new HfPlatformActor(borrowToken, collateralToken, comptroller),
  //         "hundred-finance",
  //         collateralAsset,
  //         borrowAsset,
  //         collateralHolders,
  //         part10000
  //       );
  //     }
  //
  //     describe("small amount", () => {
  //       it("Predicted borrow rate should be same to real rate after the borrow", async () => {
  //         const collateralAsset = MaticAddresses.DAI;
  //         const collateralCToken = MaticAddresses.hDAI;
  //         const borrowAsset = MaticAddresses.USDC;
  //         const borrowCToken = MaticAddresses.hUSDC;
  //
  //         const collateralHolders = [
  //           MaticAddresses.HOLDER_DAI,
  //           MaticAddresses.HOLDER_DAI_2,
  //           MaticAddresses.HOLDER_DAI_3,
  //           MaticAddresses.HOLDER_DAI_4,
  //           MaticAddresses.HOLDER_DAI_5,
  //           MaticAddresses.HOLDER_DAI_6,
  //         ];
  //         const part10000 = 1;
  //
  //         const r = await makeTest(
  //           collateralAsset,
  //           collateralCToken,
  //           borrowAsset,
  //           borrowCToken,
  //           collateralHolders,
  //           part10000
  //         );
  //
  //         const ret = areAlmostEqual(r.br, r.brPredicted, 3);
  //         expect(ret).eq(true);
  //       });
  //     });
  //
  //     describe("Huge amount", () => {
  //       it("Predicted borrow rate should be same to real rate after the borrow", async () => {
  //         const collateralAsset = MaticAddresses.DAI;
  //         const collateralCToken = MaticAddresses.hDAI;
  //         const borrowAsset = MaticAddresses.USDC;
  //         const borrowCToken = MaticAddresses.hUSDC;
  //
  //         const collateralHolders = [
  //           MaticAddresses.HOLDER_DAI,
  //           MaticAddresses.HOLDER_DAI_2,
  //           MaticAddresses.HOLDER_DAI_3,
  //           MaticAddresses.HOLDER_DAI_4,
  //           MaticAddresses.HOLDER_DAI_5,
  //           MaticAddresses.HOLDER_DAI_6,
  //         ];
  //         const part10000 = 500;
  //
  //         const r = await makeTest(
  //           collateralAsset,
  //           collateralCToken,
  //           borrowAsset,
  //           borrowCToken,
  //           collateralHolders,
  //           part10000
  //         );
  //
  //         const ret = areAlmostEqual(r.br, r.brPredicted, 3);
  //         expect(ret).eq(true);
  //       });
  //     });
  //   });
  // });
  //
  // describe("initializePoolAdapter", () => {
  //   let controller: ConverterController;
  //   let snapshotLocal: string;
  //   before(async function () {
  //     snapshotLocal = await TimeUtils.snapshot();
  //     controller = await TetuConverterApp.createController(deployer,
  //       {tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
  //     );
  //   });
  //   after(async function () {
  //     await TimeUtils.rollback(snapshotLocal);
  //   });
  //   interface IInitializePoolAdapterBadPaths {
  //     useWrongConverter?: boolean;
  //     wrongCallerOfInitializePoolAdapter?: boolean;
  //   }
  //   async function makeInitializePoolAdapterTest(
  //     badParams?: IInitializePoolAdapterBadPaths
  //   ) : Promise<{ret: string, expected: string}> {
  //     const user = ethers.Wallet.createRandom().address;
  //     const collateralAsset = MaticAddresses.DAI;
  //     const borrowAsset = MaticAddresses.USDC;
  //     const borrowManager = BorrowManager__factory.connect(await controller.borrowManager(), deployer);
  //     const converterNormal = await AdaptersHelper.createHundredFinancePoolAdapter(deployer);
  //
  //     const comptroller = await HundredFinanceHelper.getComptroller(deployer);
  //     const platformAdapter = await AdaptersHelper.createHundredFinancePlatformAdapter(
  //       deployer,
  //       controller.address,
  //       comptroller.address,
  //       converterNormal.address,
  //       [MaticAddresses.hDAI, MaticAddresses.hUSDC]
  //     );
  //
  //     const poolAdapter = await AdaptersHelper.createHundredFinancePoolAdapter(deployer)
  //     const platformAdapterAsBorrowManager = HfPlatformAdapter__factory.connect(
  //       platformAdapter.address,
  //       badParams?.wrongCallerOfInitializePoolAdapter
  //         ? await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address)
  //         : await DeployerUtils.startImpersonate(borrowManager.address)
  //     );
  //
  //     await platformAdapterAsBorrowManager.initializePoolAdapter(
  //       badParams?.useWrongConverter
  //         ? ethers.Wallet.createRandom().address
  //         : converterNormal.address,
  //       poolAdapter.address,
  //       user,
  //       collateralAsset,
  //       borrowAsset
  //     );
  //
  //     const poolAdapterConfigAfter = await poolAdapter.getConfig();
  //     const ret = [
  //       poolAdapterConfigAfter.origin,
  //       poolAdapterConfigAfter.outUser,
  //       poolAdapterConfigAfter.outCollateralAsset.toLowerCase(),
  //       poolAdapterConfigAfter.outBorrowAsset.toLowerCase()
  //     ].join("\n");
  //     const expected = [
  //       converterNormal.address,
  //       user,
  //       collateralAsset.toLowerCase(),
  //       borrowAsset.toLowerCase()
  //     ].join("\n");
  //     return {ret, expected};
  //   }
  //
  //   describe("Good paths", () => {
  //     it("initialized pool adapter should has expected values", async () => {
  //       const r = await makeInitializePoolAdapterTest();
  //       expect(r.ret).eq(r.expected);
  //     });
  //   });
  //   describe("Bad paths", () => {
  //     it("should revert if converter address is not registered", async () => {
  //
  //       await expect(
  //         makeInitializePoolAdapterTest(
  //           {useWrongConverter: true}
  //         )
  //       ).revertedWith("TC-25 converter not found"); // CONVERTER_NOT_FOUND
  //     });
  //     it("should revert if it's called by not borrow-manager", async () => {
  //       await expect(
  //         makeInitializePoolAdapterTest(
  //           {wrongCallerOfInitializePoolAdapter: true}
  //         )
  //       ).revertedWith("TC-45 borrow manager only"); // BORROW_MANAGER_ONLY
  //     });
  //   });
  // });
  //
  // describe("registerCTokens", () => {
  //   describe("Good paths", () => {
  //     it("should return expected values", async () => {
  //       const controller = await TetuConverterApp.createController(deployer);
  //       const platformAdapter = await AdaptersHelper.createHundredFinancePlatformAdapter(
  //         deployer,
  //         controller.address,
  //         HundredFinanceHelper.getComptroller(deployer).address,
  //         ethers.Wallet.createRandom().address,
  //         [MaticAddresses.hUSDC, MaticAddresses.hETH]
  //       );
  //       await platformAdapter.registerCTokens(
  //         [MaticAddresses.hDAI, MaticAddresses.hDAI, MaticAddresses.hETH]
  //       );
  //
  //       const ret = [
  //         await platformAdapter.activeAssets(MaticAddresses.USDC),
  //         await platformAdapter.activeAssets(MaticAddresses.WETH),
  //         await platformAdapter.activeAssets(MaticAddresses.DAI),
  //         await platformAdapter.activeAssets(MaticAddresses.USDT), // (!) not registered
  //       ].join();
  //
  //       const expected = [
  //         MaticAddresses.hUSDC,
  //         MaticAddresses.hETH,
  //         MaticAddresses.hDAI,
  //         Misc.ZERO_ADDRESS
  //       ].join();
  //
  //       expect(ret).eq(expected);
  //     });
  //   });
  //   describe("Bad paths", () => {
  //     describe("Not governance", () => {
  //       it("should revert", async () => {
  //         const controller = await TetuConverterApp.createController(deployer);
  //         const platformAdapter = await AdaptersHelper.createHundredFinancePlatformAdapter(
  //           deployer,
  //           controller.address,
  //           HundredFinanceHelper.getComptroller(deployer).address,
  //           ethers.Wallet.createRandom().address,
  //           [MaticAddresses.hUSDC, MaticAddresses.hETH]
  //         );
  //         const platformAdapterAsNotGov = HfPlatformAdapter__factory.connect(
  //           platformAdapter.address,
  //           await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address)
  //         );
  //         await expect(
  //           platformAdapterAsNotGov.registerCTokens([MaticAddresses.hUSDT])
  //         ).revertedWith("TC-9 governance only"); // GOVERNANCE_ONLY
  //       });
  //     });
  //     describe("Try to add not CToken", () => {
  //       it("should revert", async () => {
  //         const controller = await TetuConverterApp.createController(deployer);
  //         const platformAdapter = await AdaptersHelper.createHundredFinancePlatformAdapter(
  //           deployer,
  //           controller.address,
  //           HundredFinanceHelper.getComptroller(deployer).address,
  //           ethers.Wallet.createRandom().address,
  //           [MaticAddresses.hUSDC, MaticAddresses.hETH]
  //         );
  //         await expect(
  //           platformAdapter.registerCTokens(
  //             [ethers.Wallet.createRandom().address] // (!)
  //           )
  //         ).revertedWithoutReason();
  //       });
  //     });
  //   });
  // });
  //
  // describe("events", () => {
  //   it("should emit expected values", async () => {
  //     const user = ethers.Wallet.createRandom().address;
  //     const collateralAsset = MaticAddresses.DAI;
  //     const borrowAsset = MaticAddresses.USDC;
  //
  //     const controller = await TetuConverterApp.createController(deployer);
  //     const converterNormal = await AdaptersHelper.createHundredFinancePoolAdapter(deployer);
  //     const platformAdapter = await AdaptersHelper.createHundredFinancePlatformAdapter(
  //       deployer,
  //       controller.address,
  //       MaticAddresses.HUNDRED_FINANCE_COMPTROLLER,
  //       converterNormal.address,
  //       [MaticAddresses.hDAI, MaticAddresses.hUSDC]
  //     );
  //
  //     const poolAdapter = await AdaptersHelper.createHundredFinancePoolAdapter(deployer);
  //     const platformAdapterAsBorrowManager = HfPlatformAdapter__factory.connect(
  //       platformAdapter.address,
  //       await DeployerUtils.startImpersonate(await controller.borrowManager())
  //     );
  //
  //     function stringsEqualCaseInsensitive(s1: string, s2: string): boolean {
  //       return s1.toUpperCase() === s2.toUpperCase();
  //     }
  //     await expect(
  //       platformAdapterAsBorrowManager.initializePoolAdapter(
  //         converterNormal.address,
  //         poolAdapter.address,
  //         user,
  //         collateralAsset,
  //         borrowAsset
  //       )
  //     ).to.emit(platformAdapter, "OnPoolAdapterInitialized").withArgs(
  //       (s: string) => stringsEqualCaseInsensitive(s, converterNormal.address),
  //       (s: string) => stringsEqualCaseInsensitive(s, poolAdapter.address),
  //       (s: string) => stringsEqualCaseInsensitive(s, user),
  //       (s: string) => stringsEqualCaseInsensitive(s, collateralAsset),
  //       (s: string) => stringsEqualCaseInsensitive(s, borrowAsset)
  //     );
  //   });
  // });
  //
  // describe("getMarketsInfo", () => {
  //   let platformAdapter: HfPlatformAdapter;
  //   before(async function () {
  //     const controller = await TetuConverterApp.createController(deployer);
  //     const converterNormal = await AdaptersHelper.createHundredFinancePoolAdapter(deployer);
  //     platformAdapter = await AdaptersHelper.createHundredFinancePlatformAdapter(
  //       deployer,
  //       controller.address,
  //       MaticAddresses.HUNDRED_FINANCE_COMPTROLLER,
  //       converterNormal.address,
  //       [MaticAddresses.hDAI, MaticAddresses.hUSDC]
  //     );
  //   });
  //   describe("Good paths", () => {
  //     it("should return not zero ltv and liquidityThreshold", async () => {
  //       const r = await platformAdapter.getMarketsInfo(MaticAddresses.hMATIC, MaticAddresses.hDAI);
  //       expect(r.ltv18.eq(0) || r.liquidityThreshold18.eq(0)).eq(false);
  //     });
  //   });
  //   describe("Bad paths", () => {
  //     describe("Collateral token is unregistered in the protocol", () => {
  //       it("should return zero ltv and zero liquidityThreshold", async () => {
  //         const r = await platformAdapter.getMarketsInfo(ethers.Wallet.createRandom().address, MaticAddresses.hDAI);
  //         console.log(r);
  //         expect(r.ltv18.eq(0) && r.liquidityThreshold18.eq(0)).eq(true);
  //       });
  //     });
  //     describe("Borrow token is unregistered in the protocol", () => {
  //       it("should return zero ltv and zero liquidityThreshold", async () => {
  //         const r = await platformAdapter.getMarketsInfo(MaticAddresses.hDAI, ethers.Wallet.createRandom().address);
  //         console.log(r);
  //         console.log(r.ltv18.eq(0));
  //         console.log(r.liquidityThreshold18.eq(0));
  //         expect(r.ltv18.eq(0) && r.liquidityThreshold18.eq(0)).eq(true);
  //       });
  //     });
  //   });
  // });
  //
  // describe("setFrozen", () => {
  //   it("should assign expected value to frozen", async () => {
  //     const controller = await TetuConverterApp.createController(deployer,
  //       {tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
  //     );
  //
  //     const comptroller = await HundredFinanceHelper.getComptroller(deployer);
  //     const hfPlatformAdapter = await AdaptersHelper.createHundredFinancePlatformAdapter(
  //       deployer,
  //       controller.address,
  //       comptroller.address,
  //       ethers.Wallet.createRandom().address,
  //       [],
  //     );
  //
  //     const before = await hfPlatformAdapter.frozen();
  //     await hfPlatformAdapter.setFrozen(true);
  //     const middle = await hfPlatformAdapter.frozen();
  //     await hfPlatformAdapter.setFrozen(false);
  //     const after = await hfPlatformAdapter.frozen();
  //
  //     const ret = [before, middle, after].join();
  //     const expected = [false, true, false].join();
  //
  //     expect(ret).eq(expected);
  //   });
  // });
  //
  // describe("platformKind", () => {
  //   it("should return expected values", async () => {
  //     const controller = await TetuConverterApp.createController(deployer);
  //     const converterNormal = await AdaptersHelper.createHundredFinancePoolAdapter(deployer);
  //     const pa = await AdaptersHelper.createHundredFinancePlatformAdapter(
  //       deployer,
  //       controller.address,
  //       MaticAddresses.HUNDRED_FINANCE_COMPTROLLER,
  //       converterNormal.address,
  //       [MaticAddresses.hDAI, MaticAddresses.hUSDC]
  //     );
  //     expect((await pa.platformKind())).eq(1); // LendingPlatformKinds.DFORCE_1
  //   });
  // });
//endregion Unit tests
});