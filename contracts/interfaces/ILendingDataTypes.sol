// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

/// @notice Declare structures and enums related to borrowing
interface ILendingDataTypes {
  /// @notice Lending pool
  struct PoolData {
    /// @dev I.e. fuse pools is a cToken, it supports ICErc20
    address pool;
    address tokenIn;
    address tokenOut;
    /// @dev address of corresponded LpXXX contract, that is able to work with the pool in proper way
    address lpDecorator;
  }

}