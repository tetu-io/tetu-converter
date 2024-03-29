// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../libs/AppUtils.sol";

/// @notice Facade to call internal functions from AppUtils library (for tests)
contract AppUtilsFacade {
  function toMantissa(uint amount, uint8 sourceDecimals, uint8 targetDecimals) external pure returns (uint) {
    return AppUtils.toMantissa(amount, sourceDecimals, targetDecimals);
  }

  function removeLastItems(address[] memory items_, uint countItemsToKeep_) external pure returns (address[] memory) {
    return AppUtils.removeLastItems(items_, countItemsToKeep_);
  }

  function removeLastItems(uint[] memory items_, uint countItemsToKeep_) external pure returns (uint[] memory) {
    return AppUtils.removeLastItems(items_, countItemsToKeep_);
  }

  function approxEqual(uint amount1, uint amount2, uint divisionMax18) external pure returns (bool) {
    return AppUtils.approxEqual(amount1, amount2, divisionMax18);
  }

  function _sortAsc(uint startIndex_, uint length_, int[] memory items_) external pure returns (uint[] memory destIndices) {
    destIndices = new uint[](items_.length);
    AppUtils._sortAsc(startIndex_, length_, items_, destIndices);
  }

  function getBalance(address nativeToken, address asset) external view returns (uint) {
    return AppUtils.getBalance(nativeToken, asset);
  }
}
