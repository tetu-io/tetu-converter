/* tslint:disable:no-trailing-whitespace */
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {Misc} from "../../../scripts/utils/Misc";
import {expect} from "chai";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {BigNumber} from "ethers";
import {AprUtils} from "../../baseUT/utils/aprUtils";
import {ICompound3AssetInfo} from "../../../scripts/integration/compound3/Compound3Helper";
import {convertUnits} from "../../baseUT/protocols/shared/aprUtils";
import {areAlmostEqual} from "../../baseUT/utils/CommonUtils";
import {addLiquidatorPath} from "../../baseUT/protocols/tetu-liquidator/TetuLiquidatorUtils";
import {defaultAbiCoder, formatUnits, getAddress, parseUnits} from "ethers/lib/utils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {Compound3ChangePriceUtils} from "../../baseUT/protocols/compound3/Compound3ChangePriceUtils";
import {PredictBrUsesCase} from "../../baseUT/uses-cases/shared/PredictBrUsesCase";
import {AppConstants} from "../../baseUT/types/AppConstants";
import {GAS_LIMIT} from "../../baseUT/types/GasLimit";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {HardhatUtils, POLYGON_NETWORK_ID} from "../../../scripts/utils/HardhatUtils";
import {IConversionPlan} from "../../baseUT/types/AppDataTypes";
import {AdaptersHelper} from "../../baseUT/app/AdaptersHelper";
import {MocksHelper} from "../../baseUT/app/MocksHelper";
import {TetuConverterApp} from "../../baseUT/app/TetuConverterApp";
import {Compound3PlatformActor} from "../../baseUT/protocols/compound3/Compound3PlatformActor";
import {
  BorrowManager__factory, Compound3PlatformAdapter, Compound3PlatformAdapter__factory,
  ConverterController, IComet,
  IComet__factory, ICometRewards,
  ICometRewards__factory,
  IERC20__factory,
  IERC20Metadata__factory,
  IPriceFeed__factory
} from "../../../typechain";
import {deal} from "hardhat-deal";
import {TokenUtils} from "../../../scripts/utils/TokenUtils";


