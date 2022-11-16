import {IERC20__factory} from "../../../typechain";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {BigNumber} from "ethers";
import {Misc} from "../../../scripts/utils/Misc";

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
  console.log("Transfer", token, amount, "to tetu converter", tetuConverter);

  // infinity approve is used
  await IERC20__factory.connect(
    token,
    await DeployerUtils.startImpersonate(await tetuConverter)
  ).approve(poolAdapter, Misc.MAX_UINT);
  console.log("Approve", token, amount, "to pool adapter", poolAdapter);
}

export async function makeInfinityApprove(
  tetuConverter: string,
  poolAdapter: string,
  collateralAsset: string,
  borrowAsset: string
) {
  // TetuConverter gives infinity approve to the pool adapter (see TetuConverter.convert implementation)
  await IERC20__factory.connect(
    collateralAsset,
    await DeployerUtils.startImpersonate(tetuConverter)
  ).approve(
    poolAdapter,
    Misc.MAX_UINT
  );
  await IERC20__factory.connect(
    borrowAsset,
    await DeployerUtils.startImpersonate(tetuConverter)
  ).approve(
    poolAdapter,
    Misc.MAX_UINT
  );
}