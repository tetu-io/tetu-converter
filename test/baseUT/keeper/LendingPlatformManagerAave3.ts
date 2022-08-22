import {getPoolAdapterState, ILendingPlatformManager, PoolAdapterState01} from "./ILendingPlatformManager";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  Aave3PoolAdapter,
  Aave3PriceOracleMock,
  Aave3PriceOracleMock__factory, Borrower,
  IAaveAddressesProvider__factory,
  IAavePool, IAavePoolConigurator__factory, IAavePriceOracle__factory, IERC20__factory, ITetuConverter
} from "../../../typechain";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {Aave3Helper} from "../../../scripts/integration/helpers/Aave3Helper";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {ITokenWithHolder} from "../types/TokenDataTypes";
import {BigNumber} from "ethers";
import {MocksHelper} from "../helpers/MocksHelper";

export class LendingPlatformManagerAave3 implements ILendingPlatformManager {
  poolAdapter: Aave3PoolAdapter;
  borrower: Borrower;
  tc: ITetuConverter;
  /** We can use ITetuConverter to make max allowed borrow,
   *  but we should use different pool adapter (not the one under the test)
   *  so we need different collateral asset.
   * */
  collateralHolder: ITokenWithHolder;
  borrowHolder: ITokenWithHolder;
  constructor(
    pa: Aave3PoolAdapter
    , borrower: Borrower
    , tc: ITetuConverter
    , collateralHolder: ITokenWithHolder
    , borrowHolder: ITokenWithHolder
  ) {
    this.poolAdapter = pa;
    this.borrower = borrower;
    this.tc = tc;
    this.collateralHolder = collateralHolder;
    this.borrowHolder = borrowHolder;
  }

//region Substitute mocks into the AAVE3-protocol
  async setupPriceOracleMock(
    deployer: SignerWithAddress,
    aave3pool: IAavePool
  ) {
    // get access to AAVE price oracle
    const aaveOracle = await Aave3Helper.getAavePriceOracle(deployer);

    // get admin address
    const aavePoolOwner = await DeployerUtils.startImpersonate(MaticAddresses.AAVE_V3_POOL_OWNER);

    // deploy mock
    const mock = (await DeployUtils.deployContract(deployer
      , "Aave3PriceOracleMock"
      , await aaveOracle.ADDRESSES_PROVIDER()
      , await aaveOracle.BASE_CURRENCY()
      , await aaveOracle.BASE_CURRENCY_UNIT()
      , await aaveOracle.getFallbackOracle()
    )) as Aave3PriceOracleMock;

    // copy current prices from real price oracle to the mock
    const aavePool = await Aave3Helper.getAavePool(deployer);
    const reserves = await aavePool.getReservesList();
    const prices = await aaveOracle.getAssetsPrices(reserves);
    await mock.setPrices(reserves, prices);

    // install the mock to the protocol
    const aaveAddressProviderAsOwner = IAaveAddressesProvider__factory.connect(
      await aavePool.ADDRESSES_PROVIDER()
      , aavePoolOwner
    );
    await aaveAddressProviderAsOwner.setPriceOracle(mock.address);
  }
//endregion Substitute mocks into the AAVE3-protocol

//region ILendingPlatformManager
  /** Increase or decrease a price of the asset on the given number of times */
  async changeAssetPrice(
    signer: SignerWithAddress
    , asset: string
    , inc: boolean
    , times: number
  ): Promise<PoolAdapterState01>  {
    const before = await getPoolAdapterState(signer, this.poolAdapter.address);

    // setup new price oracle
    const aavePool = await Aave3Helper.getAavePool(signer);
    await this.setupPriceOracleMock(signer, aavePool);

    // change a price of the given asset
    const oracle = Aave3PriceOracleMock__factory.connect(
      (await Aave3Helper.getAavePriceOracle(signer)).address
      , signer
    );
    const currentPrice: BigNumber = await oracle.getAssetPrice(asset);
    await oracle.setPrices(
      [
        asset
      ], [
        inc ? currentPrice.mul(times) : currentPrice.div(times)
      ]
    );

    const after = await getPoolAdapterState(signer, this.poolAdapter.address);
    console.log("changeAssetPrice.2", before, after);
    return {before, after};
  }

  /** Change collateral factor of the asset on new value, decimals 2 */
  async changeCollateralFactor(signer: SignerWithAddress, newValue2: number): Promise<PoolAdapterState01>  {
    console.log("changeCollateralFactor.1");
    const before = await getPoolAdapterState(signer, this.poolAdapter.address);
    const collateralAsset = (await this.poolAdapter.getConfig()).outCollateralAsset;

    // get admin address
    const aavePoolAdmin = await DeployerUtils.startImpersonate(MaticAddresses.AAVE_V3_POOL_ADMIN);
    const aavePool = await Aave3Helper.getAavePool(signer);
    const aaveAddressProvider = IAaveAddressesProvider__factory.connect(
      await aavePool.ADDRESSES_PROVIDER()
      , signer
    );

    const poolConfiguratorAsAdmin = IAavePoolConigurator__factory.connect(
      await aaveAddressProvider.getPoolConfigurator()
      , aavePoolAdmin
    );
    const ltvConfig = await Aave3Helper.getReserveLtvConfig(aavePool, collateralAsset);
    await aavePool.getReserveData(collateralAsset);

    // LTV must be less than liquidationThreshold
    const liquidationThreshold = newValue2 * 100;
    const ltv = liquidationThreshold - (ltvConfig.liquidationThreshold.toNumber() - ltvConfig.ltv.toNumber());
    console.log(`New ltv=${ltv} new liquidationThreshold=${liquidationThreshold}`);
    console.log(`OLd ltv=${ltvConfig.ltv.toNumber()} old liquidationThreshold=${ltvConfig.liquidationThreshold.toNumber()}`);

    await poolConfiguratorAsAdmin.configureReserveAsCollateral(collateralAsset,
      ltv
      , liquidationThreshold
      , ltvConfig.liquidationBonus
    );

    const after = await getPoolAdapterState(signer, this.poolAdapter.address);
    console.log("changeCollateralFactor.2", before, after);
    return {before, after};
  }

