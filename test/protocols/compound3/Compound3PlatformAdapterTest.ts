/* tslint:disable:no-trailing-whitespace */
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";
import {
  Compound3AprLibFacade,
  Compound3PlatformAdapter,
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
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {ICompound3AssetInfo} from "../../../scripts/integration/helpers/Compound3Helper";
import {convertUnits} from "../../baseUT/apr/aprUtils";
import {areAlmostEqual} from "../../baseUT/utils/CommonUtils";
import {addLiquidatorPath} from "../../baseUT/utils/TetuLiquidatorUtils";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {parseUnits} from "ethers/lib/utils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {Compound3ChangePriceUtils} from "../../baseUT/protocols/compound3/Compound3ChangePriceUtils";


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
    const platformAdapter = await AdaptersHelper.createCompound3PlatformAdapter(
      deployer,
      controller.address,
      ethers.Wallet.createRandom().address,
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
    console.log("priceBorrow", priceBorrow.toString());
    console.log("priceCollateral", priceCollateral.toString());
    console.log("priceBorrow18", priceBorrow36.toString());
    console.log("priceCollateral18", priceCollateral36.toString());

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
      collateralAssetInfo,
    }
  }

  async function makeTestComparePlanWithDirectCalculations(
    controller: ConverterController,
    collateralAsset: string,
    collateralAmount: BigNumber,
    borrowAsset: string,
    badPathsParams?: IGetConversionPlanBadPaths
  ): Promise<{ sret: string, sexpected: string }> {
    console.log("makeTestComparePlanWithDirectCalculations collateralAmount", collateralAmount.toString());
    const d = await preparePlan(
      controller,
      collateralAsset,
      collateralAmount,
      borrowAsset,
      badPathsParams
    );
    // console.log("getConversionPlan", d.plan);
    console.log("getConversionPlan liquidationThreshold18", d.plan.liquidationThreshold18.toString());
    console.log("getConversionPlan ltv18", d.plan.ltv18.toString());
    console.log("getConversionPlan collateralAmount", d.plan.collateralAmount.toString());
    console.log("getConversionPlan amountToBorrow", d.plan.amountToBorrow.toString());
    console.log("getConversionPlan borrowCost36", d.plan.borrowCost36.toString());
    console.log("getConversionPlan rewardsAmountInBorrowAsset36", d.plan.rewardsAmountInBorrowAsset36.toString());
    console.log("getConversionPlan maxAmountToBorrow", d.plan.maxAmountToBorrow.toString());
    console.log("getConversionPlan maxAmountToSupply", d.plan.maxAmountToSupply.toString());

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

    const libFacade = await DeployUtils.deployContract(deployer, "Compound3AprLibFacade") as Compound3AprLibFacade
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

    const sret = [
      d.plan.borrowCost36,
      areAlmostEqual(d.plan.rewardsAmountInBorrowAsset36, rewardsAmountInBorrowAsset36, 7),
      d.plan.maxAmountToBorrow,
      d.plan.maxAmountToSupply,
      d.plan.ltv18,
      d.plan.liquidationThreshold18,
      d.plan.collateralAmount,
      d.plan.amountToBorrow,
      areAlmostEqual(d.plan.amountCollateralInBorrowAsset36, amountCollateralInBorrowAsset36)
    ].map(x => BalanceUtils.toString(x)).join("\n");

    const sexpected = [
      borrowCost36,
      true,
      await (await IERC20__factory.connect(borrowAsset, deployer)).balanceOf(d.comet.address),
      d.collateralAssetInfo ? d.collateralAssetInfo.supplyCap.sub(await (await IERC20__factory.connect(collateralAsset, deployer)).balanceOf(d.comet.address)) : BigNumber.from(0),
      d.collateralAssetInfo ? d.collateralAssetInfo.borrowCollateralFactor : BigNumber.from(0),
      d.collateralAssetInfo ? d.collateralAssetInfo.liquidateCollateralFactor : BigNumber.from(0),
      collateralAmount,
      amountToBorrow,
      true,
    ].map(x => BalanceUtils.toString(x)).join("\n");

    return {sret, sexpected};
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

        const ret = [
          await r.platformAdapter.controller(),
          await r.platformAdapter.converter(),
          (await r.platformAdapter.converters()).join(),
        ].join("\n");

        const expected = [
          r.data.controller,
          r.data.converter,
          [r.data.converter].join(),
        ].join("\n");

        expect(ret).eq(expected);
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

          const ret = await makeTestComparePlanWithDirectCalculations(
            controller,
            collateralAsset,
            collateralAmount,
            borrowAsset,
          );
          console.log(ret);

          expect(ret.sret).eq(ret.sexpected);
        })
      })
      describe("WBTC : USDC", () => {
        it("should return expected values", async () => {
          if (!await isPolygonForkInUse()) return;

          const collateralAsset = MaticAddresses.WBTC;
          const borrowAsset = MaticAddresses.USDC;

          const collateralAmount = getBigNumberFrom(10, 8);

          const ret = await makeTestComparePlanWithDirectCalculations(
            controller,
            collateralAsset,
            collateralAmount,
            borrowAsset,
          );
          console.log(ret);

          expect(ret.sret).eq(ret.sexpected);
        })
      })
      describe("WMATIC : USDC", () => {
        it("should return expected values", async () => {
          if (!await isPolygonForkInUse()) return;

          const collateralAsset = MaticAddresses.WMATIC;
          const borrowAsset = MaticAddresses.USDC;

          const collateralAmount = getBigNumberFrom(10000, 18);

          const ret = await makeTestComparePlanWithDirectCalculations(
            controller,
            collateralAsset,
            collateralAmount,
            borrowAsset,
          );
          console.log(ret);

          expect(ret.sret).eq(ret.sexpected);
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

})