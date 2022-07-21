// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../interfaces/IPoolAdapter.sol";
import "hardhat/console.sol";
import "../interfaces/IPriceOracle.sol";
import "../openzeppelin/IERC20.sol";
import "./MockERC20.sol";
import "../integrations/IERC20Extended.sol";
import "../interfaces/IDebtsMonitor.sol";

contract PoolAdapterMock is IPoolAdapter {

  address private _pool;
  address private _user;
  address private _collateralUnderline;

  MockERC20 private _cTokenMock;
  IPriceOracle private _priceOracle;
  IDebtMonitor private _debtMonitor;
  uint private _collateralFactor;

  address[] private _borrowTokens;
  mapping(address=>uint) private _borrowedAmounts;
  mapping(address=>uint) private _borrowRates;
  mapping(address=>uint) private _lastBalances;

  /// @notice borrowed-token => block.number
  /// @dev block.number is a number of block when last borrow/repay operation was made
  mapping(address=>uint) private _blocks;

  ///////////////////////////////////////////////////////
  ///           Initialization
  ///  Constructor is not applicable, because this contract
  ///  is created using minimal-proxy pattern
  ///////////////////////////////////////////////////////

  function setUpMock(
    address cTokenMock_,
    address priceOracle_,
    address debtMonitor_,
    uint collateralFactor_,
    address[] calldata borrowTokens_,
    uint[] calldata borrowRatesPerBlock_
  ) external {
    console.log("setUpMock");
    _cTokenMock = MockERC20(cTokenMock_);
    _priceOracle = IPriceOracle(priceOracle_);
    _debtMonitor = IDebtMonitor(debtMonitor_);
    _collateralFactor = collateralFactor_;
    for (uint i = 0; i < borrowTokens_.length; ++i) {
      _borrowTokens.push(borrowTokens_[i]);
      _borrowRates[borrowTokens_[i]] = borrowRatesPerBlock_[i];
      _updateLastBalance(borrowTokens_[i]);
    }
  }

  function initialize(address pool_, address user_, address collateralUnderline_) external override {
    _pool = pool_;
    _user = user_;
    _collateralUnderline = collateralUnderline_;
  }

  ///////////////////////////////////////////////////////
  ///           Getters
  ///////////////////////////////////////////////////////
  function collateralToken() external view override returns (address) {
    return _collateralUnderline;
  }
  function collateralFactor() external view override returns (uint) {
    return _collateralFactor;
  }
  function pool() external view override returns (address) {
    return _pool;
  }
  function user() external view override returns (address) {
    return _user;
  }

  ///////////////////////////////////////////////////////
  ///           Borrow emulation
  ///////////////////////////////////////////////////////

  function borrow(
    uint collateralAmount_,
    address borrowedToken_,
    uint borrowedAmount_,
    address receiverBorrowedAmount_
  ) override external {
    console.log("borrow.1");
    uint collateralBalance = IERC20(_collateralUnderline).balanceOf(address(this));
    require(collateralBalance == collateralAmount_, "wrong collateral balance");
    require(_borrowRates[borrowedToken_] != 0, "borrowed token is not supported");
    console.log("borrow.2");

    // mint ctokens and keep them on our balance
    uint amountCTokens = collateralBalance; //TODO: exchange rate 1:1, it's not always true
    _cTokenMock.mint(address(this), amountCTokens);
    console.log("borrow.3");

    // price of the collateral and borrowed token in USD
    uint priceCollateral = getPrice18(_collateralUnderline);
    uint priceBorrowedUSD = getPrice18(borrowedToken_);
    console.log("borrow.4");

    // ensure that we can borrow allowed amount
    uint maxAmountToBorrowUSD = _collateralFactor
      * (collateralAmount_ * priceCollateral)
      / 1e18
      / 1e18;
    uint claimedAmount = borrowedAmount_ * priceBorrowedUSD / 1e18;
    require(maxAmountToBorrowUSD >= claimedAmount, "borrow amount is too big");
    console.log("borrow.5");

    uint borrowedTokenBalance = IERC20(borrowedToken_).balanceOf(address(this));
    require(borrowedTokenBalance > borrowedAmount_, "not enough liquidity to borrow");
    console.log("borrow.6");

    IERC20(borrowedToken_).transfer(receiverBorrowedAmount_, borrowedAmount_);
    console.log("borrow.6.1");
    _addBorrow(borrowedToken_, borrowedAmount_, amountCTokens);
    console.log("borrow.7");

    _updateLastBalance(borrowedToken_);
    console.log("borrow.8");

  }

  function _addBorrow(address borrowedToken_, uint borrowedAmount_, uint amountCTokens_) internal {
    console.log("_addBorrow.1 this=%s msg.sender=%s", address(this), msg.sender);
    _accumulateDebt(borrowedToken_, borrowedAmount_);
    console.log("_addBorrow.2 debtMonitor=%s", address(_debtMonitor));
    // send notification to the debt monitor
    _debtMonitor.onBorrow(address(_cTokenMock), amountCTokens_, borrowedToken_);
  }

  function _accumulateDebt(address borrowedToken_, uint borrowedAmount_) internal {
    // accumulate exist debt
    console.log("_accumulateDebt.1");
    _borrowedAmounts[borrowedToken_] = _getAmountToRepay(borrowedToken_) + borrowedAmount_;
    console.log("_accumulateDebt.2");
    _blocks[borrowedToken_] = block.number;
  }

  function _updateLastBalance(address borrowedToken_) internal {
    _lastBalances[borrowedToken_] = IERC20(borrowedToken_).balanceOf(address(this));
  }

  ///////////////////////////////////////////////////////
  ///           Repay emulation
  ///////////////////////////////////////////////////////

  function repay(
    address borrowedToken_,
    uint borrowedAmount_,
    address receiverCollateralAmount_
  ) override external {
    // add debts to the borrowed amount
    _accumulateDebt(borrowedToken_, 0);
    require(borrowedAmount_ <= _borrowedAmounts[borrowedToken_], "try to repay too much");

    // ensure that we have received enough money on our balance just before repay was called
    uint newLastBalance = IERC20(borrowedToken_).balanceOf(address(this));
    uint amountReceivedBT = newLastBalance - _lastBalances[borrowedToken_];
    require(amountReceivedBT == borrowedAmount_, "not enough money received");

    //return collateral
    uint collateralBalance = IERC20(_collateralUnderline).balanceOf(address(this));
    uint collateralToReturn = _borrowedAmounts[borrowedToken_] == amountReceivedBT
      ? collateralBalance
      : collateralBalance * amountReceivedBT / _borrowedAmounts[borrowedToken_];
    uint amountCTokens = collateralToReturn;
    _cTokenMock.burn(address(this), amountCTokens);
    IERC20(_collateralUnderline).transfer(receiverCollateralAmount_, collateralToReturn);

    // update status
    _borrowedAmounts[borrowedToken_] -= amountReceivedBT;
    _lastBalances[borrowedToken_] = newLastBalance;

  }


  ///////////////////////////////////////////////////////
  ///           Get-state functions
  ///////////////////////////////////////////////////////

  /// @notice How much we should pay to close the borrow
  function getAmountToRepay(address borrowedToken_) external view override returns (uint) {
    return _getAmountToRepay(borrowedToken_);
  }

  function _getAmountToRepay(address borrowedToken_) internal view returns (uint) {
    if (_blocks[borrowedToken_] != 0) {
      return _borrowedAmounts[borrowedToken_]
      + _borrowRates[borrowedToken_]
        * _borrowedAmounts[borrowedToken_]
        * (_blocks[borrowedToken_] - block.number)
      ;
    } else {
      return 0;
    }
  }

  function getOpenedPositions() external view override returns (
    address[] memory borrowedTokens,
    uint[] memory collateralAmountsCT,
    uint[] memory amountsToPayBT
  ) {
    return (borrowedTokens, collateralAmountsCT, amountsToPayBT);
  }

  ///////////////////////////////////////////////////////
  ///           Utils
  ///////////////////////////////////////////////////////

  function getPrice18(address asset) internal view returns (uint) {
    IERC20Extended d = IERC20Extended(asset);
    uint price = _priceOracle.getAssetPrice(asset);
    return _toMantissa(price, d.decimals(), 18);
  }

  /// @notice Convert {amount} with [sourceDecimals} to new amount with {targetDecimals}
  function _toMantissa(uint amount, uint16 sourceDecimals, uint16 targetDecimals) internal pure returns (uint) {
    return sourceDecimals == targetDecimals
    ? amount
    : amount * (10 ** targetDecimals) / (10 ** sourceDecimals);
  }

}