describe("Compound3PlatformAdapterTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);

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

//region Test predict-br impl
  async function makePredictBrTest(
    collateralAsset: string,
    cometAddress: string,
    cometRewards: string,
    collateralHolders: string[],
    part10000: number
  ) : Promise<{br: BigNumber, brPredicted: BigNumber}> {
    const comet = IComet__factory.connect(cometAddress, deployer)
    const actor = new Compound3PlatformActor(deployer, comet, collateralAsset);
    return PredictBrUsesCase.predictBrTest(deployer, actor,{
      collateralAsset,
      borrowAsset: await comet.baseToken(),
      collateralHolders,
      part10000
    });
  }
//endregion Test predict-br impl

//region Get conversion plan test impl
  interface IGetConversionPlanBadPaths {
    zeroCollateralAsset?: boolean;
    zeroBorrowAsset?: boolean;
    zeroCountBlocks?: boolean;
    zeroCollateralAmount?: boolean;
    incorrectHealthFactor2?: number;
    setSupplyPaused?: boolean;
    setWithdrawPaused?: boolean;
    frozen?: boolean;
    borrowAmount?: BigNumber
  }

  interface IPreparePlanResults {
    plan: IConversionPlan;
    healthFactor2: number;
    priceCollateral: BigNumber;
    priceBorrow: BigNumber;
    priceCollateral36: BigNumber;
    priceBorrow36: BigNumber;
    countBlocks: number;
    borrowAssetDecimals: number;
    collateralAssetDecimals: number;
    comet: IComet;
    cometRewards: ICometRewards;
    converter: string;
    collateralAssetInfo?: ICompound3AssetInfo;
    frozen?: boolean;
  }

  async function preparePlan(
    controller: ConverterController,
    collateralAsset: string,
    collateralAmount: BigNumber,
    borrowAsset: string,
    p?: IGetConversionPlanBadPaths,
    entryData?: string
  ): Promise<IPreparePlanResults> {
    const countBlocks = (await controller.blocksPerDay()).toNumber();
    const healthFactor2 = 130;

    const comet = IComet__factory.connect(MaticAddresses.COMPOUND3_COMET_USDC, deployer)
    const cometRewards = ICometRewards__factory.connect(MaticAddresses.COMPOUND3_COMET_REWARDS, deployer)
    const converter = ethers.Wallet.createRandom().address
    const platformAdapter = await AdaptersHelper.createCompound3PlatformAdapter(
      deployer,
      controller.address,
      converter,
      [comet.address],
      cometRewards.address
    )

    const borrowAssetDecimals = await (IERC20Metadata__factory.connect(borrowAsset, deployer)).decimals();
    const collateralAssetDecimals = await (IERC20Metadata__factory.connect(collateralAsset, deployer)).decimals();

    const borrowAssetPriceFeed = IPriceFeed__factory.connect(await comet.baseTokenPriceFeed(), deployer)

    let collateralAssetInfo
    let priceCollateral = BigNumber.from(0)
    let priceBorrow = BigNumber.from(0)
    let priceCollateral36 = BigNumber.from(0)
    let priceBorrow36 = BigNumber.from(0)

    try {
      collateralAssetInfo = await comet.getAssetInfoByAddress(collateralAsset)
    } catch {}
    if (collateralAssetInfo) {
      const collateralAssetPriceFeed = IPriceFeed__factory.connect(collateralAssetInfo.priceFeed, deployer)
      priceBorrow = (await borrowAssetPriceFeed.latestRoundData()).answer
      priceCollateral = (await collateralAssetPriceFeed.latestRoundData()).answer
      priceBorrow36 = priceBorrow.mul(getBigNumberFrom(1, 10));
      priceCollateral36 = priceCollateral.mul(getBigNumberFrom(1, 10));
      console.log("collateralAssetInfo", collateralAssetInfo);
    }
    // console.log("priceBorrow", priceBorrow.toString());
    // console.log("priceCollateral", priceCollateral.toString());
    // console.log("priceBorrow18", priceBorrow36.toString());
    // console.log("priceCollateral18", priceCollateral36.toString());

    if (p?.setSupplyPaused || p?.setWithdrawPaused) {
      await Compound3ChangePriceUtils.setPaused(deployer, comet.address, !!p?.setSupplyPaused, !!p?.setWithdrawPaused)
    }

    if (p?.frozen) {
      await platformAdapter.connect(await Misc.impersonate(await controller.governance())).setFrozen(true)
    }

    const plan = await platformAdapter.getConversionPlan(
      {
        collateralAsset: p?.zeroCollateralAsset ? Misc.ZERO_ADDRESS : collateralAsset,
        amountIn: p?.zeroCollateralAmount ? 0 : collateralAmount,
        borrowAsset: p?.zeroBorrowAsset ? Misc.ZERO_ADDRESS : borrowAsset,
        countBlocks: p?.zeroCountBlocks ? 0 : countBlocks,
        entryData: entryData || "0x",
      },
      p?.incorrectHealthFactor2 || healthFactor2,
      {gasLimit: GAS_LIMIT},
    )

    return {
      plan,
      countBlocks,
      borrowAssetDecimals,
      collateralAssetDecimals,
      priceCollateral36,
      priceBorrow36,
      healthFactor2,
      priceCollateral,
      priceBorrow,
      comet,
      cometRewards,
      converter,
      collateralAssetInfo,
    }
  }

  async function makeTestComparePlanWithDirectCalculations(
    controller: ConverterController,
    collateralAsset: string,
    collateralAmount: BigNumber,
    borrowAsset: string,
    badPathsParams?: IGetConversionPlanBadPaths
  ): Promise<{ plan: IConversionPlan, expectedPlan: IConversionPlan }> {
    // console.log("makeTestComparePlanWithDirectCalculations collateralAmount", collateralAmount.toString());
    const libFacade = await MocksHelper.getCompound3AprLibFacade(deployer);

    const d = await preparePlan(
      controller,
      collateralAsset,
      collateralAmount,
      borrowAsset,
      badPathsParams
    );

    // console.log("getConversionPlan", d.plan);
    // console.log("getConversionPlan liquidationThreshold18", d.plan.liquidationThreshold18.toString());
    // console.log("getConversionPlan ltv18", d.plan.ltv18.toString());
    // console.log("getConversionPlan collateralAmount", d.plan.collateralAmount.toString());
    // console.log("getConversionPlan amountToBorrow", d.plan.amountToBorrow.toString());
    // console.log("getConversionPlan borrowCost36", d.plan.borrowCost36.toString());
    // console.log("getConversionPlan rewardsAmountInBorrowAsset36", d.plan.rewardsAmountInBorrowAsset36.toString());
    // console.log("getConversionPlan maxAmountToBorrow", d.plan.maxAmountToBorrow.toString());
    // console.log("getConversionPlan maxAmountToSupply", d.plan.maxAmountToSupply.toString());

    let amountToBorrow = AprUtils.getBorrowAmount(
      collateralAmount,
      d.healthFactor2,
      d.plan.liquidationThreshold18,
      d.priceCollateral36,
      d.priceBorrow36,
      d.collateralAssetDecimals,
      d.borrowAssetDecimals
    );
    if (amountToBorrow.gt(d.plan.maxAmountToBorrow)) {
      amountToBorrow = d.plan.maxAmountToBorrow;
    }

    const amountCollateralInBorrowAsset36 = convertUnits(collateralAmount,
      d.priceCollateral36,
      d.collateralAssetDecimals,
      d.priceBorrow36,
      36
    );

    const borrowCost36 = await libFacade.getBorrowCost36(
      d.comet.address,
      amountToBorrow,
      d.countBlocks,
      await controller.blocksPerDay(),
      parseUnits('1', await (IERC20Metadata__factory.connect(borrowAsset, deployer)).decimals())
    )
    const rewardsAmountInBorrowAsset36 = await libFacade.getRewardsAmountInBorrowAsset36(
      d.comet.address,
      d.cometRewards.address,
      controller.address,
      amountToBorrow,
      d.countBlocks,
      await controller.blocksPerDay(),
      parseUnits('1', await (IERC20Metadata__factory.connect(borrowAsset, deployer)).decimals())
    )

    return {
      plan: d.plan,
      expectedPlan: {
        converter: d.converter,
        liquidationThreshold18: d.collateralAssetInfo ? d.collateralAssetInfo.liquidateCollateralFactor : BigNumber.from(0),
        amountToBorrow,
        collateralAmount,
        borrowCost36,
        supplyIncomeInBorrowAsset36: BigNumber.from(0),
        rewardsAmountInBorrowAsset36,
        amountCollateralInBorrowAsset36,
        ltv18: d.collateralAssetInfo ? d.collateralAssetInfo.borrowCollateralFactor : BigNumber.from(0),
        maxAmountToBorrow: await IERC20__factory.connect(borrowAsset, deployer).balanceOf(d.comet.address),
        maxAmountToSupply: d.collateralAssetInfo ? d.collateralAssetInfo.supplyCap.sub(await (await IERC20__factory.connect(collateralAsset, deployer)).balanceOf(d.comet.address)) : BigNumber.from(0),
      }
    };
  }

//endregion Get conversion plan test impl

  describe("constructor and converters()", () => {
    interface IContractsSet {
      controller: string;
      converter: string;
      comets: string[];
      cometRewards: string;
    }

    interface ICreateContractsSetBadParams {
      zeroController?: boolean;
      zeroConverter?: boolean;
      zeroComets?: boolean;
      zeroCometRewards?: boolean;
    }

    async function initializePlatformAdapter(
      badPaths?: ICreateContractsSetBadParams
    ): Promise<{ data: IContractsSet, platformAdapter: Compound3PlatformAdapter }> {
      const controller = await TetuConverterApp.createController(
        deployer,
        {networkId: POLYGON_NETWORK_ID, tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
      );
      const templateAdapterNormalStub = ethers.Wallet.createRandom();

      const data: IContractsSet = {
        controller: badPaths?.zeroController ? Misc.ZERO_ADDRESS : controller.address,
        converter: badPaths?.zeroConverter ? Misc.ZERO_ADDRESS : templateAdapterNormalStub.address,
        comets: badPaths?.zeroComets ? [] : [MaticAddresses.COMPOUND3_COMET_USDC],
        cometRewards: badPaths?.zeroCometRewards ? Misc.ZERO_ADDRESS : MaticAddresses.COMPOUND3_COMET_REWARDS,
      }
      const platformAdapter = await AdaptersHelper.createCompound3PlatformAdapter(
        deployer,
        data.controller,
        data.converter,
        data.comets,
        data.cometRewards,
        await controller.borrowManager()
      )
      return {data, platformAdapter};
    }

    describe("Good paths", () => {
      it("should return expected values", async () => {
        const r = await initializePlatformAdapter();

        expect(await r.platformAdapter.controller()).eq(r.data.controller)
        expect(await r.platformAdapter.converter()).eq(r.data.converter)
        expect((await r.platformAdapter.converters()).join()).eq([r.data.converter].join())
      })
    })
    describe("Bad paths", () => {
      it("should revert if comets array length is zero", async () => {
        await expect(
          initializePlatformAdapter({zeroComets: true})
        ).revertedWith("TC-1 zero address");
      });
      it("should revert if cometRewards is zero", async () => {
        await expect(
          initializePlatformAdapter({zeroCometRewards: true})
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

  describe("getConversionPlan", () => {
    let controller: ConverterController;
    let snapshotLocal: string;
    before(async function () {
      snapshotLocal = await TimeUtils.snapshot();
      controller = await TetuConverterApp.createController(
        deployer,
        {networkId: POLYGON_NETWORK_ID, tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
      );
      await addLiquidatorPath(
        MaticAddresses.TETU_LIQUIDATOR,
        MaticAddresses.TETU_LIQUIDATOR_CONTROLLER_GOVERNANCE,
        MaticAddresses.COMP,
        MaticAddresses.WETH,
        MaticAddresses.TETU_LIQUIDATOR_UNIV2_SWAPPER,
        MaticAddresses.SUSHI_WETH_COMP
      )
    });
    after(async function () {
      await TimeUtils.rollback(snapshotLocal);
    });
    describe("Good paths", () => {
      describe("WETH : USDC", () => {
        it("should return expected values", async () => {
          const collateralAsset = MaticAddresses.WETH;
          const borrowAsset = MaticAddresses.USDC;

          const collateralAmount = getBigNumberFrom(100, 18);

          const r = await makeTestComparePlanWithDirectCalculations(
            controller,
            collateralAsset,
            collateralAmount,
            borrowAsset,
          );

          expect(r.plan.converter).eq(r.expectedPlan.converter);
          expect(r.plan.liquidationThreshold18).eq(r.expectedPlan.liquidationThreshold18);
          expect(r.plan.amountToBorrow).eq(r.expectedPlan.amountToBorrow);
          expect(r.plan.collateralAmount).eq(r.expectedPlan.collateralAmount);
          expect(r.plan.borrowCost36).eq(r.expectedPlan.borrowCost36);
          expect(r.plan.supplyIncomeInBorrowAsset36).eq(0);
          expect(r.plan.rewardsAmountInBorrowAsset36).eq(r.expectedPlan.rewardsAmountInBorrowAsset36);
          expect(areAlmostEqual(r.plan.amountCollateralInBorrowAsset36, r.expectedPlan.amountCollateralInBorrowAsset36, 20)).eq(true);
          expect(r.plan.ltv18).eq(r.expectedPlan.ltv18);
          expect(r.plan.maxAmountToBorrow).eq(r.expectedPlan.maxAmountToBorrow);
          expect(r.plan.maxAmountToSupply).eq(r.expectedPlan.maxAmountToSupply);
        })
      })
      describe("WBTC : USDC", () => {
        it("should return expected values", async () => {
          const collateralAsset = MaticAddresses.WBTC;
          const borrowAsset = MaticAddresses.USDC;

          const collateralAmount = getBigNumberFrom(10, 8);

          const r = await makeTestComparePlanWithDirectCalculations(
            controller,
            collateralAsset,
            collateralAmount,
            borrowAsset,
          );

          expect(r.plan.converter).eq(r.expectedPlan.converter);
          expect(r.plan.liquidationThreshold18).eq(r.expectedPlan.liquidationThreshold18);
          expect(r.plan.amountToBorrow).eq(r.expectedPlan.amountToBorrow);
          expect(r.plan.collateralAmount).eq(r.expectedPlan.collateralAmount);
          expect(r.plan.borrowCost36).eq(r.expectedPlan.borrowCost36);
          expect(r.plan.supplyIncomeInBorrowAsset36).eq(0);
          expect(r.plan.rewardsAmountInBorrowAsset36).eq(r.expectedPlan.rewardsAmountInBorrowAsset36);
          expect(areAlmostEqual(r.plan.amountCollateralInBorrowAsset36, r.expectedPlan.amountCollateralInBorrowAsset36, 20)).eq(true);
          expect(r.plan.ltv18).eq(r.expectedPlan.ltv18);
          expect(r.plan.maxAmountToBorrow).eq(r.expectedPlan.maxAmountToBorrow);
          expect(r.plan.maxAmountToSupply).eq(r.expectedPlan.maxAmountToSupply);
        })
      })
      describe("WMATIC : USDC", () => {
        it("should return expected values", async () => {
          const collateralAsset = MaticAddresses.WMATIC;
          const borrowAsset = MaticAddresses.USDC;

          const collateralAmount = getBigNumberFrom(10000, 18);

          const r = await makeTestComparePlanWithDirectCalculations(
            controller,
            collateralAsset,
            collateralAmount,
            borrowAsset,
          );

          expect(r.plan.converter).eq(r.expectedPlan.converter);
          expect(r.plan.liquidationThreshold18).eq(r.expectedPlan.liquidationThreshold18);
          expect(r.plan.amountToBorrow).eq(r.expectedPlan.amountToBorrow);
          expect(r.plan.collateralAmount).eq(r.expectedPlan.collateralAmount);
          expect(r.plan.borrowCost36).eq(r.expectedPlan.borrowCost36);
          expect(r.plan.supplyIncomeInBorrowAsset36).eq(0);
          expect(r.plan.rewardsAmountInBorrowAsset36).eq(r.expectedPlan.rewardsAmountInBorrowAsset36);
          expect(areAlmostEqual(r.plan.amountCollateralInBorrowAsset36, r.expectedPlan.amountCollateralInBorrowAsset36, 20)).eq(true);
          expect(r.plan.ltv18).eq(r.expectedPlan.ltv18);
          expect(r.plan.maxAmountToBorrow).eq(r.expectedPlan.maxAmountToBorrow);
          expect(r.plan.maxAmountToSupply).eq(r.expectedPlan.maxAmountToSupply);
        })
      })
      describe("Try to use huge collateral amount", () => {
        it("should return borrow amount equal to max available amount", async () => {
          const r = await preparePlan(
            controller,
            MaticAddresses.WMATIC,
            parseUnits('20000000'),
            MaticAddresses.USDC
          )

          expect(r.plan.amountToBorrow).eq(r.plan.maxAmountToBorrow);
        })
        it("should return collateral amount equal to max collateral amount if borrow reserve is enough", async () => {
          const borrowAsset = MaticAddresses.USDC;

          const borrowAssetContract = IERC20Metadata__factory.connect(borrowAsset, await DeployerUtils.startImpersonate(MaticAddresses.HOLDER_USDC))
          await borrowAssetContract.transfer(MaticAddresses.COMPOUND3_COMET_USDC, await borrowAssetContract.balanceOf(MaticAddresses.HOLDER_USDC))

          const r = await preparePlan(
            controller,
            MaticAddresses.WMATIC,
            parseUnits('20000000'),
            borrowAsset
          )

          expect(r.plan.collateralAmount).eq(r.plan.maxAmountToSupply);
        })
      })
      describe("EntryKinds", () => {
        describe("Use ENTRY_KIND_EXACT_COLLATERAL_IN_FOR_MAX_BORROW_OUT_0", () => {
          it("should return expected collateral amount", async () => {
            const r = await preparePlan(
              controller,
              MaticAddresses.WMATIC,
              parseUnits("1000"),
              MaticAddresses.USDC,
              undefined,
              defaultAbiCoder.encode(["uint256"], [AppConstants.ENTRY_KIND_0])
            )

            expect(r.plan.collateralAmount).eq(parseUnits("1000"))
          })
        })
        describe("Use ENTRY_KIND_EXACT_PROPORTION_1", () => {
          it("should split source amount on the parts with almost same cost", async () => {
            const collateralAmount = parseUnits("1000")

            const r = await preparePlan(
              controller,
              MaticAddresses.WMATIC,
              collateralAmount,
              MaticAddresses.USDC,
              undefined,
              defaultAbiCoder.encode(
                ["uint256", "uint256", "uint256"],
                [AppConstants.ENTRY_KIND_1, 1, 1]
              )
            )

            console.log('collateralAmount', collateralAmount.toString())
            console.log('r.plan.collateralAmount', r.plan.collateralAmount.toString())
            console.log('r.priceCollateral', r.priceCollateral.toString())
            console.log('r.plan.amountToBorrow', r.plan.amountToBorrow.toString())
            console.log('r.priceBorrow', r.priceBorrow.toString())
            console.log('r.collateralAssetDecimals', r.collateralAssetDecimals.toString())
            console.log('r.borrowAssetDecimals', r.borrowAssetDecimals.toString())

            const sourceAssetUSD = +formatUnits(
              collateralAmount.sub(r.plan.collateralAmount).mul(r.priceCollateral),
              r.collateralAssetDecimals + 8
            );
            const targetAssetUSD = +formatUnits(
              r.plan.amountToBorrow.mul(r.priceBorrow),
              r.borrowAssetDecimals + 8
            );

            expect(r.plan.collateralAmount).lt(collateralAmount)
            expect(sourceAssetUSD).approximately(targetAssetUSD, 1)
          })
        })
        describe("Use ENTRY_KIND_EXACT_BORROW_OUT_FOR_MIN_COLLATERAL_IN_2", () => {
          it("should return expected collateral amount", async () => {
            const collateralAmount = parseUnits("1000", 6)

            const r = await preparePlan(
              controller,
              MaticAddresses.WMATIC,
              collateralAmount,
              MaticAddresses.USDC,
              undefined,
              defaultAbiCoder.encode(["uint256"], [AppConstants.ENTRY_KIND_2])
            )

            expect(r.plan.amountToBorrow).eq(collateralAmount)
          })
        })
      })
    })
    describe("Bad paths", () => {
      async function tryGetConversionPlan(
        badPathsParams: IGetConversionPlanBadPaths,
        collateralAsset: string = MaticAddresses.WETH,
        borrowAsset: string = MaticAddresses.USDC,
        collateralAmount: BigNumber = parseUnits("1000", 18)
      ): Promise<IConversionPlan> {
        return (await preparePlan(
          controller,
          collateralAsset,
          collateralAmount,
          borrowAsset,
          badPathsParams,
        )).plan
      }
      describe("incorrect input params", () => {
        describe("collateral token is zero", () => {
          it("should revert", async () => {
            await expect(
              tryGetConversionPlan({ zeroCollateralAsset: true })
            ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
          });
        });
        describe("borrow token is zero", () => {
          it("should revert", async () =>{
            await expect(
              tryGetConversionPlan({ zeroBorrowAsset: true })
            ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
          });
        });
        describe("healthFactor2_ is less than min allowed", () => {
          it("should revert", async () =>{
            await expect(
              tryGetConversionPlan({ incorrectHealthFactor2: 100 })
            ).revertedWith("TC-3 wrong health factor"); // WRONG_HEALTH_FACTOR
          });
        });
        describe("countBlocks_ is zero", () => {
          it("should revert", async () => {
            await expect(
              tryGetConversionPlan({ zeroCountBlocks: true })
            ).revertedWith("TC-29 incorrect value"); // INCORRECT_VALUE
          });
        });
        describe("collateralAmount_ is zero", () => {
          it("should revert", async () => {
            await expect(
              tryGetConversionPlan({ zeroCollateralAmount: true })
            ).revertedWith("TC-29 incorrect value"); // INCORRECT_VALUE
          });
        });
      });
      describe("borrow less then min amount", () => {
        it("should fail", async () => {
          expect((await tryGetConversionPlan(
            {},
            MaticAddresses.WETH,
            MaticAddresses.USDC,
            parseUnits('0.0001')
          )).converter).eq(Misc.ZERO_ADDRESS);
        });
      })
      describe("asset is not registered", () => {
        it("should fail if collateral token is not registered", async () => {
          expect((await tryGetConversionPlan(
            {},
            MaticAddresses.agEUR
          )).converter).eq(Misc.ZERO_ADDRESS);
        });
        it("should fail if borrow token is not registered", async () => {
          expect((await tryGetConversionPlan(
            {},
            MaticAddresses.WETH,
            MaticAddresses.agEUR,
          )).converter).eq(Misc.ZERO_ADDRESS);
        });
      });
      describe("paused", () => {
        it("should fail if supplyPaused is true for collateral", async () => {
          expect((await tryGetConversionPlan({setSupplyPaused: true})).converter).eq(Misc.ZERO_ADDRESS);
        });
        it("should fail if withdrawPaused for borrow", async () => {
          expect((await tryGetConversionPlan({setWithdrawPaused: true})).converter).eq(Misc.ZERO_ADDRESS);
        });
      });
      describe("Use unsupported entry kind 999", () => {
        it("should return zero plan", async () => {
          const r = await preparePlan(
            controller,
            MaticAddresses.WMATIC,
            parseUnits("1000"),
            MaticAddresses.USDC,
            undefined,
            defaultAbiCoder.encode(["uint256"], [999]) // (unknown entry kind)
          )
          expect(r.plan.converter).eq(Misc.ZERO_ADDRESS);
          expect(r.plan.collateralAmount.eq(0)).eq(true);
          expect(r.plan.amountToBorrow.eq(0)).eq(true);
        });
      });
      describe("Frozen", () => {
        it("should return zero plan", async () => {
          const r = await preparePlan(
            controller,
            MaticAddresses.WETH,
            parseUnits("1000"),
            MaticAddresses.USDC,
            {frozen: true},
            "0x"
          )
          expect(r.plan.converter).eq(Misc.ZERO_ADDRESS);
          expect(r.plan.collateralAmount.eq(0)).eq(true);
          expect(r.plan.amountToBorrow.eq(0)).eq(true);
        });
      });
      describe("supply cap is reached", () => {
        it("should return zero plan", async () => {
          // get normal (not empty) plan
          const r0 = await preparePlan(
            controller,
            MaticAddresses.WETH,
            parseUnits("1"),
            MaticAddresses.USDC,
            undefined,
            "0x"
          );

          // supply cap is constant in Compound 3
          // let's supply big amount to reach supply cap
          const comet = IComet__factory.connect(MaticAddresses.COMPOUND3_COMET_USDC, deployer);
          const amountToSupply = r0.plan.maxAmountToSupply;
          await TokenUtils.getToken(MaticAddresses.WETH, deployer.address, amountToSupply);
          await IERC20__factory.connect(MaticAddresses.WETH, deployer).approve(comet.address, amountToSupply);
          await comet.supply(MaticAddresses.WETH, amountToSupply);

          // get empty plan now
          const r1 = await preparePlan(
            controller,
            MaticAddresses.WETH,
            parseUnits("1000"),
            MaticAddresses.USDC,
            undefined,
            "0x"
          );
          console.log("r1", r1.plan);

          expect(r0.plan.converter).not.eq(Misc.ZERO_ADDRESS);
          expect(r0.plan.collateralAmount.eq(0)).not.eq(true);
          expect(r0.plan.amountToBorrow.eq(0)).not.eq(true);

          expect(r1.plan.converter).eq(Misc.ZERO_ADDRESS);
          expect(r1.plan.collateralAmount.eq(0)).eq(true);
          expect(r1.plan.amountToBorrow.eq(0)).eq(true);
        });
      });
    })
  })

  describe("getBorrowRateAfterBorrow", () => {
    describe("Good paths", () => {
      describe("small amount WETH => USDC", () => {
        it("Predicted borrow rate should be same to real rate after the borrow", async () => {
          const r = await makePredictBrTest(
            MaticAddresses.WETH,
            MaticAddresses.COMPOUND3_COMET_USDC,
            MaticAddresses.COMPOUND3_COMET_REWARDS,
            [
              MaticAddresses.HOLDER_WETH,
              MaticAddresses.HOLDER_WETH_2,
              MaticAddresses.HOLDER_WETH_3,
              MaticAddresses.HOLDER_WETH_4,
            ],

            // Compound III implements a minimum borrow position size which can be found as baseBorrowMin in the protocol configuration.
            // A withdraw transaction to borrow that results in the account’s borrow size being less than the baseBorrowMin will revert.
            // https://docs.compound.finance/collateral-and-borrowing/#collateral--borrowing
            // Following amount should exceed that limit

            5
          )

          expect(areAlmostEqual(r.br, r.brPredicted, 4)).eq(true)
        })
      })
      describe("huge amount WETH => USDC", () => {
        it("Predicted borrow rate should be same to real rate after the borrow", async () => {
          const r = await makePredictBrTest(
            MaticAddresses.WETH,
            MaticAddresses.COMPOUND3_COMET_USDC,
            MaticAddresses.COMPOUND3_COMET_REWARDS,
            [
              MaticAddresses.HOLDER_WETH,
              MaticAddresses.HOLDER_WETH_2,
              MaticAddresses.HOLDER_WETH_3,
              MaticAddresses.HOLDER_WETH_4,
            ],
            500
          )

          expect(areAlmostEqual(r.br, r.brPredicted, 4)).eq(true)
        })
      })
    })
    describe("Bad paths", () => {
      it("incorrect asset", async () => {
        const controller = await TetuConverterApp.createController(
          deployer,
          {networkId: POLYGON_NETWORK_ID, tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
        );
        const libFacade = await MocksHelper.getCompound3AprLibFacade(deployer);

        expect(await libFacade.getBorrowRateAfterBorrow(Misc.ZERO_ADDRESS, parseUnits('1'))).eq(0);
      })
    })
  })

  describe("initializePoolAdapter", () => {
    let controller: ConverterController;
    let snapshotLocal: string;
    before(async function () {
      snapshotLocal = await TimeUtils.snapshot();
      controller = await TetuConverterApp.createController(
        deployer,
        {networkId: POLYGON_NETWORK_ID, tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
      );
    });
    after(async function () {
      await TimeUtils.rollback(snapshotLocal);
    });

    interface IInitializePoolAdapterBadPaths {
      useWrongConverter?: boolean;
      wrongCallerOfInitializePoolAdapter?: boolean;
      borrowAsset?: string;
    }

    interface IPooAdapterConfig {
      originConverter: string;
      user: string;
      collateralAsset: string;
      borrowAsset: string;
    }

    async function makeInitializePoolAdapterTest(
      badParams?: IInitializePoolAdapterBadPaths
    ): Promise<{ config: IPooAdapterConfig, expectedConfig: IPooAdapterConfig }> {
      const user = ethers.Wallet.createRandom().address;
      const collateralAsset = MaticAddresses.DAI;
      const borrowAsset = badParams?.borrowAsset || MaticAddresses.USDC;

      const borrowManager = BorrowManager__factory.connect(await controller.borrowManager(), deployer);

      const converterNormal = await AdaptersHelper.createCompound3PoolAdapter(deployer)
      const poolAdapter = await AdaptersHelper.createCompound3PoolAdapter(deployer)

      const comet = IComet__factory.connect(MaticAddresses.COMPOUND3_COMET_USDC, deployer)
      const cometRewards = ICometRewards__factory.connect(MaticAddresses.COMPOUND3_COMET_REWARDS, deployer)
      const platformAdapter = await AdaptersHelper.createCompound3PlatformAdapter(
        deployer,
        controller.address,
        converterNormal.address,
        [comet.address],
        cometRewards.address
      )

      const platformAdapterAsBorrowManager = Compound3PlatformAdapter__factory.connect(
        platformAdapter.address,
        badParams?.wrongCallerOfInitializePoolAdapter
          ? await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address)
          : await DeployerUtils.startImpersonate(borrowManager.address)
      );

      await platformAdapterAsBorrowManager.initializePoolAdapter(
        badParams?.useWrongConverter
          ? ethers.Wallet.createRandom().address
          : converterNormal.address,
        poolAdapter.address,
        user,
        collateralAsset,
        borrowAsset
      );

      const poolAdapterConfigAfter = await poolAdapter.getConfig();

      return {
        config: {
          originConverter: poolAdapterConfigAfter.originConverter_,
          user: poolAdapterConfigAfter.user_,
          collateralAsset: poolAdapterConfigAfter.collateralAsset_,
          borrowAsset: poolAdapterConfigAfter.borrowAsset_,
        },
        expectedConfig: {
          originConverter: converterNormal.address,
          user,
          collateralAsset: getAddress(collateralAsset),
          borrowAsset: getAddress(borrowAsset),
        }
      }
    }

    describe("Good paths", () => {
      it("initialized pool adapter should has expected values", async () => {
        const r = await makeInitializePoolAdapterTest();
        expect(r.config.originConverter).eq(r.expectedConfig.originConverter)
        expect(r.config.user).eq(r.expectedConfig.user)
        expect(r.config.collateralAsset).eq(r.expectedConfig.collateralAsset)
        expect(r.config.borrowAsset).eq(r.expectedConfig.borrowAsset)
      });
    });
    describe("Bad paths", () => {
      it("should revert if converter address is not registered", async () => {
        await expect(
          makeInitializePoolAdapterTest(
            {useWrongConverter: true}
          )
        ).revertedWith("TC-25 converter not found"); // CONVERTER_NOT_FOUND
      });
      it("should revert if it's called by not borrow-manager", async () => {
        await expect(
          makeInitializePoolAdapterTest(
            {wrongCallerOfInitializePoolAdapter: true}
          )
        ).revertedWith("TC-45 borrow manager only"); // BORROW_MANAGER_ONLY
      });
      it("should revert if borrowAsset is incorrect", async () => {
        await expect(
          makeInitializePoolAdapterTest(
            {borrowAsset: MaticAddresses.DAI}
          )
        ).revertedWith("TC-58 incorrect borrow asset"); // INCORRECT_BORROW_ASSET
      });
    });
  })

  describe("setFrozen", () => {
    describe("Good paths", () => {
      it("should assign expected value to frozen", async () => {
        const controller = await TetuConverterApp.createController(
          deployer,
          {networkId: POLYGON_NETWORK_ID, tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
        );
        const platformAdapter = await AdaptersHelper.createCompound3PlatformAdapter(
          deployer,
          controller.address,
          ethers.Wallet.createRandom().address,
          [MaticAddresses.COMPOUND3_COMET_USDC],
          MaticAddresses.COMPOUND3_COMET_REWARDS
        )

        expect(await platformAdapter.frozen()).eq(false)
        await platformAdapter.setFrozen(true)
        expect(await platformAdapter.frozen()).eq(true)
        await platformAdapter.setFrozen(false)
        expect(await platformAdapter.frozen()).eq(false)
      })
    });
    describe("Bad paths", () => {
      it("should assign expected value to frozen", async () => {
        const platformAdapter = await AdaptersHelper.createCompound3PlatformAdapter(
          deployer,
          (await TetuConverterApp.createController(deployer, {networkId: POLYGON_NETWORK_ID,})).address,
          ethers.Wallet.createRandom().address,
          [MaticAddresses.COMPOUND3_COMET_USDC],
          MaticAddresses.COMPOUND3_COMET_REWARDS
        )

        await expect(
          platformAdapter.connect(await Misc.impersonate(ethers.Wallet.createRandom().address)).setFrozen(true)
        ).revertedWith("TC-9 governance only"); // AppErrors.GOVERNANCE_ONLY
      })
    });
  })

  describe("manage comets", () => {
    it("add, remove comets", async () => {
      const controller = await TetuConverterApp.createController(
        deployer,
        {networkId: POLYGON_NETWORK_ID, tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
      );
      const platformAdapter = await AdaptersHelper.createCompound3PlatformAdapter(
        deployer,
        controller.address,
        ethers.Wallet.createRandom().address,
        [MaticAddresses.COMPOUND3_COMET_USDC],
        MaticAddresses.COMPOUND3_COMET_REWARDS
      )

      const newComet = ethers.Wallet.createRandom().address
      await platformAdapter.addComet(newComet)
      expect(await platformAdapter.cometsLength()).eq(2)
      await platformAdapter.removeComet(1)
      expect(await platformAdapter.cometsLength()).eq(1)
    });
  });
  describe("remove comet", () => {
    it("should throw if the index is out of range", async () => {
      const controller = await TetuConverterApp.createController(
        deployer,
        {networkId: POLYGON_NETWORK_ID, tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
      );
      const platformAdapter = await AdaptersHelper.createCompound3PlatformAdapter(
        deployer,
        controller.address,
        ethers.Wallet.createRandom().address,
        [MaticAddresses.COMPOUND3_COMET_USDC],
        MaticAddresses.COMPOUND3_COMET_REWARDS
      );
      await expect(platformAdapter.removeComet(7)).revertedWith("TC-29 incorrect value"); // AppErrors.INCORRECT_VALUE
    });
    it("should throw if not governance", async () => {
      const controller = await TetuConverterApp.createController(
        deployer,
        {networkId: POLYGON_NETWORK_ID, tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
      );
      const platformAdapter = await AdaptersHelper.createCompound3PlatformAdapter(
        deployer,
        controller.address,
        ethers.Wallet.createRandom().address,
        [MaticAddresses.COMPOUND3_COMET_USDC],
        MaticAddresses.COMPOUND3_COMET_REWARDS
      );
      const newComet = ethers.Wallet.createRandom().address;
      await platformAdapter.addComet(newComet);
      await expect(
        platformAdapter.connect(await Misc.impersonate(ethers.Wallet.createRandom().address)).removeComet(0)
      ).revertedWith("TC-9 governance only"); // AppErrors.GOVERNANCE_ONLY
    });
  });
  describe("add comet", () => {
    it("should throw if not governance", async () => {
      const controller = await TetuConverterApp.createController(
        deployer,
        {networkId: POLYGON_NETWORK_ID, tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
      );
      const platformAdapter = await AdaptersHelper.createCompound3PlatformAdapter(
        deployer,
        controller.address,
        ethers.Wallet.createRandom().address,
        [MaticAddresses.COMPOUND3_COMET_USDC],
        MaticAddresses.COMPOUND3_COMET_REWARDS
      );
      const newComet = ethers.Wallet.createRandom().address;
      await expect(
        platformAdapter.connect(await Misc.impersonate(ethers.Wallet.createRandom().address)).addComet(newComet)
      ).revertedWith("TC-9 governance only"); // AppErrors.GOVERNANCE_ONLY
    });
  });

  describe("platformKind", () => {
    it("should return expected values", async () => {
      const controller = await TetuConverterApp.createController(deployer, {networkId: POLYGON_NETWORK_ID,});
      const pa = await AdaptersHelper.createCompound3PlatformAdapter(
        deployer,
        controller.address,
        ethers.Wallet.createRandom().address,
        [MaticAddresses.COMPOUND3_COMET_USDC],
        MaticAddresses.COMPOUND3_COMET_REWARDS
      )
      expect( (await pa.platformKind())).eq(5); // LendingPlatformKinds.COMPOUND3_5
    });
  });
})