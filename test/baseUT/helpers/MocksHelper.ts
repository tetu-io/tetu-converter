/**
 * Help to initialize and setup Borrow Manager and related classes
 */
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BigNumber, Signer} from "ethers";
import {ethers} from "hardhat";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {
  Aave3PriceOracleMock,
  Borrower,
  BorrowManagerStub,
  CTokenMock,
  IController,
  LendingPlatformMock,
  MockERC20,
  PoolAdapterMock,
  PoolAdapterStub,
  DebtsMonitorStub,
  PoolStub,
  PlatformAdapterStub,
  DForceInterestRateModelMock,
  PriceOracleMock,
  BorrowManager__factory,
  IBorrowManager,
  BorrowManager
} from "../../../typechain";
import {IPoolInfo} from "./BorrowManagerHelper";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {IAssetPair} from "../utils/AssetPairUtils";

export interface IPooAdapterStabInitParams {
  controller: string;
  pool: string;
  user: string;
  collateralAsset: string;
  borrowAsset: string;
  origin: string;
  cTokenAddress: string;
  collateralFactor: BigNumber;
  borrowRatePerBlock: BigNumber;
  priceOracle: string;
}

/** Helper to create mock contracts */
export class MocksHelper {
//region Adapters
  /** Create template pool adapter */
  public static async createPoolAdapterMock(signer: SignerWithAddress) : Promise<PoolAdapterMock> {
    return (await DeployUtils.deployContract(signer, "PoolAdapterMock")) as PoolAdapterMock;
  }

  /** Create platform adapter that supports a single pool with set of the given assets */
  public static async createPlatformAdapterMock(
    signer: SignerWithAddress
    , pool: string
    , controllerAddress: string
    , priceOracleAddress: string
    , converters: string[]
    , assets: string[]
    , cTokens: string[]
    , liquidity: BigNumber[]
    , borrowRates?: BigNumber[]
    , collateralFactors?: number[]
  ) : Promise<LendingPlatformMock> {
    const platformAdapter = (await DeployUtils.deployContract(
      signer,
      "LendingPlatformMock",
      controllerAddress,
      pool,
      priceOracleAddress,
      converters,
      assets,
      cTokens,
      liquidity
    )) as LendingPlatformMock;

    if (borrowRates) {
      await platformAdapter.setBorrowRates(assets, borrowRates);
    }

    if (collateralFactors) {
      // we cannot pass 0.8 to mul, we will have https://links.ethers.org/v5-errors-NUMERIC_FAULT-underflow
      // so:  0.8 => 80 and reduce decimals 18 => 16
      const cfs = collateralFactors.map(x => (BigNumber.from(10).pow(16)).mul(x * 100));
      await platformAdapter.setLiquidationThresholds(assets, cfs);
    }

    return platformAdapter;
  }

  /** Simple mock - all params are set through constructor */
  public static async createPoolAdapterStub(
    signer: SignerWithAddress,
    collateralFactorValue: BigNumber,
    initParams?: IPooAdapterStabInitParams
  ) : Promise<PoolAdapterStub> {
    const dest = (await DeployUtils.deployContract(signer
      , "PoolAdapterStub"
      , collateralFactorValue
    )) as PoolAdapterStub;

    if (initParams) {
      await dest.initialize(
        initParams.controller,
        initParams.pool,
        initParams.user,
        initParams.collateralAsset,
        initParams.borrowAsset,
        initParams.origin,
        initParams.cTokenAddress,
        initParams.collateralFactor,
        initParams.borrowRatePerBlock,
        initParams.priceOracle
      );
    }

    return dest;
  }
//endregion Adapters

//region Tokens
  public static async createTokens(decimals: number[]) : Promise<MockERC20[]> {
    const dest: MockERC20[] = [];

    for (let i = 0; i < decimals.length; ++i) {
      const d = decimals[i];
      const fabric = await ethers.getContractFactory('MockERC20');
      const token = await fabric.deploy(`MockToken-${i}-${d}`, `MockToken-${i}-${d}`, d);
      dest.push(token);
    }

    return dest;
  }
//endregion Tokens

//region Pools
  public static async createPoolStub(
    signer: SignerWithAddress
  ) : Promise<PoolStub> {
    return await DeployUtils.deployContract(
      signer
      , "PoolStub"
    ) as PoolStub;
  }

  /**
   * Generate single platform adapter (with attached pool).
   * Register the platform adapter in the borrow manager.
   */
  public static async addMockPool(
    signer: SignerWithAddress,
    controller: IController,
    pool: PoolStub,
    poolsInfo: IPoolInfo,
    collateralFactors: number[],
    assets: MockERC20[],
    cTokens: MockERC20[],
    prices: BigNumber[],
    templateAdapterPoolOptional?: string,
  ) : Promise <{
    platformAdapter: LendingPlatformMock,
    templatePoolAdapter: string
  }>{
    const borrowRates = await Promise.all(assets.map(
      async (token, index) => {
        const br = poolsInfo.borrowRateInTokens[index];
        return typeof br === "object"
          ? br
          : getBigNumberFrom(
            poolsInfo.borrowRateInTokens[index],
            await assets[index].decimals()
          );
      }
    ));
    const availableLiquidity = await Promise.all(assets.map(
      async (token, index) => getBigNumberFrom(
        poolsInfo.availableLiquidityInTokens[index],
        await assets[index].decimals()
      )
    ));

    const templatePoolAdapter = templateAdapterPoolOptional
      || (await MocksHelper.createPoolAdapterStub(signer, getBigNumberFrom(1))).address;

    const priceOracle = (await DeployUtils.deployContract(signer, "PriceOracleMock"
      , assets ? assets.map(x => x.address) : []
      , prices || []
    )) as PriceOracleMock;

    const platformAdapter = await MocksHelper.createPlatformAdapterMock(
      signer,
      pool.address,
      controller.address,
      priceOracle.address,
      [templatePoolAdapter],
      assets.map(x => x.address),
      cTokens.map(x => x.address),
      availableLiquidity,
      borrowRates,
      collateralFactors,
    );

    await this.registerAllAssetPairs(
      platformAdapter.address,
      BorrowManager__factory.connect(await controller.borrowManager(), signer),
      assets.map(x => x.address)
    );

    return {platformAdapter, templatePoolAdapter};
  }

