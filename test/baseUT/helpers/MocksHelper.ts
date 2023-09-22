/**
 * Help to initialize and setup Borrow Manager and related classes
 */
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BigNumber, BigNumberish} from "ethers";
import {ethers} from "hardhat";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {
  Aave3PriceOracleMock,
  Borrower,
  BorrowManagerStub,
  CTokenMock,
  IConverterController,
  LendingPlatformMock,
  MockERC20,
  PoolAdapterMock,
  PoolAdapterStub,
  DebtMonitorStub,
  PoolStub,
  PlatformAdapterStub,
  DForceInterestRateModelMock,
  PriceOracleMock,
  BorrowManager__factory,
  BorrowManager,
  TetuLiquidatorMock,
  SwapManagerMock,
  ConverterUnknownKind,
  KeeperMock,
  KeeperCaller,
  DebtMonitorCheckHealthMock,
  KeeperCallbackMock,
  DebtMonitorMock,
  Aave3PoolMock,
  AaveTwoPoolMock,
  TokenAddressProviderMock,
  DForceControllerMock,
  DForceCTokenMock,
  HfComptrollerMock,
  HfCTokenMock,
  PriceOracleStub,
  EntryKindsFacade,
  SwapLibFacade,
  PoolAdapterMock2,
  LendingPlatformMock2,
  Aave3AprLibFacade,
  AaveTwoAprLibFacade,
  DForceAprLibFacade,
  Compound3AprLibFacade,
  Aave3AggregatorInterfaceMock,
  CometMock,
  PriceFeedMock,
  CometMock2,
  CometRewardsMock,
  DForceRewardDistributorMock,
  UpgradeableProxyFacade,
  ControllableV3Facade,
  TetuConverterCallbackMock, BorrowManagerMock, ConverterControllerMock
} from "../../../typechain";
import {IPoolInfo} from "./BorrowManagerHelper";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";

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

  public static async createPoolAdapterMock2(signer: SignerWithAddress) : Promise<PoolAdapterMock2> {
    return (await DeployUtils.deployContract(signer, "PoolAdapterMock2")) as PoolAdapterMock2;
  }

  public static async createTetuConverterCallbackMock(signer: SignerWithAddress) : Promise<TetuConverterCallbackMock> {
    return (await DeployUtils.deployContract(signer, "TetuConverterCallbackMock")) as TetuConverterCallbackMock;
  }

  public static async createLendingPlatformMock2(signer: SignerWithAddress) : Promise<LendingPlatformMock2> {
    return (await DeployUtils.deployContract(signer, "LendingPlatformMock2")) as LendingPlatformMock2;
  }

  /** Create platform adapter that supports a single pool with set of the given assets */
  public static async createPlatformAdapterMock(
    signer: SignerWithAddress,
    pool: string,
    controllerAddress: string,
    priceOracleAddress: string,
    converters: string[],
    assets: string[],
    cTokens: string[],
    liquidity: BigNumber[],
    borrowRates?: BigNumber[],
    collateralFactors?: number[]
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
    controller: IConverterController,
    pool: PoolStub,
    poolsInfo: IPoolInfo,
    collateralFactors: number[],
    assets: MockERC20[],
    cTokens: MockERC20[],
    prices: BigNumber[],
    templatePoolAdapterOptional?: string,
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

    const templatePoolAdapter = templatePoolAdapterOptional
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

  public static async createConverterControllerMock(signer: SignerWithAddress) : Promise<ConverterControllerMock> {
    return await DeployUtils.deployContract(signer, "ConverterControllerMock") as ConverterControllerMock;
  }

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

  public static async createBorrowManagerMock(signer: SignerWithAddress) : Promise<BorrowManagerMock> {
    return await DeployUtils.deployContract(signer, "BorrowManagerMock") as BorrowManagerMock;
  }

  public static async createDebtsMonitorStub(
    signer: SignerWithAddress,
    valueIsConverterInUse: boolean
  ) : Promise<DebtMonitorStub> {
    return await DeployUtils.deployContract(
      signer
      , "DebtMonitorStub"
      , valueIsConverterInUse
    ) as DebtMonitorStub;
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
    controller: IConverterController,
    periodInBlocks: number
  ) : Promise<Borrower> {
    return (await DeployUtils.deployContract(
      await DeployerUtils.startImpersonate(deployer),
      "Borrower",
      controller.address,
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
      signer,
      "DForceInterestRateModelMock",
      cash1,
      borrowRate1,
      cash2,
      borrowRate2,
    ) as DForceInterestRateModelMock;
  }

  public static async createDForceRewardDistributorMock(signer: SignerWithAddress, rewardsDistributor: string) : Promise<DForceRewardDistributorMock> {
    return await DeployUtils.deployContract(signer,"DForceRewardDistributorMock", rewardsDistributor) as DForceRewardDistributorMock;
  }

//endregion DForce mocks

//region Batch functions
  public static async createAssets(countAssets: number) : Promise<MockERC20[]> {
    return Promise.all(
      [...Array(countAssets).keys()].map(
        async () => (await MocksHelper.createTokens([18]))[0]
      )
    );
  }

  public static async createConverters(signer: SignerWithAddress, countConverters: number) : Promise<PoolAdapterStub[]> {
    return Promise.all(
      [...Array(countConverters).keys()].map(
        async () => MocksHelper.createPoolAdapterStub(signer, getBigNumberFrom(1))
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
      const token = await this.createMockedCToken(signer, decimals[i], assets[i], i);
      dest.push(token);
    }

    return dest;
  }

  public static async createMockedCToken(
    signer: SignerWithAddress,
    decimals: number = 18,
    asset: string = ethers.Wallet.createRandom().address,
    index: number = 0
  ) : Promise<CTokenMock> {
    return await DeployUtils.deployContract(
      signer,
      "CTokenMock",
      `cToken-${index}-${decimals}`,
      `cToken-${index}-${decimals}`,
      decimals,
      asset,
    ) as CTokenMock;
  }
  public static async createMockedToken(signer: SignerWithAddress, symbol: string, decimals: number) : Promise<MockERC20> {
    return await DeployUtils.deployContract(
      signer,
      "MockERC20",
      symbol,
      symbol,
      decimals
    ) as MockERC20;
  }
//endregion Batch functions

//region TetuLiquidator and SwapManager
  public static async createTetuLiquidatorMock(
    deployer: SignerWithAddress,
    assets: string[],
    prices: BigNumber[]
  ) : Promise<TetuLiquidatorMock> {
    return await DeployUtils.deployContract(deployer, "TetuLiquidatorMock",
      assets, prices) as TetuLiquidatorMock;
  }

  public static async createSwapManagerMock(
    deployer: SignerWithAddress,
  ) : Promise<SwapManagerMock> {
    return await DeployUtils.deployContract(deployer,"SwapManagerMock") as SwapManagerMock;
  }

  public static async createConverterUnknownKind(
    deployer: SignerWithAddress,
  ) : Promise<ConverterUnknownKind> {
    return await DeployUtils.deployContract(deployer,"ConverterUnknownKind") as ConverterUnknownKind;
  }
//endregion TetuLiquidator and SwapManager

//region Keeper helpers
  public static async createKeeperMock(deployer: SignerWithAddress, nextIndexToCheck0?: number) : Promise<KeeperMock> {
    return await DeployUtils.deployContract(deployer, "KeeperMock", nextIndexToCheck0 || 0) as KeeperMock;
  }

  public static async createKeeperCaller(
    deployer: SignerWithAddress,
  ) : Promise<KeeperCaller> {
    return await DeployUtils.deployContract(deployer, "KeeperCaller") as KeeperCaller;
  }

  public static async createDebtMonitorCheckHealthMock(
    deployer: SignerWithAddress,
  ) : Promise<DebtMonitorCheckHealthMock> {
    return await DeployUtils.deployContract(deployer,
      "DebtMonitorCheckHealthMock"
    ) as DebtMonitorCheckHealthMock;
  }

  public static async createKeeperCallbackMock(
    deployer: SignerWithAddress,
  ) : Promise<KeeperCallbackMock> {
    return await DeployUtils.deployContract(deployer,
      "KeeperCallbackMock"
    ) as KeeperCallbackMock;
  }

//endregion Keeper helpers

//region DebtMonitor
  public static async createDebtMonitorMock(
    deployer: SignerWithAddress,
  ) : Promise<DebtMonitorMock> {
    return await DeployUtils.deployContract(deployer, "DebtMonitorMock") as DebtMonitorMock;
  }
//endregion DebtMonitor

//region Token address providers
  public static async createTokenAddressProviderMock(
    deployer: SignerWithAddress,
    cToken1: string,
    cToken2: string
  ) : Promise<TokenAddressProviderMock> {
    return await DeployUtils.deployContract(deployer,
      "TokenAddressProviderMock",
      cToken1,
      cToken2
    ) as TokenAddressProviderMock;
  }
//endregion Token address providers

//region Pools and comptrollers
  public static async getAave3PoolMock(
    deployer: SignerWithAddress,
    collateralAsset: string,
    borrowAsset: string,
    aavePool: string
  ) : Promise<Aave3PoolMock> {
    return await DeployUtils.deployContract(deployer,
      "Aave3PoolMock",
      aavePool,
      collateralAsset,
      borrowAsset
    ) as Aave3PoolMock;
  }

  public static async getAaveTwoPoolMock(
    deployer: SignerWithAddress,
    collateralAsset: string,
    borrowAsset: string,
    aavePool: string
  ) : Promise<AaveTwoPoolMock> {
    return await DeployUtils.deployContract(deployer,
      "AaveTwoPoolMock",
      aavePool,
      collateralAsset,
      borrowAsset
    ) as AaveTwoPoolMock;
  }

  public static async getDForceControllerMock(
    deployer: SignerWithAddress,
    collateralAsset: string,
    borrowAsset: string,
    collateralCToken: string,
    borrowCToken: string,
    mockedCollateralCToken: string,
    mockedBorrowCToken: string,
    dForceController: string
  ) : Promise<DForceControllerMock> {
    return await DeployUtils.deployContract(deployer,
      "DForceControllerMock",
      dForceController,
      collateralAsset,
      borrowAsset,
      collateralCToken,
      borrowCToken,
      mockedCollateralCToken,
      mockedBorrowCToken
    ) as DForceControllerMock;
  }

  public static async getNotInitializedDForceCTokenMock(
    deployer: SignerWithAddress,
  ) : Promise<DForceCTokenMock> {
    return await DeployUtils.deployContract(deployer, "DForceCTokenMock") as DForceCTokenMock;
  }

  public static async getHfComptrollerMock(
    deployer: SignerWithAddress,
    collateralAsset: string,
    borrowAsset: string,
    collateralCToken: string,
    borrowCToken: string,
    mockedCollateralCToken: string,
    mockedBorrowCToken: string,
    comptroller: string
  ) : Promise<HfComptrollerMock> {
    return await DeployUtils.deployContract(deployer,
      "HfComptrollerMock",
      comptroller,
      collateralAsset,
      borrowAsset,
      collateralCToken,
      borrowCToken,
      mockedCollateralCToken,
      mockedBorrowCToken
    ) as HfComptrollerMock;
  }

  public static async getNotInitializedHfCTokenMock(
    deployer: SignerWithAddress,
  ) : Promise<HfCTokenMock> {
    return await DeployUtils.deployContract(deployer, "HfCTokenMock") as HfCTokenMock;
  }

//endregion Pools and comptrollers

//region PriceOracle mock
  public static async getPriceOracleStub(
    deployer: SignerWithAddress,
    priceValue: BigNumberish
  ) : Promise<PriceOracleStub> {
    return await DeployUtils.deployContract(deployer, "PriceOracleStub", priceValue) as PriceOracleStub;
  }

  public static async getPriceOracleMock(
    deployer: SignerWithAddress,
    assets: string[],
    prices: BigNumber[]
  ) : Promise<PriceOracleMock> {
    return await DeployUtils.deployContract(deployer, "PriceOracleMock", assets, prices) as PriceOracleMock;
  }

  public static async createAave3AggregatorInterfaceMock(
    signer: SignerWithAddress,
    price: BigNumber,
  ): Promise<Aave3AggregatorInterfaceMock> {
    return (await DeployUtils.deployContract(
      signer,
      'Aave3AggregatorInterfaceMock',
      price,
    )) as Aave3AggregatorInterfaceMock;
  }
//endregion PriceOracle mock

//region Library facades
  public static async getEntryKindsFacade(deployer: SignerWithAddress) : Promise<EntryKindsFacade> {
    return await DeployUtils.deployContract(deployer, "EntryKindsFacade") as EntryKindsFacade;
  }

  public static async getSwapLibFacade(deployer: SignerWithAddress) : Promise<SwapLibFacade> {
    return await DeployUtils.deployContract(deployer, "SwapLibFacade") as SwapLibFacade;
  }

  public static async getAave3AprLibFacade(deployer: SignerWithAddress) : Promise<Aave3AprLibFacade> {
    return await DeployUtils.deployContract(deployer, "Aave3AprLibFacade") as Aave3AprLibFacade;
  }
  public static async getAaveTwoAprLibFacade(deployer: SignerWithAddress) : Promise<AaveTwoAprLibFacade> {
    return await DeployUtils.deployContract(deployer, "AaveTwoAprLibFacade") as AaveTwoAprLibFacade;
  }
  public static async getDForceAprLibFacade(deployer: SignerWithAddress) : Promise<DForceAprLibFacade> {
    return await DeployUtils.deployContract(deployer, "DForceAprLibFacade") as DForceAprLibFacade;
  }
  public static async getCompound3AprLibFacade(deployer: SignerWithAddress) : Promise<Compound3AprLibFacade> {
    return await DeployUtils.deployContract(deployer, "Compound3AprLibFacade") as Compound3AprLibFacade;
  }
//endregion Library facades

//region Compound3 mocks
  public static async createCometMock(signer: SignerWithAddress): Promise<CometMock> {
    return (await DeployUtils.deployContract(signer, 'CometMock')) as CometMock;
  }
  public static async createCometMock2(signer: SignerWithAddress, comet: string): Promise<CometMock2> {
    return (await DeployUtils.deployContract(signer, 'CometMock2', comet)) as CometMock2;
  }
  public static async createCometRewardsMock(signer: SignerWithAddress, comet: string, cometRewards: string): Promise<CometRewardsMock> {
    return (await DeployUtils.deployContract(signer, 'CometRewardsMock', comet, cometRewards)) as CometRewardsMock;
  }

  public static async createPriceFeed(signer: SignerWithAddress): Promise<PriceFeedMock> {
    return (await DeployUtils.deployContract(signer, 'PriceFeedMock', )) as PriceFeedMock;
  }
//endregion Compound3 mocks

//region Proxy
  public static async createUpgradeableProxyFacade(signer: SignerWithAddress): Promise<UpgradeableProxyFacade> {
    return (await DeployUtils.deployContract(signer, 'UpgradeableProxyFacade', )) as UpgradeableProxyFacade;
  }
  public static async createControllableV3Facade(signer: SignerWithAddress): Promise<ControllableV3Facade> {
    return (await DeployUtils.deployContract(signer, 'ControllableV3Facade', )) as ControllableV3Facade;
  }
//endregion Proxy
}
