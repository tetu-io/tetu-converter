// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

library DataTypes {

  struct LendingPlatform {
    uint lendingPlatformUid;
    string title;

    /// @dev address of corresponded LpXXX contract, that implements ILendingPlatform
    address decorator;

    /// @notice It's not-allowed to use this market to make new loans
    bool isBorrowingDisabled;

    address[] pools;
  }

//  /// @notice Lending pool
//  struct PoolData {
//    /// @dev I.e. fuse pools is a cToken, it supports ICErc20
//    address pool;
//    /// @notice List of assets supported by the pool. Any asset can be source and any asset can be target
//    address[] assets;
//  }

  struct BorrowParams {
    /// @notice Asset to be used as collateral
    address sourceToken;
    /// @notice Max available amount of collateral
    uint sourceAmount;
    /// @notice Asset to borrow
    address targetToken;
    /// @notice Required amount to borrow
    uint targetAmount;
    /// @notice Minimal allowed health factor, decimals 18
    uint minHealthFactor;
    /// @notice Estimated duration of the borrowing in count of Ethereum blocks
    uint borrowDurationInBlocks;
  }
}