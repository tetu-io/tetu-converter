// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../core/DataTypes.sol";

/// @notice Main contract of the TetuConverter application
interface ITetuConverter {

  /// @notice Find best conversion strategy (swap or lending) and provide "cost of money" as interest for the period
  /// @param sourceAmount Amount to be converted
  /// @param healthFactorOptional For lending: min allowed health factor; 0 - use default value
  /// @return outPool Result pool or 0 if a pool is not found
  /// @return outAdapter IConverter that should be used to use the pool for conversion
  /// @return outMaxTargetAmount Max available amount of target tokens that we can get after conversion
  /// @return outInterest Interest on the use of {outMaxTargetAmount} during the period {approxOwnershipPeriodInBlocks}
  ///                     decimals 18
  function findBestConversionStrategy(
    address sourceToken,
    uint sourceAmount,
    address targetToken,
    uint96 healthFactorOptional,
    uint approxOwnershipPeriodInBlocks
  ) external view returns (
    address outPool,
    address outAdapter,
    uint outMaxTargetAmount,
    uint outInterest
  );

}