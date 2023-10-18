import {Aave3Helper} from "../../../../scripts/integration/aave3/Aave3Helper";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {BigNumber, BigNumberish} from "ethers";
import {GAS_LIMIT} from "../../types/GasLimit";
import {Aave3AprLibFacade, IAavePool, IAaveProtocolDataProvider, IERC20Metadata__factory} from "../../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {IPlatformActor} from "../../types/IPlatformActor";
import {MocksHelper} from "../../app/MocksHelper";

export class Aave3PlatformActor implements IPlatformActor {
  dp: IAaveProtocolDataProvider;
  pool: IAavePool;
  collateralAsset: string;
  borrowAsset: string;
  signer: SignerWithAddress;
  private h: Aave3Helper;
  private libFacade?: Aave3AprLibFacade;

  constructor(
    dataProvider: IAaveProtocolDataProvider,
    pool: IAavePool,
    collateralAsset: string,
    borrowAsset: string,
    signer: SignerWithAddress
  ) {
    this.h = new Aave3Helper(signer, MaticAddresses.AAVE_V3_POOL);
    this.dp = dataProvider;
    this.pool = pool;
    this.collateralAsset = collateralAsset;
    this.borrowAsset = borrowAsset;
    this.signer = signer;
  }

  async getAvailableLiquidity(): Promise<BigNumber> {
    const rd = await this.dp.getReserveData(this.borrowAsset);
    console.log(`Reserve data before: totalAToken=${rd.totalAToken} totalStableDebt=${rd.totalStableDebt} totalVariableDebt=${rd.totalVariableDebt}`);
    const availableLiquidity = rd.totalAToken.sub(
      rd.totalStableDebt.add(rd.totalVariableDebt)
    );
    console.log("availableLiquidity", availableLiquidity);
    return availableLiquidity;
  }

  async getCurrentBR(): Promise<BigNumber> {
    const data = await this.h.getReserveInfo(this.signer, this.pool, this.dp, this.borrowAsset);
    const br = data.data.currentVariableBorrowRate;
    console.log(`BR ${br.toString()}`);
    return BigNumber.from(br);
  }

  async supplyCollateral(collateralAmount: BigNumber): Promise<void> {
    await IERC20Metadata__factory.connect(this.collateralAsset, this.signer).approve(this.pool.address, collateralAmount);
    console.log(`Supply collateral ${this.collateralAsset} amount ${collateralAmount}`);
    await this.pool.supply(this.collateralAsset, collateralAmount, this.signer.address, 0);
    const userAccountData = await this.pool.getUserAccountData(this.signer.address);
    console.log(`Available borrow base ${userAccountData.availableBorrowsBase}`);
    await this.pool.setUserUseReserveAsCollateral(this.collateralAsset, true);
  }

  async borrow(borrowAmount: BigNumber): Promise<void> {
    console.log(`borrow ${this.borrowAsset} amount ${borrowAmount}`);
    await this.pool.borrow(this.borrowAsset, borrowAmount, 2, 0, this.signer.address, {gasLimit: GAS_LIMIT});
  }

  async getBorrowRateAfterBorrow(borrowAsset: string, amountToBorrow: BigNumberish): Promise<BigNumber> {
    if (! this.libFacade) {
      this.libFacade = await MocksHelper.getAave3AprLibFacade(this.signer);
    }
    return this.libFacade.getBorrowRateAfterBorrow(MaticAddresses.AAVE_V3_POOL, borrowAsset, amountToBorrow);
  }
}