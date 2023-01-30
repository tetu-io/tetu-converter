// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

/// @notice Keep and provide addresses of all application contracts
interface IController {
  function governance() external view returns (address);

  /// ********************* Health factor explanation  ****************
  /// For example, a landing platform has: liquidity threshold = 0.85, LTV=0.8, LTV / LT = 1.0625
  /// For collateral $100 we can borrow $80. A liquidation happens if the cost of collateral will reduce below $85.
  /// We set min-health-factor = 1.1, target-health-factor = 1.3
  /// For collateral 100 we will borrow 100/1.3 = 76.92
  ///
  /// Collateral value   100        77            assume that collateral value is decreased at 100/77=1.3 times
  /// Collateral * LT    85         65.45
  /// Borrow value       65.38      65.38         but borrow value is the same as before
  /// Health factor      1.3        1.001         liquidation almost happens here (!)
  ///
  /// So, if we have target factor 1.3, it means, that if collateral amount will decreases at 1.3 times
  /// and the borrow value won't change at the same time, the liquidation happens at that point.
  /// Min health factor marks the point at which a rebalancing must be made asap.
  /// *****************************************************************

  /// @notice min allowed health factor with decimals 2, must be >= 1e2
  function minHealthFactor2() external view returns (uint16);
  function setMinHealthFactor2(uint16 value_) external;

  /// @notice target health factor with decimals 2
  /// @dev If the health factor is below/above min/max threshold, we need to make repay
  ///      or additional borrow and restore the health factor to the given target value
  function targetHealthFactor2() external view returns (uint16);
  function setTargetHealthFactor2(uint16 value_) external;

  /// @notice max allowed health factor with decimals 2
  /// @dev For future versions, currently max health factor is not used
  function maxHealthFactor2() external view returns (uint16);
  /// @dev For future versions, currently max health factor is not used
  function setMaxHealthFactor2(uint16 value_) external;

  /// @notice get current value of blocks per day. The value is set manually at first and can be auto-updated later
  function blocksPerDay() external view returns (uint);
  /// @notice set value of blocks per day manually and enable/disable auto update of this value
  function setBlocksPerDay(uint blocksPerDay_, bool enableAutoUpdate_) external;
  /// @notice Check if it's time to call updateBlocksPerDay()
  /// @param periodInSeconds_ Period of auto-update in seconds
  function isBlocksPerDayAutoUpdateRequired(uint periodInSeconds_) external view returns (bool);
  /// @notice Recalculate blocksPerDay value
  /// @param periodInSeconds_ Period of auto-update in seconds
  function updateBlocksPerDay(uint periodInSeconds_) external;


  ///////////////////////////////////////////////////////
  ///        Core application contracts
  ///////////////////////////////////////////////////////

  function tetuConverter() external view returns (address);
  function borrowManager() external view returns (address);
  function debtMonitor() external view returns (address);
  function tetuLiquidator() external view returns (address);
  function swapManager() external view returns (address);
  function priceOracle() external view returns (address);

  ///////////////////////////////////////////////////////
  ///        External contracts
  ///////////////////////////////////////////////////////
  /// @notice A keeper to control health and efficiency of the borrows
  function keeper() external view returns (address);

}
