// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../openzeppelin/Clones.sol";
import "../interfaces/IController.sol";
import "../interfaces/IBorrowManager.sol";
import "../interfaces/IPoolAdapter.sol";
import "../core/AppErrors.sol";
import "../interfaces/IPlatformAdapter.sol";

/// @notice Maintain list of registered pool adapters
abstract contract BorrowManagerBase is IBorrowManager {
  using Clones for address;

  IController public immutable controller;

  /// @notice Complete list ever created pool adapters
  /// @dev converter => user => collateral => borrowToken => address of the pool adapter
  mapping (address => mapping(address => mapping(address => mapping(address => address)))) public poolAdapters;
  /// @notice Pool adapter => is registered
  mapping (address => bool) poolAdaptersRegistered;

  ///////////////////////////////////////////////////////
  ///         Constructor
  ///////////////////////////////////////////////////////
  constructor (address controller_) {
    require(controller_ != address(0), AppErrors.ZERO_ADDRESS);
    controller = IController(controller_);
  }

  ///////////////////////////////////////////////////////
  ///         Abstract functions
  ///////////////////////////////////////////////////////

  function _getPlatformAdapter(address converter_) internal view virtual returns(address);

  ///////////////////////////////////////////////////////
  ///         Minimal proxy creation
  ///////////////////////////////////////////////////////

  /// @notice Register a pool adapter for (pool, user, collateral) if the adapter wasn't created before
  function registerPoolAdapter(
    address converter_,
    address user_,
    address collateral_,
    address borrowToken_
  ) external override returns (address) {
    address dest = poolAdapters[converter_][user_][collateral_][borrowToken_];
    if (dest == address(0) ) {
      // create an instance of the pool adapter using minimal proxy pattern, initialize newly created contract
      dest = converter_.clone();
      IPlatformAdapter(_getPlatformAdapter(converter_)).initializePoolAdapter(
        converter_,
        dest,
        user_,
        collateral_,
        borrowToken_
      );

      // register newly created pool adapter in the list of the pool adapters forever
      poolAdapters[converter_][user_][collateral_][borrowToken_] = dest;
      poolAdaptersRegistered[dest] = true;
    }
    return dest;
  }

  ///////////////////////////////////////////////////////
  ///               View
  ///////////////////////////////////////////////////////
  /// @notice Get pool adapter or 0 if the pool adapter is not registered
  function getPoolAdapter(
    address converter_,
    address user_,
    address collateral_,
    address borrowToken_
  ) external view override returns (address) {
    return poolAdapters[converter_][user_][collateral_][borrowToken_];
  }

  function isPoolAdapter(address poolAdapter_) external view override returns (bool) {
    return poolAdaptersRegistered[poolAdapter_];
  }
}