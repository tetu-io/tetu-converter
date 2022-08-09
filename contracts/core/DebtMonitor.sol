// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../interfaces/IPoolAdapter.sol";
import "../interfaces/IController.sol";
import "../interfaces/IDebtsMonitor.sol";
import "../interfaces/IPriceOracle.sol";
import "../integrations/IERC20Extended.sol";
import "../interfaces/IBorrowManager.sol";
import "./AppErrors.sol";
import "hardhat/console.sol";

/// @notice Manage list of open borrow positions
contract DebtMonitor is IDebtMonitor {
  IController public immutable controller;

  /// @notice Pool adapters with active borrow positions
  /// @dev All these pool adapters should be enumerated during health-checking
  address[] public positions;

  /// @notice Pool adapter => true if the pool adapter is registered in the {positions} list
  mapping(address => bool) public positionsRegistered;

  /// @notice user => collateral => borrowToken => poolAdapters
  mapping(address => mapping(address => mapping(address => address[]))) public poolAdapters;

  ///////////////////////////////////////////////////////
  ///       Constructor and initialization
  ///////////////////////////////////////////////////////

  constructor(address controller_) {
    require(controller_ != address(0), AppErrors.ZERO_ADDRESS);
    controller = IController(controller_);
  }


  ///////////////////////////////////////////////////////
  ///       On-borrow and on-repay logic
  ///////////////////////////////////////////////////////

  /// @dev This function is called from a pool adapter after any borrow
  function onOpenPosition() external override {
    console.log("DebtMonitor.onOpenPosition %s", msg.sender);
    _onlyPoolAdapter();

    if (!positionsRegistered[msg.sender]) {
      positionsRegistered[msg.sender] = true;
      positions.push(msg.sender);

      (, address user, address collateralAsset, address borrowAsset) = IPoolAdapter(msg.sender).getConfig();
      console.log("register position user=%s collateral=%s borrow=%s", user, collateralAsset, borrowAsset);
      console.log("pool adapter=%s", msg.sender);
      poolAdapters[user][collateralAsset][borrowAsset].push(msg.sender);
    }
  }

  /// @dev This function is called from a pool adapter after any repaying
  function onClosePosition() external override {
    console.log("DebtMonitor.onClosePosition %s", msg.sender);
    require(positionsRegistered[msg.sender], AppErrors.BORROW_POSITION_IS_NOT_REGISTERED);

    (uint collateralAmount, uint amountToPay,) = IPoolAdapter(msg.sender).getStatus();
    require(collateralAmount == 0 && amountToPay == 0, AppErrors.ATTEMPT_TO_CLOSE_NOT_EMPTY_BORROW_POSITION);

    positionsRegistered[msg.sender] = false;
    _removeItemFromArray(positions, msg.sender);

    (, address user, address collateralAsset, address borrowAsset) = IPoolAdapter(msg.sender).getConfig();
    _removeItemFromArray(poolAdapters[user][collateralAsset][borrowAsset], msg.sender);
  }

  ///////////////////////////////////////////////////////
  ///           Detect unhealthy positions
  ///////////////////////////////////////////////////////

  function findUnhealthyPositions(
    uint index0,
    uint maxCountToCheck,
    uint maxCountToReturn,
    uint minAllowedHealthFactor
  ) external view override returns (
    uint nextIndexToCheck0,
    uint countFoundItems,
    address[] memory outPoolAdapters
  ) {
    outPoolAdapters = new address[](maxCountToReturn);

    uint len = positions.length;
    if (index0 + maxCountToCheck > len) {
      maxCountToCheck = len - index0;
    }

    // enumerate all pool adapters
    for (uint i = 0; i < maxCountToCheck; i = _uncheckedInc(i)) {
      nextIndexToCheck0 += 1;
      IPoolAdapter pa = IPoolAdapter(positions[index0 + i]);
      (,, uint healthFactor18) = pa.getStatus();
      console.log("healthFactor18=%d minAllowedHealthFactor=%d", healthFactor18, minAllowedHealthFactor);
      if (healthFactor18 < minAllowedHealthFactor) {
        outPoolAdapters[countFoundItems] = positions[index0 + i];
        countFoundItems += 1;
        if (countFoundItems == maxCountToReturn) {
          break;
        }
      }
    }

    if (nextIndexToCheck0 == len) {
      nextIndexToCheck0 = 0; // all items were checked
    }

    return (nextIndexToCheck0, countFoundItems, outPoolAdapters);
  }

  /// @notice Get total count of pool adapters with opened positions
  function getCountPositions() external view override returns (uint) {
    return positions.length;
  }

  ///////////////////////////////////////////////////////
  ///      Get active borrows of the given user
  ///////////////////////////////////////////////////////
  function getPositions (
    address user_,
    address collateralToken_,
    address borrowedToken_
  ) external view override returns (
    address[] memory outPoolAdapters
  ) {
    console.log("get positions user=%s collateral=%s borrow=%s", user_, collateralToken_, borrowedToken_);

    address[] memory adapters = poolAdapters[user_][collateralToken_][borrowedToken_];
    uint countAdapters = adapters.length;

    outPoolAdapters = new address[](countAdapters);

    for (uint i = 0; i < countAdapters; i = _uncheckedInc(i)) {
      console.log("position %d pool adapter=%s", i, adapters[i]);
      outPoolAdapters[i] = adapters[i];
    }

    return outPoolAdapters;
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
    console.log("_onlyPoolAdapter", controller.borrowManager());
    IBorrowManager bm = IBorrowManager(controller.borrowManager());
    require(bm.isPoolAdapter(msg.sender), AppErrors.POOL_ADAPTER_ONLY);
  }

  /// @notice Ensure that msg.sender is registered pool adapter
  function _onlyGovernance() internal view {
    require(msg.sender == controller.governance(), AppErrors.GOVERNANCE_ONLY);
  }

  ///////////////////////////////////////////////////////
  ///               Arrays lengths
  ///////////////////////////////////////////////////////

  function positionsLength() external view returns (uint) {
    return positions.length;
  }

  function poolAdaptersLength(
    address user_,
    address collateralToken_,
    address borrowedToken_
  ) external view returns (uint) {
    return poolAdapters[user_][collateralToken_][borrowedToken_].length;
  }
}
