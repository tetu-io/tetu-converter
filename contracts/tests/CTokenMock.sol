// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../core/AppDataTypes.sol";
import "../interfaces/IPlatformAdapter.sol";
import "hardhat/console.sol";
import "./MockERC20.sol";

/// @notice Partial implementation of ICErc20
contract CTokenMock is MockERC20 {
  address private _underline;

  constructor(
    string memory name_,
    string memory symbol_,
    uint8 decimals_,
    address underline_
  ) MockERC20(
    name_,
    symbol_,
    decimals_
  ) {
    _underline = underline_;
  }

  function underlying (  ) external view returns ( address ) {
    return _underline;
  }
}