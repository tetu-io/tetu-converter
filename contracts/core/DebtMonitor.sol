// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "./DataTypes.sol";
import "../interfaces/IPoolAdapter.sol";

/// @notice Collects list of registered loans. Allow to check state of the loan collaterals.
contract DebtMonitor {

  /// @notice Pool adapters with active borrow positions
  IPoolAdapter[] public poolAdapters;

}
