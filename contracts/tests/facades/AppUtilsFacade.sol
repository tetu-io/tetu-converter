// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../libs/AppUtils.sol";

/// @notice Facade to call internal functions from AppUtils library (for tests)
contract AppUtilsFacade {
  function toMantissa(uint amount, uint8 sourceDecimals, uint8 targetDecimals) external pure returns (uint) {
    return AppUtils.toMantissa(amount, sourceDecimals, targetDecimals);
  }

//  function removeItemFromArray(address[] storage items, address itemToRemove) external {
//    AppUtils.removeItemFromArray(items, itemToRemove);
//  }

  function removeLastItems(address[] memory items_, uint countItemsToKeep_) external pure returns (address[] memory) {
    return AppUtils.removeLastItems(items_, countItemsToKeep_);
  }

  function removeLastItems(uint[] memory items_, uint countItemsToKeep_) external pure returns (uint[] memory) {
    return AppUtils.removeLastItems(items_, countItemsToKeep_);
  }

  function approxEqual(uint amount1, uint amount2, uint divisionMax18) external pure returns (bool) {
    return AppUtils.approxEqual(amount1, amount2, divisionMax18);
  }

  function shrinkAndOrder(
    uint count_,
    address[] memory bb_,
    uint[] memory cc_,
    uint[] memory dd_,
    int[] memory aa_
  ) external pure returns (
    address[] memory bbOut,
    uint[] memory ccOut,
    uint[] memory ddOut,
    int[] memory aaOut
  ) {
    return AppUtils.shrinkAndOrder(count_, bb_, cc_, dd_, aa_);
  }
}
