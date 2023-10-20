// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../compound/CompoundLib.sol";
import "./MoonwellRewardsLib.sol";
import "../../libs/AppDataTypes.sol";
import "../../integrations/tetu/ITetuLiquidator.sol";
import "hardhat/console.sol";

library MoonwellLib {
  /// @notice For any assets
  uint constant public MIN_ALLOWED_AMOUNT_TO_LIQUIDATE = 1000;

  function initProtocolFeatures(CompoundLib.ProtocolFeatures memory dest) internal pure {
    dest.nativeToken = 0x4200000000000000000000000000000000000006;
    dest.cTokenNative = address(0);
    dest.compoundStorageVersion = CompoundLib.COMPOUND_STORAGE_V1;
  }

  /// @notice Estimate total number of rewards that will be received after
  ///         supplying of {amountToSupply} of collateral asset and borrowing
  ///         {amountToBorrow} of borrow asset, recalculate these amounts to the total amount in terms of borrow asset
  /// @param cTokenCollateral mToken related to the collateral asset
  /// @param cTokenBorrow mToken related to the borrow asset
  /// @param amountToSupply Amount of collateral asset to be supplied, in terms of collateral asset
  /// @param amountToBorrow Amount of borrow asset to be borrowed, in terms of borrow asset
  /// @param borrowPeriodTimestamp_ Expected borrow period, in seconds
  /// @return rewardsSupply Estimated amount of supply reward tokens, in terms of {borrowAsset}
  /// @return rewardsBorrow Estimated amount of borrow reward tokens, in terms of {borrowAsset}
  function estimateRewardAmounts(
    address cTokenCollateral,
    address cTokenBorrow,
    uint amountToSupply,
    uint amountToBorrow,
    uint32 borrowPeriodTimestamp_,
    address rewardDistributor,
    ITetuLiquidator tetuLiquidator,
    address borrowAsset
  ) internal view returns (
    uint rewardsSupply,
    uint rewardsBorrow
  ) {
    console.log("estimateRewardAmounts.1");
    MultiRewardDistributorCommon.RewardInfo[] memory outputRewardData;
    outputRewardData = MoonwellRewardsLib.getOutstandingRewardsForUser(
      IMToken(cTokenCollateral),
      borrowPeriodTimestamp_,
      amountToSupply,
      0,
      IMoonwellMultiRewardDistributor(rewardDistributor)
    );
    console.log("estimateRewardAmounts.2");
    rewardsSupply = _getRewardTotalAmount(outputRewardData, tetuLiquidator, borrowAsset);
    outputRewardData = MoonwellRewardsLib.getOutstandingRewardsForUser(
      IMToken(cTokenBorrow),
      borrowPeriodTimestamp_,
      0,
      amountToBorrow,
      IMoonwellMultiRewardDistributor(rewardDistributor)
    );
    console.log("estimateRewardAmounts.3");
    rewardsBorrow = _getRewardTotalAmount(outputRewardData, tetuLiquidator, borrowAsset);
  }

  /// @notice Enumerate all rewards in {data}, converter to {assetOut}, return total amount
  /// @return Total amount of all rewards in terms of {assetOut}
  function _getRewardTotalAmount(
    MultiRewardDistributorCommon.RewardInfo[] memory data,
    ITetuLiquidator tetuLiquidator,
    address assetOut
  ) internal view returns (uint) {
    uint dest;
    for (uint i; i < data.length; ++i) {
      if (data[i].totalAmount > MIN_ALLOWED_AMOUNT_TO_LIQUIDATE) {
        uint priceOut = tetuLiquidator.getPrice(data[i].emissionToken, assetOut, data[i].totalAmount);
        dest += priceOut;
      }
    }
    return dest;
  }
}