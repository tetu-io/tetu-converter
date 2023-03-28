/* tslint:disable:no-trailing-whitespace */
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";
import {
  BorrowManager__factory,
  Compound3AprLibFacade,
  Compound3PlatformAdapter,
  Compound3PlatformAdapter__factory,
  ConverterController,
  IComet,
  IComet__factory, ICometRewards, ICometRewards__factory, IERC20__factory,
  IERC20Metadata__factory, IPriceFeed__factory
} from "../../../typechain";
import {TetuConverterApp} from "../../baseUT/helpers/TetuConverterApp";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {Misc} from "../../../scripts/utils/Misc";
import {AdaptersHelper} from "../../baseUT/helpers/AdaptersHelper";
import {expect} from "chai";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {BigNumber} from "ethers";
import {IConversionPlan} from "../../baseUT/apr/aprDataTypes";
import {AprUtils} from "../../baseUT/utils/aprUtils";
import {ICompound3AssetInfo} from "../../../scripts/integration/helpers/Compound3Helper";
import {convertUnits} from "../../baseUT/apr/aprUtils";
import {areAlmostEqual} from "../../baseUT/utils/CommonUtils";
import {addLiquidatorPath} from "../../baseUT/utils/TetuLiquidatorUtils";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {getAddress, parseUnits} from "ethers/lib/utils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {Compound3ChangePriceUtils} from "../../baseUT/protocols/compound3/Compound3ChangePriceUtils";
import {IPlatformActor, PredictBrUsesCase} from "../../baseUT/uses-cases/PredictBrUsesCase";


