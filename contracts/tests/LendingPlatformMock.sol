// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../core/DataTypes.sol";
import "../interfaces/ILendingPlatform.sol";
import "hardhat/console.sol";

contract LendingPlatformMock is ILendingPlatform {
  /// @notice pool => underline => cf
  mapping(address => mapping(address => uint256)) public collateralFactors;

  /// @notice asset => underline => borrowRates
  mapping(address => mapping(address => uint256)) public borrowRates;
  /// @notice asset => underline => liquidity
  mapping(address => mapping(address => uint256)) public liquidity;

  constructor(
    address[] memory pools_,
    address[] memory underlines_,
    uint[] memory collateralFactors_,
    uint[] memory borrowRates_,
    uint[] memory liquidity_
  ) {
    require(pools_.length == collateralFactors_.length, "wrong lengths 2");
    require(pools_.length == borrowRates_.length, "wrong lengths 1");
    require(pools_.length == liquidity_.length, "wrong lengths 3");
    require(pools_.length == underlines_.length, "wrong lengths 4");

    for (uint i = 0; i < pools_.length; ++i) {
      collateralFactors[pools_[i]][underlines_[i]] = collateralFactors_[i];
      borrowRates[pools_[i]][underlines_[i]] = borrowRates_[i];
      liquidity[pools_[i]][underlines_[i]] = liquidity_[i];

      console.log("LendingPlatformMock pool=%s underline=%s", pools_[i], underlines_[i]);
      console.log("collateralFactor=%d", collateralFactors_[i]);
      console.log("borrowRate=%d", borrowRates_[i]);
      console.log("liquidity=%d", liquidity_[i]);
    }
  }

  /// @notice get data of the pool
  /// @param pool = comptroller
  /// @return borrowRatePerBlock Normalized borrow rate can include borrow-rate-per-block + any additional fees
  /// @return collateralFactor Current collateral factor [0..1e18], where 1e18 is corresponded to CF=1
  /// @return availableCash Available underline in the pool. 0 if the market is unlisted
  function getPoolInfo(address pool, address underline)
  external
  view
  override
  returns (
    uint borrowRatePerBlock,
    uint collateralFactor,
    uint availableCash
  ) {
    console.log("getPoolInfo pools=%s underline=%s", pool, underline);
    collateralFactor = collateralFactors[pool][underline];
    availableCash = liquidity[pool][underline];
    borrowRatePerBlock = borrowRates[pool][underline];
  }

  /// @notice Convert {sourceAmount_} to {targetAmount} using borrowing
  /// @param sourceToken_ Input asset
  /// @param sourceAmount_ TODO requirements
  /// @param targetToken_ Target asset
  /// @param targetAmount_ TODO requirements
  /// @param receiver_ Receiver of cTokens
  function openPosition (
    address pool_,
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint targetAmount_,
    address receiver_
  ) external override {
    //TODO _supplyAndBorrow(pool_, sourceToken_, sourceAmount_, targetToken_, targetAmount_);
    //TODO: send borrowed amount to receiver
  }
}