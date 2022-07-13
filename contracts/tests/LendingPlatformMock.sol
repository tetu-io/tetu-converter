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

  /// @notice Get normalized borrow rate per block, scaled by 1e18
  /// @dev Normalized borrow rate can include borrow-rate-per-block + any additional fees
  function getBorrowRate(
    address pool,
    address sourceToken,
    address targetToken
  ) external view override returns (uint) {
    return borrowRates[pool][targetToken];
  }

  function borrow(
    address pool,
    DataTypes.BorrowParams calldata params
  ) external override {
    //TODO
  }

  /// @notice get data of the pool
  /// @return outCollateralFactor Current collateral factor [0..1e18], where 1e18 is corresponded to CF=1
  function getPoolInfo(address pool, address underline) external view override returns (uint outCollateralFactor) {
    console.log("LendingPlatformMock.getPoolInfo pool=%s cf=%d underline=%s", pool, collateralFactors[pool][underline], underline);
    return collateralFactors[pool][underline];
  }

  /// @notice get data of the underline of the pool
  /// @return outLiquidity Amount of the underlying token that is unborrowed in the pool
  function getAssetInfo(address pool, address underline) external view override returns (uint outLiquidity) {
    console.log("LendingPlatformMock.getAssetInfo pool=%s liquidity=%d underline=%s", pool, outLiquidity, underline);
    return liquidity[pool][underline];
  }

}