import {ITetuLiquidator__factory} from "../../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BaseAddresses} from "../../../../scripts/addresses/BaseAddresses";

export class InjectUtils {
  static async registerWethWellPoolInLiquidator(signer: SignerWithAddress) {
    // todo dystopia swapper
    await ITetuLiquidator__factory.connect(BaseAddresses.TETU_LIQUIDATOR, signer).addLargestPools(
      [{
        pool: BaseAddresses.POOL_WETH_WELL_VOLATILE_AMM,
        swapper: swapper,
        tokenIn: BaseAddresses.WETH,
        tokenOut: BaseAddresses.WELL
      }],
      false
    )
  }
}