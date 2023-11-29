import {ITetuLiquidator__factory} from "../../../../typechain";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";

export async function addLiquidatorPath(liquidator: string, gov: string, tokenIn: string, tokenOut: string, swapper: string, pool: string) {
  const l = ITetuLiquidator__factory.connect(liquidator, await DeployerUtils.startImpersonate(gov))
  await l.addLargestPools([{
    pool,
    swapper,
    tokenIn,
    tokenOut,
  }], true)
}