describe("Compound3PlatformAdapterTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
//endregion Global vars for all tests

//region before, after
  before(async function () {
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

//region IPlatformActor impl
  class Compound3PlatformActor implements IPlatformActor {
    comet: IComet;
    collateralAsset: string;

    constructor(
      comet: IComet,
      collateralAsset: string
    ) {
      this.comet = comet;
      this.collateralAsset = collateralAsset;
    }

    async getAvailableLiquidity() : Promise<BigNumber> {
      return IERC20__factory.connect(await this.comet.baseToken(), deployer).balanceOf(this.comet.address)
    }

    async getCurrentBR(): Promise<BigNumber> {
      const br = await this.comet.getBorrowRate(await this.comet.getUtilization())
      console.log(`BR=${br}`);
      return br;
    }

    async supplyCollateral(collateralAmount: BigNumber): Promise<void> {
      await IERC20Metadata__factory.connect(this.collateralAsset, deployer)
        .approve(this.comet.address, collateralAmount);
      console.log(`Supply collateral ${this.collateralAsset} amount ${collateralAmount}`);
      await this.comet.supply(this.collateralAsset, collateralAmount)
    }

    async borrow(borrowAmount: BigNumber): Promise<void> {
      await this.comet.withdraw(await this.comet.baseToken(), borrowAmount)
      console.log(`Borrow ${borrowAmount}`);
    }
  }
//endregion IPlatformActor impl

//region Test predict-br impl
  async function makePredictBrTest(
    collateralAsset: string,
    cometAddress: string,
    cometRewards: string,
    collateralHolders: string[],
    part10000: number
  ) : Promise<{br: BigNumber, brPredicted: BigNumber}> {
    const comet = IComet__factory.connect(cometAddress, deployer)
    return PredictBrUsesCase.makeTest(
      deployer,
      new Compound3PlatformActor(comet, collateralAsset),
      async controller => AdaptersHelper.createCompound3PlatformAdapter(
        deployer,
        controller.address,
        ethers.Wallet.createRandom().address,
        [comet.address],
        cometRewards
      ),
      collateralAsset,
      await comet.baseToken(),
      collateralHolders,
      part10000
    )
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
  }

  async function preparePlan(
    controller: ConverterController,
    collateralAsset: string,
    collateralAmount: BigNumber,
    borrowAsset: string,
    badPathsParams?: IGetConversionPlanBadPaths,
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
    }
    // console.log("priceBorrow", priceBorrow.toString());
    // console.log("priceCollateral", priceCollateral.toString());
    // console.log("priceBorrow18", priceBorrow36.toString());
    // console.log("priceCollateral18", priceCollateral36.toString());

    if (badPathsParams?.setSupplyPaused || badPathsParams?.setWithdrawPaused) {
      await Compound3ChangePriceUtils.setPaused(deployer, comet.address, !!badPathsParams?.setSupplyPaused, !!badPathsParams?.setWithdrawPaused)
    }

    const plan = await platformAdapter.getConversionPlan(
      {
        collateralAsset: badPathsParams?.zeroCollateralAsset ? Misc.ZERO_ADDRESS : collateralAsset,
        amountIn: badPathsParams?.zeroCollateralAmount ? 0 : collateralAmount,
        borrowAsset: badPathsParams?.zeroBorrowAsset ? Misc.ZERO_ADDRESS : borrowAsset,
        countBlocks: badPathsParams?.zeroCountBlocks ? 0 : countBlocks,
        entryData: entryData || "0x"
      },
      badPathsParams?.incorrectHealthFactor2 || healthFactor2,
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
    const libFacade = await DeployUtils.deployContract(deployer, "Compound3AprLibFacade") as Compound3AprLibFacade

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
        {tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
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
        if (!await isPolygonForkInUse()) return;

        const r = await initializePlatformAdapter();

        expect(await r.platformAdapter.controller()).eq(r.data.controller)
        expect(await r.platformAdapter.converter()).eq(r.data.converter)
        expect((await r.platformAdapter.converters()).join()).eq([r.data.converter].join())
      })
    })
    describe("Bad paths", () => {
      it("should revert if comets array length is zero", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          initializePlatformAdapter({zeroComets: true})
        ).revertedWith("TC-1 zero address");
      });
      it("should revert if cometRewards is zero", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          initializePlatformAdapter({zeroCometRewards: true})
        ).revertedWith("TC-1 zero address");
      });
      it("should revert if controller is zero", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          initializePlatformAdapter({zeroController: true})
        ).revertedWith("TC-1 zero address");
      });
      it("should revert if template normal is zero", async () => {
        if (!await isPolygonForkInUse()) return;
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
        {tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
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
          if (!await isPolygonForkInUse()) return;

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
          if (!await isPolygonForkInUse()) return;

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
          if (!await isPolygonForkInUse()) return;

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
          if (!await isPolygonForkInUse()) return;

          const r = await preparePlan(
            controller,
            MaticAddresses.WMATIC,
            parseUnits('20000000'),
            MaticAddresses.USDC
          )

          expect(r.plan.amountToBorrow).eq(r.plan.maxAmountToBorrow);
        })
        it("should return collateral amount equal to max collateral amount if borrow reserve is enough", async () => {
          if (!await isPolygonForkInUse()) return;

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
            if (!await isPolygonForkInUse()) return;

            await expect(
              tryGetConversionPlan({ zeroCollateralAsset: true })
            ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
          });
        });
        describe("borrow token is zero", () => {
          it("should revert", async () =>{
            if (!await isPolygonForkInUse()) return;

            await expect(
              tryGetConversionPlan({ zeroBorrowAsset: true })
            ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
          });
        });
        describe("healthFactor2_ is less than min allowed", () => {
          it("should revert", async () =>{
            if (!await isPolygonForkInUse()) return;

            await expect(
              tryGetConversionPlan({ incorrectHealthFactor2: 100 })
            ).revertedWith("TC-3 wrong health factor"); // WRONG_HEALTH_FACTOR
          });
        });
        describe("countBlocks_ is zero", () => {
          it("should revert", async () => {
            if (!await isPolygonForkInUse()) return;

            await expect(
              tryGetConversionPlan({ zeroCountBlocks: true })
            ).revertedWith("TC-29 incorrect value"); // INCORRECT_VALUE
          });
        });
        describe("collateralAmount_ is zero", () => {
          it("should revert", async () => {
            if (!await isPolygonForkInUse()) return;

            await expect(
              tryGetConversionPlan({ zeroCollateralAmount: true })
            ).revertedWith("TC-29 incorrect value"); // INCORRECT_VALUE
          });
        });
      });
      describe("asset is not registered", () => {
        it("should fail if collateral token is not registered", async () => {
          if (!await isPolygonForkInUse()) return;

          expect((await tryGetConversionPlan(
            {},
            MaticAddresses.agEUR
          )).converter).eq(Misc.ZERO_ADDRESS);
        });
        it("should fail if borrow token is not registered", async () => {
          if (!await isPolygonForkInUse()) return;

          expect((await tryGetConversionPlan(
            {},
            MaticAddresses.WETH,
            MaticAddresses.agEUR,
          )).converter).eq(Misc.ZERO_ADDRESS);
        });
      });
      describe("paused", () => {
        it("should fail if supplyPaused is true for collateral", async () => {
          if (!await isPolygonForkInUse()) return;
          expect((await tryGetConversionPlan({setSupplyPaused: true})).converter).eq(Misc.ZERO_ADDRESS);
        });
        it("should fail if withdrawPaused for borrow", async () => {
          if (!await isPolygonForkInUse()) return;
          expect((await tryGetConversionPlan({setWithdrawPaused: true})).converter).eq(Misc.ZERO_ADDRESS);
        });
      });
    })
  })

  describe("getBorrowRateAfterBorrow", () => {
    describe("Good paths", () => {
      describe("small amount WETH => USDC", () => {
        it("Predicted borrow rate should be same to real rate after the borrow", async () => {
          if (!await isPolygonForkInUse()) return;

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
            1
          )

          expect(areAlmostEqual(r.br, r.brPredicted, 4)).eq(true)
        })
      })
      describe("huge amount WETH => USDC", () => {
        it("Predicted borrow rate should be same to real rate after the borrow", async () => {
          if (!await isPolygonForkInUse()) return;

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
  })

  describe("initializePoolAdapter", () => {
    let controller: ConverterController;
    let snapshotLocal: string;
    before(async function () {
      snapshotLocal = await TimeUtils.snapshot();
      controller = await TetuConverterApp.createController(
        deployer,
        {tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
      );
    });
    after(async function () {
      await TimeUtils.rollback(snapshotLocal);
    });

    interface IInitializePoolAdapterBadPaths {
      useWrongConverter?: boolean;
      wrongCallerOfInitializePoolAdapter?: boolean;
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
      const borrowAsset = MaticAddresses.USDC;

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
        if (!await isPolygonForkInUse()) return;

        const r = await makeInitializePoolAdapterTest();
        expect(r.config.originConverter).eq(r.expectedConfig.originConverter)
        expect(r.config.user).eq(r.expectedConfig.user)
        expect(r.config.collateralAsset).eq(r.expectedConfig.collateralAsset)
        expect(r.config.borrowAsset).eq(r.expectedConfig.borrowAsset)
      });
    });
    describe("Bad paths", () => {
      it("should revert if converter address is not registered", async () => {
        if (!await isPolygonForkInUse()) return;

        await expect(
          makeInitializePoolAdapterTest(
            {useWrongConverter: true}
          )
        ).revertedWith("TC-25 converter not found"); // CONVERTER_NOT_FOUND
      });
      it("should revert if it's called by not borrow-manager", async () => {
        if (!await isPolygonForkInUse()) return;

        await expect(
          makeInitializePoolAdapterTest(
            {wrongCallerOfInitializePoolAdapter: true}
          )
        ).revertedWith("TC-45 borrow manager only"); // BORROW_MANAGER_ONLY
      });
    });
  })

  describe("setFrozen", () => {
    it("should assign expected value to frozen", async () => {
      const controller = await TetuConverterApp.createController(
        deployer,
        {tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
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
  })
})