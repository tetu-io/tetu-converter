/**
 * Help to initialize and setup Borrow Manager and related classes
 */
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BigNumber} from "ethers";
import {ethers} from "hardhat";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {
  Aave3PriceOracleMock,
  Borrower,
  BorrowManagerStub,
  CTokenMock, IController,
  LendingPlatformMock,
  MockERC20,
  PoolAdapterMock, PoolAdapterStub,
  PoolStub
} from "../../../typechain";

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

  /** Create platform adapter that supports a single pool with set of the given underlyings */
  public static async createPlatformAdapterMock(
    signer: SignerWithAddress
    , pool: PoolStub
    , controllerAddress: string
    , converterAddress: string
    , underlyings: string[]
    , borrowRates: BigNumber[]
    , collateralFactors: number[]
    , liquidity: BigNumber[]
    , cTokens: MockERC20[]
    , priceOracleAddress: string
  ) : Promise<LendingPlatformMock> {
    // we cannot pass 0.8 to mul, we will have https://links.ethers.org/v5-errors-NUMERIC_FAULT-underflow
    // so:  0.8 => 80 and reduce decimals 18 => 16
    const cfs = collateralFactors.map(x => (BigNumber.from(10).pow(16)).mul(x * 100));
    return (await DeployUtils.deployContract(signer
      , "LendingPlatformMock"
      , controllerAddress
      , pool.address
      , converterAddress
      , underlyings
      , cfs
      , borrowRates
      , liquidity
      , cTokens.map(x => x.address)
      , priceOracleAddress
    )) as LendingPlatformMock;
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

  public static async createCTokensMocks(
    signer: SignerWithAddress,
    decimals: number[],
    underlyings: string[]
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
        , underlyings[i]
      ) as CTokenMock;
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
}