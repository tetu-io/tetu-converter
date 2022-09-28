import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  BorrowManager, BorrowManager__factory,
  Controller, DebtMonitor,
  IController, LendingPlatformMock,
  MockERC20, PoolStub,
  PriceOracleMock, SwapManager, TetuConverter,
} from "../../../typechain";
import {BigNumber, ethers} from "ethers";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {MocksHelper} from "./MocksHelper";
import {IPoolInfo} from "./BorrowManagerHelper";
import {COUNT_BLOCKS_PER_DAY} from "../utils/aprUtils";
import {Misc} from "../../../scripts/utils/Misc";

export class CoreContractsHelper {
  static async createController(
    deployer: SignerWithAddress
  ) : Promise<Controller>{
    const controller = (await DeployUtils.deployContract(deployer
      , "Controller"
      , COUNT_BLOCKS_PER_DAY
      , 101
      , deployer.address
    )) as Controller;
    await controller.initialize(
      ethers.Wallet.createRandom().address,
      ethers.Wallet.createRandom().address,
      ethers.Wallet.createRandom().address,
      ethers.Wallet.createRandom().address,
      ethers.Wallet.createRandom().address,
      ethers.Wallet.createRandom().address,
    );
    return controller;
  }

  public static async createDebtMonitor(
    signer: SignerWithAddress,
    controller: IController,
    thresholdAPR: number = 0,
    thresholdCountBlocks: number = 0
  ): Promise<DebtMonitor> {
    return (await DeployUtils.deployContract(
      signer,
      "DebtMonitor",
      controller.address,
      thresholdAPR,
      thresholdCountBlocks
    )) as DebtMonitor;
  }

  public static async createTetuConverter(
    signer: SignerWithAddress,
    controller: Controller,
  ): Promise<TetuConverter> {
    return (await DeployUtils.deployContract(
      signer,
      "TetuConverter",
      controller.address
    )) as TetuConverter;
  }

  /** Create BorrowManager with mock as adapter */
  public static async createBorrowManager (
    signer: SignerWithAddress,
    controller: IController,
  ) : Promise<BorrowManager> {
    return (await DeployUtils.deployContract(
      signer,
      "BorrowManager",
      controller.address,
      Misc.WEI // by default, set rewardsFactor = 1
    )) as BorrowManager;
  }

  /** Create SwapManager */
  public static async createSwapManager (
    signer: SignerWithAddress,
    controller: IController,
    tetuLiquidatorAddress: string,
  ) : Promise<SwapManager> {
    return (await DeployUtils.deployContract(
      signer,
      "SwapManager",
      controller.address,
      tetuLiquidatorAddress,
    )) as SwapManager;
  }

  /**
   * Generate single platform adapter (with attached pool).
   * Create new BorrowManager and add the pool there
   */
  public static async addPool(
    signer: SignerWithAddress,
    controller: IController,
    pool: PoolStub,
    poolsInfo: IPoolInfo,
    collateralFactors: number[],
    underlying: MockERC20[],
    cTokens: MockERC20[],
    prices: BigNumber[],
    templateAdapterPoolOptional?: string,
  ) : Promise <{
    platformAdapter: LendingPlatformMock,
    templatePoolAdapter: string
  }>{
    const borrowRates = await Promise.all(underlying.map(
      async (token, index) => {
        const br = poolsInfo.borrowRateInTokens[index];
        return typeof br === "object"
          ? br
          : getBigNumberFrom(
            poolsInfo.borrowRateInTokens[index],
            await underlying[index].decimals()
          );
      }
    ));
    const availableLiquidity = await Promise.all(underlying.map(
      async (token, index) => getBigNumberFrom(
        poolsInfo.availableLiquidityInTokens[index],
        await underlying[index].decimals()
      )
    ));

    const templatePoolAdapter = templateAdapterPoolOptional
      || (await MocksHelper.createPoolAdapterStub(signer, getBigNumberFrom(1))).address;

    const priceOracle = (await DeployUtils.deployContract(signer, "PriceOracleMock"
      , underlying ? underlying.map(x => x.address) : []
      , prices || []
    )) as PriceOracleMock;

    const platformAdapter = await MocksHelper.createPlatformAdapterMock(
      signer,
      pool,
      controller.address,
      templatePoolAdapter,
      underlying.map(x => x.address),
      borrowRates,
      collateralFactors,
      availableLiquidity,
      cTokens,
      priceOracle.address
    );

    const bm = BorrowManager__factory.connect(await controller.borrowManager(), signer);

    // generate all possible pairs of underlying
    const left: string[] = [];
    const right: string[] = [];
    for (let i = 0; i < underlying.length; ++i) {
      for (let j = i + 1; j < underlying.length; ++j) {
        left.push(underlying[i].address);
        right.push(underlying[j].address);
      }
    }

    await bm.addAssetPairs(platformAdapter.address, left, right);

    return {platformAdapter, templatePoolAdapter};
  }
}
