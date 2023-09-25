import {getPoolAdapterState, ILendingPlatformManager, IPoolAdapterState01} from "./ILendingPlatformManager";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  Aave3PoolAdapter,
  Borrower,
  IAaveAddressesProvider__factory,
  IAavePoolConigurator__factory, IERC20__factory, ITetuConverter
} from "../../../typechain";
import {Aave3Helper} from "../../../scripts/integration/aave3/Aave3Helper";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {ITokenWithHolder} from "../types/TokenDataTypes";
import {Aave3ChangePricesUtils} from "../protocols/aave3/Aave3ChangePricesUtils";
import {ICoreAave3} from "../protocols/aave3/Aave3DataTypes";

export class LendingPlatformManagerAave3 implements ILendingPlatformManager {
  poolAdapter: Aave3PoolAdapter;
  borrower: Borrower;
  tc: ITetuConverter;
  /*
   *  We can use ITetuConverter to make max allowed borrow,
   *  but we should use different pool adapter (not the one under the test)
   *  so we need different collateral asset.
   * */
  collateralHolder: ITokenWithHolder;
  borrowHolder: ITokenWithHolder;
  core: ICoreAave3;
  constructor(
    core: ICoreAave3,
    pa: Aave3PoolAdapter,
    borrower: Borrower,
    tc: ITetuConverter,
    collateralHolder: ITokenWithHolder,
    borrowHolder: ITokenWithHolder,
  ) {
    this.poolAdapter = pa;
    this.borrower = borrower;
    this.tc = tc;
    this.collateralHolder = collateralHolder;
    this.borrowHolder = borrowHolder;
    this.core = core;
  }

//region ILendingPlatformManager
  /** Increase or decrease a price of the asset on the given number of times */
  async changeAssetPrice(
    signer: SignerWithAddress,
    asset: string,
    inc: boolean,
    times: number
  ): Promise<IPoolAdapterState01>  {
    const before = await getPoolAdapterState(signer, this.poolAdapter.address);
    await Aave3ChangePricesUtils.changeAssetPrice(signer, this.core, asset, inc, times);
    const after = await getPoolAdapterState(signer, this.poolAdapter.address);
    console.log("changeAssetPrice.2", before, after);
    return {before, after};
  }

  /** Change collateral factor of the asset on new value, decimals 2 */
  async changeCollateralFactor(signer: SignerWithAddress, newValue2: number): Promise<IPoolAdapterState01>  {
    console.log("changeCollateralFactor.1");
    const before = await getPoolAdapterState(signer, this.poolAdapter.address);
    const collateralAsset = (await this.poolAdapter.getConfig()).outCollateralAsset;

    // get admin address
    const aavePoolAdmin = await DeployerUtils.startImpersonate(MaticAddresses.AAVE_V3_POOL_ADMIN);
    const aavePool = await Aave3Helper.getAavePool(signer, MaticAddresses.AAVE_V3_POOL);
    const aaveAddressProvider = IAaveAddressesProvider__factory.connect(
      await aavePool.ADDRESSES_PROVIDER(),
      signer
    );

    const poolConfiguratorAsAdmin = IAavePoolConigurator__factory.connect(
      await aaveAddressProvider.getPoolConfigurator(),
      aavePoolAdmin
    );
    const ltvConfig = await Aave3Helper.getReserveLtvConfig(aavePool, collateralAsset);
    await aavePool.getReserveData(collateralAsset);

    // LTV must be less than liquidationThreshold
    const liquidationThreshold = newValue2 * 100;
    const ltv = liquidationThreshold - (ltvConfig.liquidationThreshold.toNumber() - ltvConfig.ltv.toNumber());
    console.log(`New ltv=${ltv} new liquidationThreshold=${liquidationThreshold}`);
    console.log(`OLd ltv=${ltvConfig.ltv.toNumber()} old liquidationThreshold=${ltvConfig.liquidationThreshold.toNumber()}`);

    await poolConfiguratorAsAdmin.configureReserveAsCollateral(collateralAsset,
      ltv,
      liquidationThreshold,
      ltvConfig.liquidationBonus
    );

    const after = await getPoolAdapterState(signer, this.poolAdapter.address);
    console.log("changeCollateralFactor.2", before, after);
    return {before, after};
  }

