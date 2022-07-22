// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "./DataTypes.sol";
import "../interfaces/IPoolAdapter.sol";
import "../interfaces/IController.sol";
import "../interfaces/IDebtsMonitor.sol";
import "../interfaces/IPriceOracle.sol";
import "../integrations/IERC20Extended.sol";
import "../interfaces/IBorrowManager.sol";
import "hardhat/console.sol";

/// @notice Collects list of registered loans. Allow to check state of the loan collaterals.
contract DebtMonitor is IDebtMonitor {
  IController public immutable controller;

  /// @notice Pool adapters with active borrow positions
  /// @dev All these pool adapters should be enumerated during health-checking
  address[] public poolAdapters;

  /// @notice user => pool-adapters
  mapping(address => address[]) public userToAdapters;

  /// @notice pool adapter => borrowed token => amount of cTokens
  mapping(address => mapping(address => uint)) public activeCollaterals;

  /// @notice pool adapter => borrowed tokens
  mapping(address => address[]) public borrowedTokens;

  /// @notice pool adapter => cToken
  /// @dev not 0 if the pool adapter is registered in {poolAdapters}
  mapping(address => address) public cTokensForPoolAdapters;

  /// @notice true if the borrow token is already registered in {borrowedTokens} for the pool adapter
  /// @dev pool adapter => borrow token => bool
  mapping(address => mapping (address => bool)) public registeredBorrowTokens;

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
    address registeredCToken = cTokensForPoolAdapters[msg.sender];

    if (registeredCToken == address(0)) {
      // add new pool adapter
      poolAdapters.push(msg.sender);
      cTokensForPoolAdapters[msg.sender] = cToken_;
      userToAdapters[IPoolAdapter(msg.sender).user()].push(msg.sender);

      // set initial amount for the new position
      activeCollaterals[msg.sender][borrowedToken_] = amountReceivedCTokens_;
    } else {
      require(registeredCToken == cToken_, "wrong cToken");
      // increment amount of the exist position
      activeCollaterals[msg.sender][borrowedToken_] += amountReceivedCTokens_;
      isBorrowTokenRegistered = registeredBorrowTokens[msg.sender][borrowedToken_];
    }

    if (! isBorrowTokenRegistered) {
      borrowedTokens[msg.sender].push(borrowedToken_);
      registeredBorrowTokens[msg.sender][borrowedToken_] = true;
    }
  }

  /// @dev This function is called from a pool adapter after any repaying
  function onRepay(address cToken_, uint amountBurntCTokens_, address borrowedToken_) external override {
    require(cTokensForPoolAdapters[msg.sender] == cToken_, "unregistered pool adapter");
    _onRepay(msg.sender, amountBurntCTokens_, borrowedToken_);
  }

  function onRepayBehalf(address borrower, address cToken_, uint amountBurntCTokens_, address borrowedToken_)
  external override {
    _onlyGovernance();
    require(cTokensForPoolAdapters[borrower] == cToken_, "unregistered pool adapter");
    _onRepay(borrower, amountBurntCTokens_, borrowedToken_);
  }

  function _onRepay(address borrower, uint amountBurntCTokens_, address borrowedToken_) internal {
    require(registeredBorrowTokens[borrower][borrowedToken_], "unregistered borrowed token");
    require(amountBurntCTokens_ != 0, "zero amount");

    // get total amount of the given position
    uint amountTotal = activeCollaterals[msg.sender][borrowedToken_];
    require(amountTotal >= amountBurntCTokens_, "amount is too big");
    bool removeBorrowedToken = amountTotal == amountBurntCTokens_;
    bool removePool = removeBorrowedToken && borrowedTokens[borrower].length == 1;

    // decrease amount of the position on the amount of burnt c-tokens
    activeCollaterals[borrower][borrowedToken_] -= amountBurntCTokens_;

    // unregister pool and borrowed token if necessary
    if (removeBorrowedToken) {
      _removeItemFromArray(borrowedTokens[borrower], borrowedToken_);
      registeredBorrowTokens[borrower][borrowedToken_] = false;
    }
    if (removePool) {
      _removeItemFromArray(userToAdapters[IPoolAdapter(borrower).user()], borrower);
      _removeItemFromArray(poolAdapters, borrower);
      cTokensForPoolAdapters[borrower] = address(0);
    }
  }

  ///////////////////////////////////////////////////////
  ///           Detect unhealthy positions
  ///////////////////////////////////////////////////////

  function findFirst(uint index0, uint count, uint minAllowedHealthFactor) external view override returns (
    uint outNextIndex0,
    address outPoolAdapter,
    uint outCountBorrowedTokens,
    address[] memory outBorrowedTokens
  ) {
    outBorrowedTokens = new address[](count);

    uint len = poolAdapters.length;
    if (index0 + count > len) {
      count = len - index0;
    }

    // enumerate all pool adapters
    for (uint i = 0; i < count; i = _uncheckedInc(i)) {
      outNextIndex0 = i + 1;
      IPoolAdapter pa = IPoolAdapter(poolAdapters[i]);
      (outCountBorrowedTokens, outBorrowedTokens) = _checkPoolAdapter(pa, minAllowedHealthFactor);
      if (outCountBorrowedTokens != 0) {
        outPoolAdapter = poolAdapters[i];
        break; // we have found first problem pool adapter
      }
    }

    return (outNextIndex0, outPoolAdapter, outCountBorrowedTokens, outBorrowedTokens);
  }

  function _checkPoolAdapter(IPoolAdapter pa, uint minAllowedHealthFactor)
  internal
  view returns (uint outCountBorrowedTokens, address[] memory outBorrowedTokens) {
    // get a price of the collateral
    uint8 collateralDecimals = IERC20Extended(pa.collateralToken()).decimals();
    uint collateralPrice18 = _getPrice18(pa.collateralToken());

    // enumerate all borrowed tokens inside the pool adapter
    (address[] memory bTokens,
     uint[] memory collateralAmountsCT,
     uint[] memory amountsToPayBT
    ) = pa.getOpenedPositions();

    uint lengthTokens = bTokens.length;
    for (uint j = 0; j < lengthTokens; j = _uncheckedInc(j)) {
      // calculate health factor for the borrowed token
      uint8 borrowedTokenDecimals = IERC20Extended(bTokens[j]).decimals();
      uint borrowedTokenPrice18 = _getPrice18(bTokens[j]);

      // HF = CollateralFactor * (CollateralAmount * CollateralPrice) / (AmountToPayBT * PriceBorrowedToken)
      uint healthFactor = pa.collateralFactor()
        * (_toMantissa(collateralAmountsCT[j], collateralDecimals, 18) * collateralPrice18)
        / (_toMantissa(amountsToPayBT[j], borrowedTokenDecimals, 18) * borrowedTokenPrice18);

      if (healthFactor < minAllowedHealthFactor) {
        if (outCountBorrowedTokens == 0) {
          // lazy initialization of outBorrowedTokens
          // we should allocate memory for all remaining tokens
          outBorrowedTokens = new address[](lengthTokens - j);
        }
        outBorrowedTokens[outCountBorrowedTokens] = bTokens[j];
        outCountBorrowedTokens += 1;
      }
    }

    return (outCountBorrowedTokens, outBorrowedTokens);
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

  /// @notice Get price of single {asset}-token in $, decimals 18
  function _getPrice18(address asset) internal view returns(uint) {
    uint price = IPriceOracle(controller.priceOracle()).getAssetPrice(asset);
    require (price != 0, "zero price");
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
    (address pool,,) = bm.getInfo(msg.sender);
    require(pool != address(0), "only pool adapters");
  }

  /// @notice Ensure that msg.sender is registered pool adapter
  function _onlyGovernance() internal view {
    require(msg.sender == controller.governance(), "gov only");
  }

  ///////////////////////////////////////////////////////
  ///               Arrays lengths
  ///////////////////////////////////////////////////////

  function poolAdaptersLength() external view returns (uint) {
    return poolAdapters.length;
  }

  function borrowedTokensLength(address poolAdapter) external view returns (uint) {
    return borrowedTokens[poolAdapter].length;
  }

  function userToAdaptersLength(address user) external view returns (uint) {
    return userToAdapters[user].length;
  }
}
