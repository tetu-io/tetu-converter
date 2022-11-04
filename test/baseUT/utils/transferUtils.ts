import {IERC20__factory} from "../../../typechain";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {BigNumber} from "ethers";

/**
 * User transfers amount to TetuConverter.
 * TetuConverter approve this amount to the poolAdapter
 */
export async function transferAndApprove(
  token: string,
  userContract: string,
  tetuConverter: string,
  amount: BigNumber,
  poolAdapter: string
) {
  await IERC20__factory.connect(
    token,
    await DeployerUtils.startImpersonate(userContract)
  ).transfer(tetuConverter, amount);
  await IERC20__factory.connect(
    token,
    await DeployerUtils.startImpersonate(await tetuConverter)
  ).approve(poolAdapter, amount);
}