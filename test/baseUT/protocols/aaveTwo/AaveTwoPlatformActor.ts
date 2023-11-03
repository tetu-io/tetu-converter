import {BigNumber, BigNumberish} from "ethers";
import {AaveTwoHelper} from "../../../../scripts/integration/aaveTwo/AaveTwoHelper";
import {GAS_LIMIT} from "../../types/GasLimit";
import {
  AaveTwoAprLibFacade,
  IAaveTwoPool,
  IAaveTwoProtocolDataProvider,
  IERC20Metadata__factory
} from "../../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {IPlatformActor} from "../../types/IPlatformActor";
import {MocksHelper} from "../../app/MocksHelper";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";

export class AaveTwoPlatformActor implements IPlatformActor {
  dp: IAaveTwoProtocolDataProvider;
  pool: IAaveTwoPool;
  collateralAsset: string;
  borrowAsset: string;
  signer: SignerWithAddress;
  private libFacade?: AaveTwoAprLibFacade;

  constructor(
    dp: IAaveTwoProtocolDataProvider,
    pool: IAaveTwoPool,
    collateralAsset: string,
    borrowAsset: string,
    signer: SignerWithAddress
  ) {
    this.dp = dp;
    this.pool = pool;
    this.collateralAsset = collateralAsset;
    this.borrowAsset = borrowAsset;
    this.signer = signer;
  }
  async getAvailableLiquidity() : Promise<BigNumber> {
    const rd = await this.dp.getReserveData(this.borrowAsset);
    console.log(`Reserve data before: totalAToken=${rd.availableLiquidity} totalStableDebt=${rd.totalStableDebt} totalVariableDebt=${rd.totalVariableDebt}`);
    return rd.availableLiquidity;
  }
  async getCurrentBR(): Promise<BigNumber> {
    const data = await AaveTwoHelper.getReserveInfo(this.signer, this.pool, this.dp, this.borrowAsset);
    const br = data.data.currentVariableBorrowRate;
    console.log(`BR ${br.toString()}`);
    return BigNumber.from(br);
  }
  async supplyCollateral(collateralAmount: BigNumber): Promise<void> {
    await IERC20Metadata__factory.connect(this.collateralAsset, this.signer).approve(this.pool.address, collateralAmount);
    console.log(`Supply collateral ${this.collateralAsset} amount ${collateralAmount}`);
    await this.pool.deposit(this.collateralAsset, collateralAmount, this.signer.address, 0);
    const userAccountData = await this.pool.getUserAccountData(this.signer.address);
    console.log(`Available borrow base ${userAccountData.availableBorrowsETH}`);
    await this.pool.setUserUseReserveAsCollateral(this.collateralAsset, true);
  }
  async borrow(borrowAmount: BigNumber): Promise<void> {
    console.log(`borrow ${this.borrowAsset} amount ${borrowAmount}`);
    await this.pool.borrow(this.borrowAsset, borrowAmount, 2, 0, this.signer.address, {gasLimit: GAS_LIMIT});
  }

  async getBorrowRateAfterBorrow(borrowAsset: string, amountToBorrow: BigNumberish): Promise<BigNumber> {
    if (! this.libFacade) {
      this.libFacade = await MocksHelper.getAaveTwoAprLibFacade(this.signer);
    }
    return this.libFacade.getBorrowRateAfterBorrow(MaticAddresses.AAVE_TWO_POOL, borrowAsset, amountToBorrow);
  }
}
