// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../core/AppDataTypes.sol";

interface ISwapManager {

  /// @notice Find a way to convert collateral asset to borrow asset in most efficient way
  /// @return converter Address of ISwapConverter
  ///         If SwapManager cannot find a conversion way,
  ///         it returns converter == 0 (in the same way as ITetuConverter)
  function getConverter(
    AppDataTypes.InputConversionParams memory params
  ) external view returns (
    address converter,
    uint maxTargetAmount,
    int apr18
  );

}
