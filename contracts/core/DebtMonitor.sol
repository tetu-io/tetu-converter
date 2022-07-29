// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../interfaces/IPoolAdapter.sol";
import "../interfaces/IController.sol";
import "../interfaces/IDebtsMonitor.sol";
import "../interfaces/IPriceOracle.sol";
import "../integrations/IERC20Extended.sol";
import "../interfaces/IBorrowManager.sol";
import "hardhat/console.sol";

/// @notice Collects list of open borrow positions
contract DebtMonitor is IDebtMonitor {
  IController public immutable controller;

  /// @notice Pool adapters with active borrow positions
  /// @dev All these pool adapters should be enumerated during health-checking
  address[] public positions;

  /// @notice Pool adapter => true if the pool adapter is registered in the {positions} list
  mapping(address => bool) positionsRegistered;

  /// @notice user => collateral => borrowToken => poolAdapters
  mapping(address => mapping(address => mapping(address => address[]))) public poolAdapters;

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
  function onOpenPosition() external override {
    _onlyPoolAdapter();

    if (!positionsRegistered[msg.sender]) {
      positionsRegistered[msg.sender] = true;
      positions.push(msg.sender);

      (, address user, address collateralAsset, address borrowAsset) = IPoolAdapter(msg.sender).getConfig();
      poolAdapters[user][collateralAsset][borrowAsset].push(msg.sender);
    }
  }

  /// @dev This function is called from a pool adapter after any repaying
  function onClosePosition() external override {
    require(positionsRegistered[msg.sender] != 0, Errors.BORROW_POSITION_IS_NOT_REGISTERED);

    (collateralAmount, amountToPay,,) = IPoolAdapter(msg.sender).getStatus();
    require(collateralAmount == 0 && amountToPay == 0, Errors.ATTEMPT_TO_CLOSE_NOT_EMPTY_BORROW_POSITION);

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
    address[] outPoolAdapter
  ) {
    outBorrowedTokens = new address[](count);

    uint len = poolAdapters.length;
    if (index0 + count > len) {
      count = len - index0;
    }

    // enumerate all pool adapters
    for (uint i = 0; i < count; i = _uncheckedInc(i)) {
      IPoolAdapter pa = IPoolAdapter(poolAdapters[i]);
      (outCountBorrowedTokens, outBorrowedTokens) = _getUnhealthyTokens(pa, minAllowedHealthFactor);
      if (outCountBorrowedTokens != 0) {
        outPoolAdapter = poolAdapters[i];
        outNextIndex0 = i + 1;
        break; // we have found first problem pool adapter
      }
    }

    // we return outNextIndex0 = 0 if there are no unhealthy pool adapters
    return (outNextIndex0, outPoolAdapter, outCountBorrowedTokens, outBorrowedTokens);
  }

  function getUnhealthyTokens(address poolAdapter_, uint minAllowedHealthFactor_)
  external
  view override returns (uint outCountBorrowedTokens, address[] memory outBorrowedTokens) {
    return _getUnhealthyTokens(IPoolAdapter(poolAdapter_), minAllowedHealthFactor_);
  }

  function _getUnhealthyTokens(IPoolAdapter pa, uint minAllowedHealthFactor)
  internal
  view returns (uint outCountBorrowedTokens, address[] memory outBorrowedTokens) {
    // get a price of the collateral
    uint8 collateralDecimals = IERC20Extended(pa.collateralToken()).decimals();
    uint collateralPrice18 = _getPrice18(pa.collateralToken());
    uint cf = pa.collateralFactor();

    // enumerate all borrowed tokens inside the pool adapter
    (uint outCountItems,
     address[] memory bTokens,
     uint[] memory collateralAmountsCT,
     uint[] memory amountsToPayBT
    ) = pa.getOpenedPositions();

    for (uint j = 0; j < outCountItems; j = _uncheckedInc(j)) {
      // calculate health factor for the borrowed token
      uint8 borrowedTokenDecimals = IERC20Extended(bTokens[j]).decimals();
      uint borrowedTokenPrice18 = _getPrice18(bTokens[j]);

      // HF = CollateralFactor * (CollateralAmount * CollateralPrice) / (AmountToPayBT * PriceBorrowedToken)
      uint healthFactor = cf
        * (_toMantissa(collateralAmountsCT[j], collateralDecimals, 18) * collateralPrice18)
        / (_toMantissa(amountsToPayBT[j], borrowedTokenDecimals, 18) * borrowedTokenPrice18);

      if (healthFactor < minAllowedHealthFactor) {
        if (outCountBorrowedTokens == 0) {
          // lazy initialization of outBorrowedTokens
          // we should allocate memory for all remaining tokens
          outBorrowedTokens = new address[](outCountItems - j);
        }
        outBorrowedTokens[outCountBorrowedTokens] = bTokens[j];
        outCountBorrowedTokens += 1;
      }
    }

    return (outCountBorrowedTokens, outBorrowedTokens);
  }

  /// @notice Get total count of pool adapters with opened positions
  function getCountPositions() external view override returns (uint) {
    return poolAdapters.length;
  }

  ///////////////////////////////////////////////////////
  ///      Get active borrows of the given user
  ///////////////////////////////////////////////////////
  function getPositions (
    address user_,
    address collateralToken_,
    address borrowedToken_
  ) external view override returns (
    uint countItems,
    address[] memory poolAdapters,
    uint[] memory amountsToPay
  ) {
    address[] memory adapters = poolAdapters[user_][collateralToken_][borrowedToken_];
    uint countAdapters = adapters.length;

    poolAdapters = new address[](countAdapters);
    amountsToPay = new uint[](countAdapters);

    for (uint i = 0; i < countAdapters; ++i) {
      IPoolAdapter pa = IPoolAdapter(adapters[i]);
      (, uint amountToPay,) = pa.getStatus();
      if (amountToRepay != 0) {
        poolAdapters[countItems] = adapters[i];
        amountsToPay[countItems] = amountToPay;
        countItems++;
      }
    }

    return (countItems, poolAdapters, amountsToPay);
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

  /// @notice Get price of single {asset}-token in $, decimals 18
  function _getPrice18(address asset) internal view returns(uint) {
    uint price = IPriceOracle(controller.priceOracle()).getAssetPrice(asset);
    require (price != 0, Errors.ZERO_PRICE);
    return price;
  }

  /// @notice Convert {amount} with [sourceDecimals} to new amount with {targetDecimals}
  function _toMantissa(uint amount, uint8 sourceDecimals, uint8 targetDecimals) internal pure returns (uint) {
    return sourceDecimals == targetDecimals
    ? amount
    : amount * (10 ** targetDecimals) / (10 ** sourceDecimals);
  }

  /// @notice Ensure that msg.sender is registered pool adapter
  function _onlyPoolAdapter() internal view {
    IBorrowManager bm = IBorrowManager(controller.borrowManager());
    require(bm.isPoolAdapter(msg.sender) != address(0), Errors.POOL_ADAPTER_ONLY);
  }

  /// @notice Ensure that msg.sender is registered pool adapter
  function _onlyGovernance() internal view {
    require(msg.sender == controller.governance(), Errors.GOVERNANCE_ONLY);
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
