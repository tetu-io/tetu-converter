// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice cToken for native token, see:
//          Compound: CEther
//          Moonwell: MGlimmer
//          Hundred finance: hMatic
interface ICTokenNative {
  function mint() external payable;
  function repayBorrow() external payable;
}