  /** Borrow max possible amount (and significantly increase the borrow rate) */
  async makeMaxBorrow(signer: SignerWithAddress): Promise<PoolAdapterState01> {
    console.log("AAVE3.makeMaxBorrow.1");
    const before = await getPoolAdapterState(signer, this.poolAdapter.address);

    const borrowAsset = this.borrowHolder.asset;
    const collateralAsset = this.collateralHolder.asset;

    // let's try to make borrow for all collateral amount that the holder have
    const collateralAmount = await IERC20__factory.connect(collateralAsset, signer)
      .balanceOf(this.collateralHolder.holder);
    console.log("Holder's balance of collateral", collateralAmount);

    // Let's borrow max possible amount for provided collateral
    await IERC20__factory.connect(collateralAsset
      , await DeployerUtils.startImpersonate(this.collateralHolder.holder)
    ).transfer(this.borrower.address, collateralAmount);

    console.log("Borrower balance of collateral"
      , await IERC20__factory.connect(collateralAsset, signer).balanceOf(this.borrower.address));

    await this.borrower.makeBorrowUC1_1(
      collateralAsset
      , collateralAmount
      , borrowAsset
      , this.collateralHolder.asset //put borrowed amount on the balance of borrow-holder
    );

    const after = await getPoolAdapterState(signer, this.poolAdapter.address);
    console.log("AAVE3.makeMaxBorrow.2", before, after);
    return {before, after};
  }
  /** Return previously borrowed amount back (reverse to makeMaxBorrow) */
  async releaseMaxBorrow(signer: SignerWithAddress): Promise<PoolAdapterState01> {
    console.log("AAVE3.releaseMaxBorrow.1");
    const before = await getPoolAdapterState(signer, this.poolAdapter.address);

    const borrowAssetAsHolder = await IERC20__factory.connect(this.borrowHolder.asset
      , await DeployerUtils.startImpersonate(this.borrowHolder.holder)
    );
    const collateralAssetAsHolder = await IERC20__factory.connect(this.collateralHolder.asset
      , await DeployerUtils.startImpersonate(this.collateralHolder.holder)
    );
    // how much we should pay?
    const status = await this.poolAdapter.getStatus();

    // Let's put amount-to-pay + small amount on balance of the borrower,
    console.log("AAVE3 Borrow holder's balance of borrow token (before repay)"
      , await borrowAssetAsHolder.balanceOf(this.borrowHolder.holder));
    console.log("AAVE3 Collateral holder's balance of collateral token (before repay)"
      , await collateralAssetAsHolder.balanceOf(this.collateralHolder.holder));

    await borrowAssetAsHolder.transfer(this.borrower.address, status.amountsToPay.mul(2));
    console.log("AAVE3 Borrower balance of borrow token (before repay)"
      , await IERC20__factory.connect(this.borrowHolder.asset, signer).balanceOf(this.borrower.address));

    await this.borrower.makeRepayUC1_2(
      this.collateralHolder.asset
      , borrowAssetAsHolder.address
      , this.collateralHolder.holder
    );

    console.log("AAVE3 Borrow holder's balance of borrow token (after repay)"
      , await borrowAssetAsHolder.balanceOf(this.borrowHolder.holder));
    console.log("AAVE3 Collateral holder's balance of collateral token (after repay)"
      , await collateralAssetAsHolder.balanceOf(this.collateralHolder.holder));
    console.log("AAVE3 Borrower balance of borrow token (after repay)"
      , await IERC20__factory.connect(this.borrowHolder.asset, signer).balanceOf(this.borrower.address));

    const after = await getPoolAdapterState(signer, this.poolAdapter.address);
    console.log("AAVE3.releaseMaxBorrow.2");
    return {before, after};
  }

  async setActive(signer: SignerWithAddress, asset: string, active: boolean) {
    console.log("AAVE3 set active", asset, active);
    // get admin address
    const aavePoolAdmin = await DeployerUtils.startImpersonate(MaticAddresses.AAVE_V3_POOL_ADMIN);
    const aavePool = await Aave3Helper.getAavePool(signer);
    const aaveAddressProvider = IAaveAddressesProvider__factory.connect(
      await aavePool.ADDRESSES_PROVIDER()
      , signer
    );

    const poolConfiguratorAsAdmin = IAavePoolConigurator__factory.connect(
      await aaveAddressProvider.getPoolConfigurator()
      , aavePoolAdmin
    );

    await poolConfiguratorAsAdmin.setReservePause(asset, active);
  }
//endregion ILendingPlatformManager
}