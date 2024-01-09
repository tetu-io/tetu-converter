// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./AppErrors.sol";
import "../openzeppelin/IERC20.sol";
import "../openzeppelin/SafeERC20.sol";

/// @notice Common utils
library AppUtils {
  using SafeERC20 for IERC20;

  /// @notice Convert {amount} with [sourceDecimals} to new amount with {targetDecimals}
  function toMantissa(uint amount, uint8 sourceDecimals, uint8 targetDecimals) internal pure returns (uint) {
    return sourceDecimals == targetDecimals
      ? amount
      : amount * (10 ** targetDecimals) / (10 ** sourceDecimals);
  }

  function uncheckedInc(uint i) internal pure returns (uint) {
    unchecked {
      return i + 1;
    }
  }

  /// @notice Remove {itemToRemove} from {items}, move last item of {items} to the position of the removed item
  function removeItemFromArray(address[] storage items, address itemToRemove) internal {
    uint lenItems = items.length;
    for (uint i = 0; i < lenItems; i = uncheckedInc(i)) {
      if (items[i] == itemToRemove) {
        if (i < lenItems - 1) {
          items[i] = items[lenItems - 1];
        }
        items.pop();
        break;
      }
    }
  }

  /// @notice Create new array with only first {countItemsToKeep_} items from {items_} array
  /// @dev We assume, that trivial case countItemsToKeep_ == 0 is excluded, the function is not called in that case
  function removeLastItems(address[] memory items_, uint countItemsToKeep_) internal pure returns (address[] memory) {
    uint lenItems = items_.length;
    if (lenItems <= countItemsToKeep_) {
      return items_;
    }

    address[] memory dest = new address[](countItemsToKeep_);
    for (uint i = 0; i < countItemsToKeep_; i = uncheckedInc(i)) {
      dest[i] = items_[i];
    }

    return dest;
  }

  /// @dev We assume, that trivial case countItemsToKeep_ == 0 is excluded, the function is not called in that case
  function removeLastItems(uint[] memory items_, uint countItemsToKeep_) internal pure returns (uint[] memory) {
    uint lenItems = items_.length;
    if (lenItems <= countItemsToKeep_) {
      return items_;
    }

    uint[] memory dest = new uint[](countItemsToKeep_);
    for (uint i = 0; i < countItemsToKeep_; i = uncheckedInc(i)) {
      dest[i] = items_[i];
    }

    return dest;
  }

  /// @notice (amount1 - amount2) / amount1/2 < expected difference
  function approxEqual(uint amount1, uint amount2, uint divisionMax18) internal pure returns (bool) {
    return amount1 > amount2
      ? (amount1 - amount2) * 1e18 / (amount2 + 1) < divisionMax18
      : (amount2 - amount1) * 1e18 / (amount2 + 1) < divisionMax18;
  }

  /// @notice Insertion sorting algorithm for using with arrays fewer than 10 elements, insert in ascending order.
  ///         Take into account only  {length_} items of the {items_} array starting from {startIndex_}
  /// @dev Based on https://medium.com/coinmonks/sorting-in-solidity-without-comparison-4eb47e04ff0d
  /// @param startIndex_ Start index of the range to be sorted, assume {length_} + {startIndex_} <= {items_}.length
  /// @param length_ Count items to be sorted, assume {length_} <= {items_}.length
  /// @param destIndices Ordered list of indices of the {items_}. Assume {destIndices}.length == {items_}.length
  ///        Index for the i-th item is stored in destIndices[i]
  function _sortAsc(uint startIndex_, uint length_, int[] memory items_, uint[] memory destIndices) internal pure {
    unchecked {
      for (uint i; i < length_; ++i) {
        destIndices[i + startIndex_] = i + startIndex_;
      }

      for (uint i = 1; i < length_; i++) {
        uint key = destIndices[i + startIndex_];
        uint j = i - 1;
        while ((int(j) >= 0) && items_[destIndices[startIndex_ + j]] > items_[key]) {
          destIndices[startIndex_ + j + 1] = destIndices[startIndex_ + j];
          j--;
        }
        destIndices[startIndex_ + j + 1] = key;
      }
    }
  }

  /// @notice Return a-b OR zero if a < b
  function sub0(uint a, uint b) internal pure returns (uint) {
    return a > b ? a - b : 0;
  }

  /// @notice Find index of the given {asset_} in array {tokens_}, return type(uint).max if not found
  function getAssetIndex(address[] memory tokens_, address asset_, uint lenTokens_) internal pure returns (uint) {
    for (uint i; i < lenTokens_; i = uncheckedInc(i)) {
      if (tokens_[i] == asset_) {
        return i;
      }
    }
    return type(uint).max;
  }

  function getChainID() internal view returns (uint256) {
    uint256 id;
    assembly {
      id := chainid()
    }
    return id;
  }

  /// @param asset Underlying, it can be native token
  function getBalance(address nativeToken, address asset) internal view returns (uint) {
    return nativeToken == asset
      ? address(this).balance
      : IERC20(asset).balanceOf(address(this));
  }

  /// @notice Set approve of {token} to {spender} to the given {amount}
  function setAllowance(address token, address spender, uint amount) internal {
    uint allowance = IERC20(token).allowance(address(this), spender);
    if (allowance < amount) {
      IERC20(token).safeIncreaseAllowance(spender, amount - allowance);
    } else if (allowance > amount) {
      IERC20(token).safeDecreaseAllowance(spender, allowance - amount);
    }
  }
}
