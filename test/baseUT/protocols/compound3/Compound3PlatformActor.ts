import {BigNumber, BigNumberish} from "ethers";
import {IPlatformActor} from "../../types/IPlatformActor";
import {MocksHelper} from "../../app/MocksHelper";
import {Compound3Utils} from "./Compound3Utils";
import {Compound3AprLibFacade, IComet, IERC20__factory, IERC20Metadata__factory} from "../../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

export class Compound3PlatformActor implements IPlatformActor {
  comet: IComet;
  collateralAsset: string;
  libFacade?: Compound3AprLibFacade;
  signer: SignerWithAddress;

  constructor(
    signer: SignerWithAddress,
    comet: IComet,
    collateralAsset: string
  ) {
    this.comet = comet;
    this.collateralAsset = collateralAsset;
    this.signer = signer;
  }

  async getAvailableLiquidity() : Promise<BigNumber> {
    return IERC20__factory.connect(await this.comet.baseToken(), this.signer).balanceOf(this.comet.address)
  }

  async getCurrentBR(): Promise<BigNumber> {
    const br = await this.comet.getBorrowRate(await this.comet.getUtilization())
    console.log(`BR=${br}`);
    return br;
  }

  async supplyCollateral(collateralAmount: BigNumber): Promise<void> {
    await IERC20Metadata__factory.connect(this.collateralAsset, this.signer)
      .approve(this.comet.address, collateralAmount);
    console.log(`Supply collateral ${this.collateralAsset} amount ${collateralAmount}`);
    await this.comet.supply(this.collateralAsset, collateralAmount)
  }

  async borrow(borrowAmount: BigNumber): Promise<void> {
    await this.comet.withdraw(await this.comet.baseToken(), borrowAmount)
    console.log(`Borrow ${borrowAmount}`);
  }

  async getBorrowRateAfterBorrow(borrowAsset: string, amountToBorrow: BigNumberish): Promise<BigNumber> {
    if (! this.libFacade) {
      this.libFacade = await MocksHelper.getCompound3AprLibFacade(this.signer);
    }
    return this.libFacade.getBorrowRateAfterBorrow(Compound3Utils.getCometAddressForAsset(borrowAsset), amountToBorrow);
  }
}