  static async registerAllAssetPairs(platformAdapter: string, borrowManager: BorrowManager, assets: string[]) {
    // generate all possible pairs of assets
    const left: string[] = [];
    const right: string[] = [];
    for (let i = 0; i < assets.length; ++i) {
      for (let j = i + 1; j < assets.length; ++j) {
        left.push(assets[i]);
        right.push(assets[j]);
      }
    }

    await borrowManager.addAssetPairs(platformAdapter, left, right);
  }
//endregion Pools

//region Core contracts
  public static async createBorrowManagerStub(
    signer: SignerWithAddress,
    valueIsPoolAdapter: boolean
  ) : Promise<BorrowManagerStub> {
    return await DeployUtils.deployContract(
      signer
      , "BorrowManagerStub"
      , valueIsPoolAdapter
    ) as BorrowManagerStub;
  }

  public static async createDebtsMonitorStub(
    signer: SignerWithAddress,
    valueIsConverterInUse: boolean
  ) : Promise<DebtsMonitorStub> {
    return await DeployUtils.deployContract(
      signer
      , "DebtsMonitorStub"
      , valueIsConverterInUse
    ) as DebtsMonitorStub;
  }

  public static async createPlatformAdapterStub(
    signer: SignerWithAddress,
    converters: string[]
  ) : Promise<PlatformAdapterStub> {
    return await DeployUtils.deployContract(
      signer
      , "PlatformAdapterStub"
      , converters
    ) as PlatformAdapterStub;
  }
//endregion Core contracts

//region Uses cases
  public static async deployBorrower(
    deployer: string,
    controller: IController,
    healthFactor2: number,
    periodInBlocks: number
  ) : Promise<Borrower> {
    return (await DeployUtils.deployContract(
      await DeployerUtils.startImpersonate(deployer),
      "Borrower",
      controller.address,
      healthFactor2,
      periodInBlocks
    )) as Borrower;
  }
//endregion Uses cases

//region Price mocks
  public static async createAave3PriceOracleMock(
    signer: SignerWithAddress,
    addressProvider: string,
    baseCurrency: string,
    baseCurrencyUnit: BigNumber,
    fallbackOracle: string
  ) : Promise<Aave3PriceOracleMock> {
    return await DeployUtils.deployContract(
      signer
      , "Aave3PriceOracleMock"
      , addressProvider
      , baseCurrency
      , baseCurrencyUnit
      , fallbackOracle
    ) as Aave3PriceOracleMock;
  }

  public static async createAave2PriceOracleMock(
    signer: SignerWithAddress,
    owner: string,
    weth: string,
    fallbackOracle: string
  ) : Promise<Aave3PriceOracleMock> {
    return await DeployUtils.deployContract(
      signer
      , "Aave2PriceOracleMock"
      , owner
      , weth
      , fallbackOracle
    ) as Aave3PriceOracleMock;
  }
//endregion Price mocks

//region DForce mocks
  public static async createDForceInterestRateModelMock(
    signer: SignerWithAddress,
    cash1: BigNumber,
    borrowRate1: BigNumber,
    cash2: BigNumber,
    borrowRate2: BigNumber
  ) : Promise<DForceInterestRateModelMock> {
    return await DeployUtils.deployContract(
      signer
      , "DForceInterestRateModelMock"
      , cash1
      , borrowRate1
      , cash2
      , borrowRate2
    ) as DForceInterestRateModelMock;
  }

//endregion DForce mocks

//region Batch functions
  public static async createAssets(countAssets: number) : Promise<MockERC20[]> {
    return await Promise.all(
      [...Array(countAssets).keys()].map(
        async _ => (await MocksHelper.createTokens([18]))[0]
      )
    );
  }

  public static async createConverters(signer: SignerWithAddress, countConverters: number) : Promise<PoolAdapterStub[]> {
    return await Promise.all(
      [...Array(countConverters).keys()].map(
        async x => await MocksHelper.createPoolAdapterStub(signer, getBigNumberFrom(1))
      )
    );
  }

  public static async createCTokensMocks(
    signer: SignerWithAddress,
    assets: string[],
    decimals: number[]
  ) : Promise<CTokenMock[]> {
    const dest: CTokenMock[] = [];

    for (let i = 0; i < decimals.length; ++i) {
      const d = decimals[i];
      const token = await DeployUtils.deployContract(
        signer
        , "CTokenMock"
        , `cToken-${i}-${d}`
        , `cToken-${i}-${d}`
        , d
        , assets[i]
      ) as CTokenMock;
      dest.push(token);
    }

    return dest;
  }


//endregion Batch functions
}