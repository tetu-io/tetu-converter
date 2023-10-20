import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {HARDHAT_NETWORK_ID, HardhatUtils, } from "../../../../scripts/utils/HardhatUtils";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {DeployUtils} from "../../../../scripts/utils/DeployUtils";
import {CompoundCTokenBaseMock, MockERC20, CompoundInterestRateModelMock, IERC20Metadata__factory, CompoundAprLibFacade,} from "../../../../typechain";
import {expect} from "chai";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {MocksHelper} from "../../../baseUT/app/MocksHelper";

describe("CompoundAprLibTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let deployer: SignerWithAddress;
  let facade: CompoundAprLibFacade;
  let usdc: MockERC20;
  let usdt: MockERC20;
  let dai: MockERC20;
  let weth: MockERC20;

  let cUsdc: CompoundCTokenBaseMock;
  let cUsdt: CompoundCTokenBaseMock;
  let cDai: CompoundCTokenBaseMock;
  let cWeth: CompoundCTokenBaseMock;

//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(HARDHAT_NETWORK_ID);
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
    facade = await DeployUtils.deployContract(deployer, "CompoundAprLibFacade") as CompoundAprLibFacade;

    usdc = await DeployUtils.deployContract(deployer, 'MockERC20', 'USDC', 'USDC', 6) as MockERC20;
    usdt = await DeployUtils.deployContract(deployer, 'MockERC20', 'USDT', 'USDT', 6) as MockERC20;
    dai = await DeployUtils.deployContract(deployer, 'MockERC20', 'Dai', 'DAI', 18) as MockERC20;
    weth = await DeployUtils.deployContract(deployer, 'MockERC20', 'Wrapped Ether', 'WETH', 18) as MockERC20;

    cUsdc = await MocksHelper.createCompoundCTokenBaseMock(deployer, "cUsdc", 18);
    await cUsdc.setUnderlying(usdc.address);
    cUsdt = await MocksHelper.createCompoundCTokenBaseMock(deployer, "cUsdt", 18);
    await cUsdt.setUnderlying(usdt.address);
    cDai = await MocksHelper.createCompoundCTokenBaseMock(deployer, "cDai", 18)
    await cDai.setUnderlying(dai.address);
    cWeth = await MocksHelper.createCompoundCTokenBaseMock(deployer, "cWeth", 18)
    await cWeth.setUnderlying(weth.address);
  });

  after(async function () {
    await TimeUtils.rollback(snapshot);
  });

//endregion before, after

