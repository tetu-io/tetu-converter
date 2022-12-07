// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../core/AppDataTypes.sol";

interface ISwapManager {

  /// @notice Find a way to convert collateral asset to borrow asset in most efficient way
  /// @dev This is a writable function with read-only behavior
  ///      because to simulate real swap the function should be writable.
  /// @param sourceAmountApprover_ A contract which has approved {sourceAmount_} to TetuConverter
  /// @param sourceAmount_ Amount in terms of {sourceToken_} to be converter to {targetToken_}
  /// @return converter Address of ISwapConverter
  ///         If SwapManager cannot find a conversion way,
  ///         it returns converter == 0 (in the same way as ITetuConverter)
  function getConverter(
    address sourceAmountApprover_,
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_
  ) external returns (
    address converter,
    uint maxTargetAmount,
    int apr18
  );

  /// @notice Same as {getConverter} but it doesn't calculate APR, so it uses less gas
  function findConverter(
    address sourceAmountApprover_,
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_
  ) external returns (
    address converter,
    uint maxTargetAmount
  );
}
