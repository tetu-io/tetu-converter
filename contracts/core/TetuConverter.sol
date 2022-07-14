// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "./TetuConverterStorage.sol";
import "../interfaces/ITetuConverter.sol";
import "../third_party/market/ICErc20.sol";
import "../third_party/IERC20Extended.sol";
import "hardhat/console.sol";

/// @notice Main application contract
contract TetuConverter is TetuConverterStorage {

  constructor(address borrowManager_) {
    require(borrowManager_ != address(0), "zero address");

    borrowManager = IBorrowManager(borrowManager_);
  }

  /// @notice Find best conversion strategy (swap or lending) and provide "cost of money" as interest for the period
  /// @param sourceAmount Amount to be converted
  /// @param targetAmount Minimum required amount that should be received
  /// @param healthFactorOptional For lending: min allowed health factor; 0 - use default value
  /// @return outStrategyKind 0 - not found, 1 - Swap, 2 - lending
  /// @return outPool Result pool or 0 if a pool is not found
  /// @return outMaxTargetAmount Max available amount of target tokens that we can get after conversion
  /// @return outInterestPerPeriod Pool normalized borrow rate per ethereum block
  function findBestConversionStrategy(
    address sourceToken,
    uint sourceAmount,
    address targetToken,
    uint targetAmount,
    uint96 healthFactorOptional,
    uint approxOwnershipPeriodInBlocks
  ) external view override returns (
    uint outStrategyKind,
    address outPool,
    uint outMaxTargetAmount,
    uint outInterestPerPeriod
  ) {
    outStrategyKind = CONVERSION_LENDING;
    (address pool, uint br, uint mta) = borrowManager.findPool(
      sourceToken,
      sourceAmount,
      targetToken,
      targetAmount,
      healthFactorOptional
    );
    if (pool == address(0)) {
      return (CONVERSION_WAY_NOT_FOUND, address(0), 0, 0);
    } else {
      uint interest = br * 5; //stub, TODO
      return (CONVERSION_LENDING, pool, mta, interest);
    }
  }

  /// @notice Borrow {targetAmount} from the pool using {sourceAmount} as collateral.
  /// @dev Result health factor cannot be less the default health factor specified for the target asset by governance.
  /// @param sourceToken Asset to be used as collateral
  /// @param sourceAmount Max available amount of collateral
  /// @param targetToken Asset to borrow
  /// @param targetAmount Required amount to borrow
  function borrow (
    address pool,
    address sourceToken,
    uint sourceAmount,
    address targetToken,
    uint targetAmount
  ) external override {
    //TODO
  }
}