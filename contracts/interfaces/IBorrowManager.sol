// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../core/AppDataTypes.sol";
import "./IPoolAdaptersManager.sol";

/// @notice Manage list of available lending platforms
interface IBorrowManager is IPoolAdaptersManager {

  /// @notice Register new lending platform with available pairs of assets
  ///         OR add new pairs of assets to the exist lending platform
  /// @param platformAdapter_ Implementation of IPlatformAdapter attached to the specified pool
  /// @param leftAssets_  Supported pairs of assets. The pairs are set using two arrays: left and right
  /// @param rightAssets_  Supported pairs of assets. The pairs are set using two arrays: left and right
  function addAssetPairs(
    address platformAdapter_,
    address[] calldata leftAssets_,
    address[] calldata rightAssets_
  ) external;

  /// @notice Remove available pairs of asset from the platform adapter.
  ///         The platform adapter will be unregistered after removing last supported pair of assets
  function removeAssetPairs(
    address platformAdapter_,
    address[] calldata leftAssets_,
    address[] calldata rightAssets_
  ) external;

  /// @notice Set default health factor for {asset}. Default value is used only if user hasn't provided custom value
  ///      For AAVE v2/v3: health factor value must be greater than
  ///            h = liquidation-threshold (LT) / loan-to-value (LTV)
  ///      for the selected asset
  ///      The health factor is calculated using liquidation threshold value.
  ///      Following situation is ok:  0 ... 1/health factor ... LTV ... LT .. 1
  ///      Following situation is NOT allowed:  0 ... LTV ... 1/health factor ... LT .. 1
  ///      because AAVE-pool won't allow to make a borrow.
  /// @param healthFactor2_ Health factor must be greater then 1, decimals 2
  function setHealthFactor(address asset, uint16 healthFactor2_) external;

  /// @notice Reward APR is taken into account with given factor
  ///         Result APR = borrow-apr - supply-apr - [REWARD-FACTOR]/Denominator * rewards-APR
  function setRewardsFactor(uint rewardsFactor_) external;

  /// @notice Find lending pool capable of providing {targetAmount} and having best normalized borrow rate
  /// @return converter Result template-pool-adapter or 0 if a pool is not found
  /// @return maxTargetAmount Max available amount of target tokens that we can borrow using {sourceAmount}
  /// @return apr18 Annual Percentage Rate == (total cost - total income) / amount of collateral, decimals 18
  function findConverter(AppDataTypes.InputConversionParams memory params) external view returns (
    address converter,
    uint maxTargetAmount,
    int apr18
  );

  /// @notice Get platformAdapter to which the converter belongs
  function getPlatformAdapter(address converter_) external view returns (address);

  /// @notice Return health factor with decimals 2 for the asset
  ///         If there is no custom value for asset, target health factor from the controller should be used
  function getTargetHealthFactor2(address asset) external view returns (uint);

  /// @notice Get all pool adapters registered for the user
  /// @dev Return both opened and closed positions
  function getPoolAdaptersForUser(
    address user_
  ) external view returns (address[] memory poolAdapters);
}