//region Unit tests
  describe("getCore", () => {
    interface IGetCoreParams {
      cTokenCollateral: CompoundCTokenBaseMock;
      cTokenBorrow: CompoundCTokenBaseMock;
      nativeToken: MockERC20;
      cTokenNative: CompoundCTokenBaseMock;
    }
    interface IGetCoreResults {
      cTokenCollateral: string;
      cTokenBorrow: string;
      collateralAsset: string;
      borrowAsset: string;
    }

    async function getCore(p: IGetCoreParams): Promise<IGetCoreResults> {
      return facade.getCore(
        {
          cTokenNative: p.cTokenNative.address,
          nativeToken: p.nativeToken.address,
          compoundStorageVersion: 0 // not used here
        },
        p.cTokenCollateral.address,
        p.cTokenBorrow.address
      )
    }

    describe("not native tokens", () => {
      let snapshotLocal: string;
      before(async function () {
        snapshotLocal = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshotLocal);
      });

      async function getCoreTest(): Promise<IGetCoreResults> {
        return getCore({
          cTokenNative: cWeth,
          cTokenCollateral: cUsdt,
          cTokenBorrow: cUsdc,
          nativeToken: weth
        });
      }

      it("should return expected assets", async () => {
        const ret = await loadFixture(getCoreTest);
        expect([ret.borrowAsset, ret.collateralAsset].join()).eq([usdc.address, usdt.address].join());
      });
      it("should return expected cTokens", async () => {
        const ret = await loadFixture(getCoreTest);
        expect([ret.cTokenBorrow, ret.cTokenCollateral].join()).eq([cUsdc.address, cUsdt.address].join());
      });
    });
  });


  describe("getBorrowCost36", () => {
    let snapshotLocal: string;
    before(async function () {
      snapshotLocal = await TimeUtils.snapshot();
    });
    after(async function () {
      await TimeUtils.rollback(snapshotLocal);
    });

    interface IGetBorrowCostParams {
      borrowRatePerBlock: string;
      countBlocks: number;
      borrowedAmount: string;
      borrowDecimals: number;
    }
    interface IGetBorrowCostResults {
      borrowCost: number;
    }

    async function getBorrowCost36(p: IGetBorrowCostParams): Promise<IGetBorrowCostResults> {
      const borrowCost = await facade.getBorrowCost36(
        parseUnits(p.borrowRatePerBlock, 18),
        parseUnits(p.borrowedAmount, p.borrowDecimals),
        p.countBlocks,
        parseUnits("1", p.borrowDecimals),
      );
      return {
        borrowCost: +formatUnits(borrowCost, 36)
      };
    }

    it("should return expected value", async () => {
      const {borrowCost} = await getBorrowCost36({
        borrowRatePerBlock: "3",
        borrowedAmount: "2",
        countBlocks: 21,
        borrowDecimals: 7
      });
      expect(borrowCost).eq(3 * 21 * 2);
    });
  });

  describe("getSupplyIncomeInBorrowAsset36", () => {
    let snapshotLocal: string;
    before(async function () {
      snapshotLocal = await TimeUtils.snapshot();
    });
    after(async function () {
      await TimeUtils.rollback(snapshotLocal);
    });

    interface IParams {
      supplyRatePerBlock: string;
      countBlocks: number;
      collateralAmount: string;
      collateralDecimals: number;
      priceCollateral: string;
      priceBorrow: string;
    }
    interface IResults {
      supplyIncomInBorrowAsset: number;
    }

    async function getSupplyIncomeInBorrowAsset36(p: IParams): Promise<IResults> {
      const borrowCost = await facade.getSupplyIncomeInBorrowAsset36(
        parseUnits(p.supplyRatePerBlock, 18),
        p.countBlocks,
        parseUnits("1", p.collateralDecimals),
        parseUnits(p.priceCollateral, 18),
        parseUnits(p.priceBorrow, 18),
        parseUnits(p.collateralAmount, p.collateralDecimals),
      );
      return {
        supplyIncomInBorrowAsset: +formatUnits(borrowCost, 36)
      };
    }

    it("should return expected value", async () => {
      const {supplyIncomInBorrowAsset} = await getSupplyIncomeInBorrowAsset36({
        supplyRatePerBlock: "3",
        collateralAmount: "2",
        countBlocks: 21,
        collateralDecimals: 7,
        priceCollateral: "10",
        priceBorrow: "4",
      });
      expect(supplyIncomInBorrowAsset).eq(3 * 21 * 2 * 10 / 4);
    });
  });

  describe("getEstimatedBorrowRate", () => {
    let snapshotLocal: string;
    before(async function () {
      snapshotLocal = await TimeUtils.snapshot();
    });
    after(async function () {
      await TimeUtils.rollback(snapshotLocal);
    });

    interface IGetEstimatedBorrowRateParams {
      cTokenToBorrow: CompoundCTokenBaseMock;
      amountToBorrow: string;

      cash: string;
      borrows: string;
      reserves: string;

      InterestRateModel: {
        cash: string;
        borrows: string;
        reserves: string;
        rate: string;
      }
    }
    interface IGetEstimatedBorrowRateResults {
      rate: number;
    }

    async function getEstimatedBorrowRate(p: IGetEstimatedBorrowRateParams): Promise<IGetEstimatedBorrowRateResults> {
      const decimalsBorrow = await IERC20Metadata__factory.connect(await p.cTokenToBorrow.underlying(), deployer).decimals();

      const model = await DeployUtils.deployContract(deployer, 'CompoundInterestRateModelMock') as CompoundInterestRateModelMock;
      await model.setExpectedBorrowRate(
        parseUnits(p.InterestRateModel.cash, decimalsBorrow),
        parseUnits(p.InterestRateModel.borrows, decimalsBorrow),
        parseUnits(p.InterestRateModel.reserves, decimalsBorrow),
        parseUnits(p.InterestRateModel.rate, 7)
      );

      await p.cTokenToBorrow.setCash(parseUnits(p.cash, decimalsBorrow));
      await p.cTokenToBorrow.setTotalBorrows(parseUnits(p.borrows, decimalsBorrow));
      await p.cTokenToBorrow.setTotalReserves(parseUnits(p.reserves, decimalsBorrow));

      const rate = await facade.getEstimatedBorrowRate(
        model.address,
        p.cTokenToBorrow.address,
        parseUnits(p.amountToBorrow, decimalsBorrow)
      );
      return {
        rate: +formatUnits(rate, 7)
      };
    }

    it("should return expected value", async () => {
      const {rate} = await getEstimatedBorrowRate({
        cTokenToBorrow: cWeth,
        amountToBorrow: "11",

        cash: "1011",
        borrows: "500",
        reserves: "2000",

        InterestRateModel: {
          cash: "1000",
          borrows: "511",
          reserves: "2000",
          rate: "7"
        }
      });
      expect(rate).eq(7);
    });
  });

  describe("getEstimatedSupplyRate", () => {
    let snapshotLocal: string;
    before(async function () {
      snapshotLocal = await TimeUtils.snapshot();
    });
    after(async function () {
      await TimeUtils.rollback(snapshotLocal);
    });

    interface IGetEstimatedSupplyRateParams {
      cTokenToSupply: CompoundCTokenBaseMock;
      amountToSupply: string;

      cash: string;
      borrows: string;
      reserves: string;
      reserveFactorMantissa: string;

      InterestRateModel: {
        cash: string;
        borrows: string;
        reserves: string;
        reserveFactorMantissa: string;
        rate: string;
      }
    }
    interface IGetEstimatedSupplyRateResults {
      rate: number;
    }

    async function getEstimatedSupplyRate(p: IGetEstimatedSupplyRateParams): Promise<IGetEstimatedSupplyRateResults> {
      const decimalsCollateral = await IERC20Metadata__factory.connect(await p.cTokenToSupply.underlying(), deployer).decimals();

      const model = await DeployUtils.deployContract(deployer, 'CompoundInterestRateModelMock') as CompoundInterestRateModelMock;
      await model.setExpectedSupplyRate(
        parseUnits(p.InterestRateModel.cash, decimalsCollateral),
        parseUnits(p.InterestRateModel.borrows, decimalsCollateral),
        parseUnits(p.InterestRateModel.reserves, decimalsCollateral),
        parseUnits(p.InterestRateModel.reserveFactorMantissa, decimalsCollateral),
        parseUnits(p.InterestRateModel.rate, 7)
      );

      await p.cTokenToSupply.setCash(parseUnits(p.cash, decimalsCollateral));
      await p.cTokenToSupply.setTotalBorrows(parseUnits(p.borrows, decimalsCollateral));
      await p.cTokenToSupply.setTotalReserves(parseUnits(p.reserves, decimalsCollateral));
      await p.cTokenToSupply.setReserveFactorMantissa(parseUnits(p.reserveFactorMantissa, decimalsCollateral));

      const rate = await facade.getEstimatedSupplyRate(
        model.address,
        p.cTokenToSupply.address,
        parseUnits(p.amountToSupply, decimalsCollateral)
      );
      return {
        rate: +formatUnits(rate, 7)
      };
    }

    it("should return expected value", async () => {
      const {rate} = await getEstimatedSupplyRate({
        cTokenToSupply: cWeth,
        amountToSupply: "11",

        cash: "1000",
        borrows: "500",
        reserves: "2000",
        reserveFactorMantissa: "41",

        InterestRateModel: {
          cash: "1011",
          borrows: "500",
          reserves: "2000",
          reserveFactorMantissa: "41",
          rate: "7"
        }
      });
      expect(rate).eq(7);
    });
  });

  describe("getRawCostAndIncomes", () => {
    let snapshotLocal: string;
    before(async function () {
      snapshotLocal = await TimeUtils.snapshot();
    });
    after(async function () {
      await TimeUtils.rollback(snapshotLocal);
    });

    interface IGetRawCostAndIncomesParams {
      cTokenToBorrow: CompoundCTokenBaseMock;
      cTokenToSupply: CompoundCTokenBaseMock;
      collateralAmount: string;
      borrowAmount: string;
      countBlocks: number;
      collateralPrice: string;
      borrowPrice: string;

      borrowToken: {
        cash: string;
        borrows: string;
        reserves: string;
      }
      collateralToken: {
        cash: string;
        borrows: string;
        reserves: string;
        reserveFactorMantissa: string;
      }

      InterestRateModelForSupply: {
        cash: string;
        borrows: string;
        reserves: string;
        reserveFactorMantissa: string;
        rate: string;
      }
      InterestRateModelForBorrow: {
        cash: string;
        borrows: string;
        reserves: string;
        reserveFactorMantissa: string;
        rate: string;
      }
    }
    interface IGetRawCostAndIncomesResults {
      borrowCost: number;
      supplyIncomeInBorrowAsset: number;
    }

    async function getRawCostAndIncomes(p: IGetRawCostAndIncomesParams): Promise<IGetRawCostAndIncomesResults> {
      const decimalsCollateral = await IERC20Metadata__factory.connect(await p.cTokenToSupply.underlying(), deployer).decimals();
      const decimalsBorrow = await IERC20Metadata__factory.connect(await p.cTokenToBorrow.underlying(), deployer).decimals();

      const model = await DeployUtils.deployContract(deployer, 'CompoundInterestRateModelMock') as CompoundInterestRateModelMock;
      await model.setExpectedBorrowRate(
        parseUnits(p.InterestRateModelForBorrow.cash, decimalsBorrow),
        parseUnits(p.InterestRateModelForBorrow.borrows, decimalsBorrow),
        parseUnits(p.InterestRateModelForBorrow.reserves, decimalsBorrow),
        parseUnits(p.InterestRateModelForBorrow.rate, 18)
      );
      await model.setExpectedSupplyRate(
        parseUnits(p.InterestRateModelForSupply.cash, decimalsCollateral),
        parseUnits(p.InterestRateModelForSupply.borrows, decimalsCollateral),
        parseUnits(p.InterestRateModelForSupply.reserves, decimalsCollateral),
        parseUnits(p.InterestRateModelForSupply.reserveFactorMantissa, decimalsCollateral),
        parseUnits(p.InterestRateModelForSupply.rate, 18)
      );

      await p.cTokenToBorrow.setCash(parseUnits(p.borrowToken.cash, decimalsBorrow));
      await p.cTokenToBorrow.setTotalBorrows(parseUnits(p.borrowToken.borrows, decimalsBorrow));
      await p.cTokenToBorrow.setTotalReserves(parseUnits(p.borrowToken.reserves, decimalsBorrow));
      await p.cTokenToBorrow.setInterestRateModel(model.address);

      await p.cTokenToSupply.setCash(parseUnits(p.collateralToken.cash, decimalsCollateral));
      await p.cTokenToSupply.setTotalBorrows(parseUnits(p.collateralToken.borrows, decimalsCollateral));
      await p.cTokenToSupply.setTotalReserves(parseUnits(p.collateralToken.reserves, decimalsCollateral));
      await p.cTokenToSupply.setReserveFactorMantissa(parseUnits(p.collateralToken.reserveFactorMantissa, decimalsCollateral));
      await p.cTokenToSupply.setInterestRateModel(model.address);

      const ret = await facade.getRawCostAndIncomes(
        {
          cTokenCollateral: p.cTokenToSupply.address,
          cTokenBorrow: p.cTokenToBorrow.address,
          collateralAsset: await p.cTokenToSupply.underlying(),
          borrowAsset: await p.cTokenToBorrow.underlying()
        },
        parseUnits(p.collateralAmount, decimalsCollateral),
        p.countBlocks,
        parseUnits(p.borrowAmount, decimalsBorrow),
        {
          priceBorrow: parseUnits(p.borrowPrice, 18),
          priceCollateral: parseUnits(p.collateralPrice, 18),
          rb10powDec: parseUnits("1", decimalsBorrow),
          rc10powDec: parseUnits("1", decimalsCollateral),
        }
      );
      return {
        borrowCost: +formatUnits(ret.borrowCost36, 36),
        supplyIncomeInBorrowAsset: +formatUnits(ret.supplyIncomeInBorrowAsset36, 36),
      };
    }

    it("should return expected values", async () => {
      const ret = await getRawCostAndIncomes({
        cTokenToBorrow: cUsdt,
        cTokenToSupply: cWeth,
        collateralAmount: "31",
        borrowAmount: "17",
        countBlocks: 55,
        borrowPrice: "3",
        collateralPrice: "4",

        collateralToken: {
          cash: "1000",
          borrows: "500",
          reserves: "2000",
          reserveFactorMantissa: "41",
        },

        borrowToken: {
          cash: "1000",
          borrows: "500",
          reserves: "2000",
        },

        InterestRateModelForBorrow: {
          cash: "983",
          borrows: "517",
          reserves: "2000",
          reserveFactorMantissa: "41",
          rate: "213"
        },

        InterestRateModelForSupply: {
          cash: "1031",
          borrows: "500",
          reserves: "2000",
          reserveFactorMantissa: "41",
          rate: "237"
        },
      });

      expect(
        [ret.borrowCost, ret.supplyIncomeInBorrowAsset].join()
      ).eq(
        [213 * 55 * 17, 237 * 55 * 31 * 4 / 3].join()
      );
    });
  });
});