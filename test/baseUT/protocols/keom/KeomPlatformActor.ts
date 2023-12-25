import {IPlatformActor} from "../../types/IPlatformActor";
import {
  CompoundAprLibFacade,
  IERC20Metadata__factory,
  IKeomComptroller__factory,
  IMToken
} from "../../../../typechain";
import {BigNumber, BigNumberish} from "ethers";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {MocksHelper} from "../../app/MocksHelper";
import {IKeomCore} from "./IKeomCore";

export class KeomPlatformActor implements IPlatformActor {
  borrowCToken: IMToken;
  collateralCToken: IMToken;
  core: IKeomCore;
  signer: SignerWithAddress;
  libFacade?: CompoundAprLibFacade;

  constructor(
    borrowCToken: IMToken,
    collateralCToken: IMToken,
    core: IKeomCore,
    signer: SignerWithAddress
  ) {
    this.borrowCToken = borrowCToken;
    this.collateralCToken = collateralCToken;
    this.core = core;
    this.signer = signer;
  }
  async getAvailableLiquidity() : Promise<BigNumber> {
    const cashBefore = await this.borrowCToken.getCash();
    const borrowBefore = await this.borrowCToken.totalBorrows();
    const reserveBefore = await this.borrowCToken.totalReserves();
    console.log(`Reserve data before: cash=${cashBefore.toString()} borrow=${borrowBefore.toString()} reserve=${reserveBefore.toString()}`);
    return cashBefore;
  }
  async getCurrentBR(): Promise<BigNumber> {
    const br = await this.borrowCToken.borrowRatePerTimestamp();
    console.log(`BR=${br}`);
    return br;
  }
  async supplyCollateral(collateralAmount: BigNumber): Promise<void> {
    const collateralAsset = await this.collateralCToken.underlying();
    await IERC20Metadata__factory.connect(collateralAsset, this.signer).approve(this.collateralCToken.address, collateralAmount);
    console.log(`Supply collateral ${collateralAsset} amount ${collateralAmount}`);
    await IKeomComptroller__factory.connect(this.core.comptroller, this.signer).enterMarkets([this.collateralCToken.address, this.borrowCToken.address]);
    await this.collateralCToken.mint(collateralAmount);

  }
  async borrow(borrowAmount: BigNumber): Promise<void> {
    await this.borrowCToken.borrow(borrowAmount);
    console.log(`Borrow ${borrowAmount}`);
  }
  async getBorrowRateAfterBorrow(borrowAsset: string, amountToBorrow: BigNumberish): Promise<BigNumber> {
    if (! this.libFacade) {
      this.libFacade = await MocksHelper.getCompoundAprLibFacade(this.signer);
    }
    return this.libFacade.getBorrowRateAfterBorrow(this.core.utils.getCToken(borrowAsset), amountToBorrow);
  }

}