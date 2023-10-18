import {BigNumber, BigNumberish} from "ethers";
import {HfAprLibFacade, IERC20Metadata__factory, IHfComptroller, IHfCToken} from "../../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {IPlatformActor} from "../../types/IPlatformActor";
import {MocksHelper} from "../../app/MocksHelper";
import {HundredFinanceUtils} from "./HundredFinanceUtils";

export class HfPlatformActor implements IPlatformActor {
  borrowCToken: IHfCToken;
  collateralCToken: IHfCToken;
  comptroller: IHfComptroller;
  signer: SignerWithAddress;
  libFacade?: HfAprLibFacade;

  constructor(
    borrowCToken: IHfCToken,
    collateralCToken: IHfCToken,
    comptroller: IHfComptroller,
    signer: SignerWithAddress
  ) {
    this.borrowCToken = borrowCToken;
    this.collateralCToken = collateralCToken;
    this.comptroller = comptroller;
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
    const br = await this.borrowCToken.borrowRatePerBlock();
    console.log(`BR=${br}`);
    return br;
  }
  async supplyCollateral(collateralAmount: BigNumber): Promise<void> {
    const collateralAsset = await this.collateralCToken.underlying();
    await IERC20Metadata__factory.connect(collateralAsset, this.signer)
      .approve(this.collateralCToken.address, collateralAmount);
    console.log(`Supply collateral ${collateralAsset} amount ${collateralAmount}`);
    await this.comptroller.enterMarkets([this.collateralCToken.address, this.borrowCToken.address]);
    await this.collateralCToken.mint(collateralAmount);

  }
  async borrow(borrowAmount: BigNumber): Promise<void> {
    await this.borrowCToken.borrow(borrowAmount);
    console.log(`Borrow ${borrowAmount}`);
  }
  async getBorrowRateAfterBorrow(borrowAsset: string, amountToBorrow: BigNumberish): Promise<BigNumber> {
    if (! this.libFacade) {
      this.libFacade = await MocksHelper.getHfAprLibFacade(this.signer);
    }
    return this.libFacade.getBorrowRateAfterBorrow(HundredFinanceUtils.getCTokenAddressForAsset(borrowAsset), amountToBorrow);
  }

}