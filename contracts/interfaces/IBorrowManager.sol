// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../core/AppDataTypes.sol";
import "./IPoolAdaptersManager.sol";

/// @notice Manage list of available lending platforms
interface IBorrowManager is IPoolAdaptersManager {

  /// @notice Register new lending platform
  /// @param platformAdapter_ Implementation of IPlatformAdapter attached to the specified pool
  /// @param assets_ All assets supported by the pool
  function addPool(address platformAdapter_, address[] calldata assets_) external;

  /// @notice Set default health factor for {asset}. Default value is used only if user hasn't provided custom value
  /// @param value2 Health factor must be greater then 1, decimals 2
  function setHealthFactor(address asset, uint16 value2) external;

  /// @notice Find lending pool capable of providing {targetAmount} and having best normalized borrow rate
  /// @return converter Result template-pool-adapter or 0 if a pool is not found
  /// @return maxTargetAmount Max available amount of target tokens that we can borrow using {sourceAmount}
  /// @return aprForPeriod18 Annual Percentage Rate (normalized borrow rate) == APR-per-block * count blocks
  function findConverter(AppDataTypes.InputConversionParams memory params) external view returns (
    address converter,
    uint maxTargetAmount,
    uint aprForPeriod18
  );

  /// @notice Get platformAdapter to which the converter belongs
  function getPlatformAdapter(address converter_) external view returns (address);
}
