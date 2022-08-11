// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../interfaces/IPoolAdapter.sol";
import "../interfaces/IController.sol";
import "../interfaces/IDebtsMonitor.sol";
import "../interfaces/IPriceOracle.sol";
import "../integrations/IERC20Extended.sol";
import "../interfaces/IBorrowManager.sol";
import "../interfaces/ITetuConverter.sol";
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

    (uint collateralAmount, uint amountToPay,,) = IPoolAdapter(msg.sender).getStatus();
    require(collateralAmount == 0 && amountToPay == 0, AppErrors.ATTEMPT_TO_CLOSE_NOT_EMPTY_BORROW_POSITION);

    positionsRegistered[msg.sender] = false;
    _removeItemFromArray(positions, msg.sender);

    (, address user, address collateralAsset, address borrowAsset) = IPoolAdapter(msg.sender).getConfig();
    _removeItemFromArray(poolAdapters[user][collateralAsset][borrowAsset], msg.sender);
  }

  ///////////////////////////////////////////////////////
  ///           Detect unhealthy positions
  ///////////////////////////////////////////////////////

  function checkForReconversion(
    uint startIndex0,
    uint maxCountToCheck,
    uint maxCountToReturn,
    uint16 healthFactor2,
    uint periodInBlocks
  ) external view override returns (
    uint nextIndexToCheck0,
    uint countFoundItems,
    address[] memory outPoolAdapters
  ) {
    ITetuConverter tc = ITetuConverter(controller.tetuConverter());
    outPoolAdapters = new address[](maxCountToReturn);

    if (startIndex0 + maxCountToCheck > positions.length) {
      maxCountToCheck = positions.length - startIndex0;
    }

    console.log("1");
    uint minAllowedHealthFactor = uint(IController(controller).getMinHealthFactor2()) * 10**(18-2);
    console.log("2");

    // enumerate all pool adapters
    for (uint i = 0; i < maxCountToCheck; i = _uncheckedInc(i)) {
      console.log("i");
      nextIndexToCheck0 += 1;

      // check if we need to make rebalancing because of too low health factor
      IPoolAdapter pa = IPoolAdapter(positions[startIndex0 + i]);
      (uint collateralAmount,, uint healthFactor18,) = pa.getStatus();
      console.log("checkForReconversion: healthFactor18=%d pool-adapter=%s", healthFactor18, address(pa));
      if (healthFactor18 < minAllowedHealthFactor
        || _findBetterBorrowWay(tc, pa, collateralAmount, healthFactor2, periodInBlocks)
      ) {
        outPoolAdapters[countFoundItems] = positions[startIndex0 + i];
        countFoundItems += 1;
        if (countFoundItems == maxCountToReturn) {
          break;
        }
      }
    }

    if (nextIndexToCheck0 == positions.length) {
      nextIndexToCheck0 = 0; // all items were checked
    }

    return (nextIndexToCheck0, countFoundItems, outPoolAdapters);
  }

  function _findBetterBorrowWay(
    ITetuConverter tc_,
    IPoolAdapter pa_,
    uint sourceAmount_,
    uint16 healthFactor2_,
    uint periodInBlocks_
  ) internal view returns (bool) {
    // check if we can re-borrow the asset in different place with higher profit
    (address origin,, address sourceToken, address targetToken) = pa_.getConfig();
    (address converter,, uint aprForPeriod18) = tc_.findConversionStrategy(
      sourceToken, sourceAmount_, targetToken, healthFactor2_, periodInBlocks_
    );
    uint currentApr18 = pa_.getAPR18() * periodInBlocks_;

    // make decision if the found conversion-strategy is worth to be used
    if (origin != converter) {
      //TODO: we need some decision making rules here
      //1) threshold for APRs difference, i.e. (apr0-apr1)/apr0 > 20%
      //2) threshold for block number: count blocks since prev rebalancing should exceed the threshold.
      return currentApr18 != 0
        && (currentApr18 - aprForPeriod18) * 100 / currentApr18 > 20
        ;
    }
    return false;
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
