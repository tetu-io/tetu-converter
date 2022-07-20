// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "./DataTypes.sol";
import "../interfaces/IPoolAdapter.sol";
import "../interfaces/IController.sol";
import "../interfaces/IDebtsMonitor.sol";

/// @notice Collects list of registered loans. Allow to check state of the loan collaterals.
contract DebtMonitor is IDebtMonitor{
  IController immutable controller;

  /// @notice Pool adapters with active borrow positions
  /// @dev All these pool adapters should be enumerated during health-checking
  address[] public poolAdapters;

  /// @notice pool adapter => cToken => borrowed token => amount of cTokens
  mapping(address => mapping (address => mapping(address => uint))) public activeCollaterals;

  /// @notice pool adapter => cToken => borrowed tokens
  mapping(address => mapping (address => address[])) public borrowedTokens;

  /// @notice true if the pool adapter is registered in {poolAdapters}
  /// @dev pool adapter => bool
  mapping(address => bool) registeredPoolAdapters;

  /// @notice true if the borrow token is already registered in {borrowedTokens} for the pool adapter
  /// @dev pool adapter => cToken => borrow token => bool
  mapping(address => mapping (address => mapping (address => bool))) registeredBorrowTokens;

  ///////////////////////////////////////////////////////
  ///       Constructor and initialization
  ///////////////////////////////////////////////////////

  constructor(address controller_) {
    require(controller_ != address(0), "zero controller");
    controller = IController(controller_);
  }


  ///////////////////////////////////////////////////////
  ///       On-borrow and on-repay logic
  ///////////////////////////////////////////////////////

  /// @dev This function is called from a pool adapter after any borrow
  function onBorrow(address cToken_, uint amountReceivedCTokens_, address borrowedToken_) external override {
    _onlyPoolAdapter();

    require(cToken_ != address(0) && borrowedToken_ != address(0), "zero address");
    require(amountReceivedCTokens_ != 0, "zero amount");

    bool isBorrowTokenRegistered;

    if (registeredPoolAdapters[msg.sender]) {
      // increment amount of the exist position
      activeCollaterals[msg.sender][cToken_][borrowedToken_] += amountReceivedCTokens_;
      isBorrowTokenRegistered = registeredBorrowTokens[msg.sender][cToken_][borrowedToken_];
    } else {
      // add new pool adapter
      poolAdapters.push(msg.sender);
      registeredPoolAdapters[msg.sender] = true;

      // set initial amount for the new position
      activeCollaterals[msg.sender][cToken_][borrowedToken_] = amountReceivedCTokens_;
    }

    if (! isBorrowTokenRegistered) {
      borrowedTokens[msg.sender][cToken_].push(borrowedToken_);
      registeredBorrowTokens[msg.sender][cToken_][borrowedToken_] = true;
    }
  }

  /// @dev This function is called from a pool adapter after any repaying
  function onRepay(address cToken_, uint amountBurntCTokens_, address borrowedToken_) external override {
    require(registeredPoolAdapters[msg.sender], "unregistered pool adapter");
    require(registeredBorrowTokens[msg.sender][cToken_][borrowedToken_], "unregistered borrowed token");
    require(amountBurntCTokens_ != 0, "zero amount");

    // get total amount of the given position
    uint amountTotal = activeCollaterals[msg.sender][cToken_][borrowedToken_];
    require(amountTotal >= amountBurntCTokens_, "amount is too big");
    bool removeBorrowedToken = amountTotal == amountBurntCTokens_;
    bool removePool = removeBorrowedToken && borrowedTokens[msg.sender][cToken_].length == 1;

    // decrease amount of the position on the amount of burnt c-tokens
    activeCollaterals[msg.sender][cToken_][borrowedToken_] -= amountBurntCTokens_;

    // unregister pool and borrowed token if necessary
    if (removeBorrowedToken) {
      _removeItemFromArray(borrowedTokens[msg.sender][cToken_], borrowedToken_);
      registeredBorrowTokens[msg.sender][cToken_][borrowedToken_] = false;
    }
    if (removePool) {
      _removeItemFromArray(poolAdapters, msg.sender);
      registeredPoolAdapters[msg.sender] = false;
    }
  }

  ///////////////////////////////////////////////////////
  ///           Detect unhealthy positions
  ///////////////////////////////////////////////////////

  /// @notice Enumerate {count} pool adapters starting from {index0} and return true if any of them is unhealthy
  function checkUnhealthyPoolAdapterExist(uint index0, uint count) external view override returns (bool) {
    return fasle; //TODO
  }

  /// @notice Get total count of pool adapters with opened positions
  function getCountActivePoolAdapters() external view override returns (uint) {
    return poolAdapters.length;
  }

  ///////////////////////////////////////////////////////
  ///               Utils
  ///////////////////////////////////////////////////////

  /// @notice Remove {itemToRemove} from {items}, move last item of {items} to the position of the removed item
  function _removeItemFromArray(address[] storage items, address itemToRemove) internal {
    uint lenItems = items.length;
    for (uint i = 0; i < lenItems; i = _uncheckedInc(i)) {
      if (items[i] == itemToRemove) {
        if (i < lenItems - 1) {
          items[i] = items[lenItems - 1];
        }
        items.pop();
        break;
      }
    }
  }

  function _uncheckedInc(uint i) internal pure returns (uint) {
    unchecked {
      return i + 1;
    }
  }

  /// @notice Ensure that msg.sender is registered pool adapter
  function _onlyPoolAdapter() internal view {
    //TODO
  }
}
