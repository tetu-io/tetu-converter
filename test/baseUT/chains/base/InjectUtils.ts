import {ITetuLiquidator__factory} from "../../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BaseAddresses} from "../../../../scripts/addresses/BaseAddresses";
import {Misc} from "../../../../scripts/utils/Misc";

export class InjectUtils {
  static async registerWethWellPoolInLiquidator(signer: SignerWithAddress) {
    const liquidatorOperator = await Misc.impersonate('0xbbbbb8C4364eC2ce52c59D2Ed3E56F307E529a94');
    const liquidator = ITetuLiquidator__factory.connect(BaseAddresses.TETU_LIQUIDATOR, liquidatorOperator);

    await liquidator.addLargestPools(
      [{
        pool: BaseAddresses.POOL_WETH_WELL_VOLATILE_AMM,
        swapper: BaseAddresses.TETU_DISTOPIA_SWAPPER,
        tokenIn: BaseAddresses.WELL,
        tokenOut: BaseAddresses.WETH
      }],
      true
    );

    await liquidator.addLargestPools(
      [{
        pool: BaseAddresses.POOL_WETH_WELL_VOLATILE_AMM,
        swapper: BaseAddresses.TETU_DISTOPIA_SWAPPER,
        tokenIn: BaseAddresses.WETH,
        tokenOut: BaseAddresses.WELL
      }],
      true
    );

    await liquidator.addLargestPools(
      [{
        pool: BaseAddresses.UNISWAPV3_USDC_USDbC_100,
        swapper: BaseAddresses.TETU_UNIV3_SWAPPER,
        tokenIn: BaseAddresses.USDC,
        tokenOut: BaseAddresses.USDbC
      }],
      true
    );

    await liquidator.addLargestPools(
      [{
        pool: BaseAddresses.UNISWAPV3_DAI_USDbC_100,
        swapper: BaseAddresses.TETU_UNIV3_SWAPPER,
        tokenIn: BaseAddresses.DAI,
        tokenOut: BaseAddresses.USDbC
      }],
      true
    );

  }
}