  /** Borrow max possible amount (and significantly increase the borrow rate) */
  async makeMaxBorrow(signer: SignerWithAddress): Promise<IPoolAdapterState01> {
    console.log("AAVE3.makeMaxBorrow.1");
    const before = await getPoolAdapterState(signer, this.poolAdapter.address);

    const borrowAsset = this.borrowHolder.asset;
    const collateralAsset = this.collateralHolder.asset;

    // let's try to make borrow for all collateral amount that the holder have
    const collateralAmount = await IERC20__factory.connect(collateralAsset, signer)
      .balanceOf(this.collateralHolder.holder);
    console.log("Holder's balance of collateral", collateralAmount);

    // Let's borrow max possible amount for provided collateral
    await IERC20__factory.connect(collateralAsset,
      await DeployerUtils.startImpersonate(this.collateralHolder.holder)
    ).transfer(this.borrower.address, collateralAmount);

    console.log("Borrower balance of collateral",
      await IERC20__factory.connect(collateralAsset, signer).balanceOf(this.borrower.address));

    await this.borrower.borrowMaxAmount(
      "0x",
      collateralAsset,
      collateralAmount,
      borrowAsset,
      this.collateralHolder.asset // put borrowed amount on the balance of borrow-holder
    );

    const after = await getPoolAdapterState(signer, this.poolAdapter.address);
    console.log("AAVE3.makeMaxBorrow.2", before, after);
    return {before, after};
  }
  /** Return previously borrowed amount back (reverse to makeMaxBorrow) */
  async releaseMaxBorrow(signer: SignerWithAddress): Promise<IPoolAdapterState01> {
    console.log("AAVE3.releaseMaxBorrow.1");
    const before = await getPoolAdapterState(signer, this.poolAdapter.address);

    const borrowAssetAsHolder = await IERC20__factory.connect(this.borrowHolder.asset,
      await DeployerUtils.startImpersonate(this.borrowHolder.holder)
    );
    const collateralAssetAsHolder = await IERC20__factory.connect(this.collateralHolder.asset,
      await DeployerUtils.startImpersonate(this.collateralHolder.holder)
    );
    // how much we should pay?
    const status = await this.poolAdapter.getStatus();

    // Let's put amount-to-pay + small amount on balance of the borrower,
    console.log("AAVE3 Borrow holder's balance of borrow token (before repay)",
      await borrowAssetAsHolder.balanceOf(this.borrowHolder.holder));
    console.log("AAVE3 Collateral holder's balance of collateral token (before repay)",
      await collateralAssetAsHolder.balanceOf(this.collateralHolder.holder));

    await borrowAssetAsHolder.transfer(this.borrower.address, status.amountToPay.mul(2));
    console.log("AAVE3 Borrower balance of borrow token (before repay)",
      await IERC20__factory.connect(this.borrowHolder.asset, signer).balanceOf(this.borrower.address));

    await this.borrower.makeRepayComplete(
      this.collateralHolder.asset,
      borrowAssetAsHolder.address,
      this.collateralHolder.holder
    );

    console.log("AAVE3 Borrow holder's balance of borrow token (after repay)",
      await borrowAssetAsHolder.balanceOf(this.borrowHolder.holder));
    console.log("AAVE3 Collateral holder's balance of collateral token (after repay)",
      await collateralAssetAsHolder.balanceOf(this.collateralHolder.holder));
    console.log("AAVE3 Borrower balance of borrow token (after repay)",
      await IERC20__factory.connect(this.borrowHolder.asset, signer).balanceOf(this.borrower.address));

    const after = await getPoolAdapterState(signer, this.poolAdapter.address);
    console.log("AAVE3.releaseMaxBorrow.2");
    return {before, after};
  }

  async setActive(signer: SignerWithAddress, asset: string, active: boolean) {
    console.log("AAVE3 set active", asset, active);
    // get admin address
    const aavePoolAdmin = await DeployerUtils.startImpersonate(MaticAddresses.AAVE_V3_POOL_ADMIN);
    const aavePool = await Aave3Helper.getAavePool(signer, MaticAddresses.AAVE_V3_POOL);
    const aaveAddressProvider = IAaveAddressesProvider__factory.connect(
      await aavePool.ADDRESSES_PROVIDER(),
      signer
    );

    const poolConfiguratorAsAdmin = IAavePoolConigurator__factory.connect(
      await aaveAddressProvider.getPoolConfigurator(),
      aavePoolAdmin
    );

    await poolConfiguratorAsAdmin.setReservePause(asset, active);
  }
//endregion ILendingPlatformManager
}