// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Restored from 0xEbd7f3349AbA8bB15b897e03D6c1a4Ba95B55e31 hMatic, all events and most functions were removed
interface IHfHMatic {
  function mint() external payable;
  function repayBorrow() external payable;
}
