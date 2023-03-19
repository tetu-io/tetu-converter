import {IRepayAction} from "../uses-cases/BorrowRepayUsesCase";
import {BigNumber} from "ethers";
import {
  IERC20__factory,
  Borrower,
  ConverterController,
  ITetuConverter__factory,
  ITetuLiquidator__factory, IDForcePriceOracle__factory
} from "../../../typechain";
import {IUserBalancesWithGas} from "../utils/BalanceUtils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {TokenDataTypes} from "../types/TokenDataTypes";
import {ethers} from "hardhat";
import {parseUnits} from "ethers/lib/utils";
import {DForceHelper} from "../../../scripts/integration/helpers/DForceHelper";
import {DForceUtils} from "../utils/DForceUtils";

export interface IRepayActionOptionalParams {
  countBlocksToSkipAfterAction?: number,
}

export class ClaimRewardsAction implements IRepayAction {
  public controller: ConverterController;
  public collateralToken: TokenDataTypes;
  public borrowToken: TokenDataTypes;
  public amountToRepay: BigNumber | undefined;

  public rewardsInBorrowAssetReceived: BigNumber;

  constructor(
    controller: ConverterController,
    collateralToken: TokenDataTypes,
    borrowToken: TokenDataTypes,
  ) {
    this.collateralToken = collateralToken;
    this.borrowToken = borrowToken;
    this.controller = controller;
    this.rewardsInBorrowAssetReceived = BigNumber.from(0);
  }

  async doAction(user: Borrower) : Promise<IUserBalancesWithGas> {
    // claim rewards
    const rewardsReceiver = ethers.Wallet.createRandom().address;
    const tetuConverterAsUserContract = ITetuConverter__factory.connect(
      await this.controller.tetuConverter(),
      await DeployerUtils.startImpersonate(user.address)
    );

    const rewards = await tetuConverterAsUserContract.callStatic.claimRewards(rewardsReceiver);
    if (rewards.rewardTokensOut.length) {
      console.log("Rewards:", rewards);
      await tetuConverterAsUserContract.claimRewards(rewardsReceiver);
      for (let i = 0; i < rewards.rewardTokensOut.length; ++i) {
        console.log("Receiver balance of the reward token:", await IERC20__factory.connect(
            rewards.rewardTokensOut[i],
            await DeployerUtils.startImpersonate(rewardsReceiver)
          ).balanceOf(rewardsReceiver)
        );
        // we get a price with decimals = (36 - asset decimals)
        const dForceController = await DForceHelper.getController(
          await DeployerUtils.startImpersonate(rewardsReceiver)
        );

        const priceOracle = IDForcePriceOracle__factory.connect(
          await dForceController.priceOracle(),
          await DeployerUtils.startImpersonate(rewardsReceiver)
        );
        const priceRewards = await priceOracle.getUnderlyingPrice(rewards.rewardTokensOut[i]);
        const priceBorrow = await priceOracle.getUnderlyingPrice(
          DForceUtils.getCTokenAddressForAsset(this.borrowToken.address)
        );

        const rewardsAmount = rewards.amountsOut[i].mul(priceRewards).div(priceBorrow);
        console.log("rewardsAmount", rewardsAmount);

        this.rewardsInBorrowAssetReceived = this.rewardsInBorrowAssetReceived.add(rewardsAmount);
      }
    }

    const collateral = await IERC20__factory.connect(
      this.collateralToken.address,
      await DeployerUtils.startImpersonate(user.address)
    ).balanceOf(user.address);

    const borrow = await IERC20__factory.connect(
      this.borrowToken.address,
      await DeployerUtils.startImpersonate(user.address)
    ).balanceOf(user.address);

    return { collateral, borrow, gasUsed: parseUnits("0") };
  }
}
