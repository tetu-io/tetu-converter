// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "./DataTypes.sol";
import "../interfaces/ITetuConverter.sol";
import "../interfaces/IBorrowManager.sol";
import "../integrations/market/ICErc20.sol";
import "../integrations/IERC20Extended.sol";

abstract contract TetuConverterStorage is ITetuConverter {
  //TODO contract version

  uint constant public CONVERSION_WAY_NOT_FOUND = 0;
  uint constant public CONVERSION_SWAP = 1;
  uint constant public CONVERSION_LENDING = 2;

  IBorrowManager public borrowManager;

  /// @notice Save asset-balance at the end of every borrow function and read them at the beginning
  ///         The differences between stored balance and actual balanc is amount of tokens provided as collateral
  /// @dev See explanation to swap, https://docs.uniswap.org/protocol/V2/concepts/core-concepts/swaps
  mapping (address => uint) reserves;
}