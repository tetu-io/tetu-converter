// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../interfaces/IPoolAdapter.sol";
import "hardhat/console.sol";
import "../interfaces/IPriceOracle.sol";
import "../openzeppelin/IERC20.sol";
import "./MockERC20.sol";
import "../integrations/IERC20Extended.sol";
import "../interfaces/IDebtsMonitor.sol";
import "./PoolMock.sol";

contract PoolAdapterMock is IPoolAdapter {

  address public controller;
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

  /// @notice borrowed-token => block.number
  /// @dev block.number is a number of blocks passed since last borrow/repay
  ///      we set it manually
  mapping(address=>uint) private _passedBlocks;

  ///////////////////////////////////////////////////////
  ///           Setup mock behavior
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
    }
  }

  function setPassedBlocks(address borrowedToken_, uint countPassedBlocks) external {
    _passedBlocks[borrowedToken_] = countPassedBlocks;
  }

  function changeCollateralFactor(uint collateralFactor_) external {
    _collateralFactor = collateralFactor_;
  }

  ///////////////////////////////////////////////////////
  ///           Initialization
  ///  Constructor is not applicable, because this contract
  ///  is created using minimal-proxy pattern
  ///////////////////////////////////////////////////////

  function initialize(
    address controller_,
    address pool_,
    address user_,
    address collateralUnderline_
  ) external override {
    controller = controller_;
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
    address receiver_
  ) override external {
    console.log("Pool adapter.borrow");
    uint collateralBalance = IERC20(_collateralUnderline).balanceOf(address(this));
    require(collateralBalance == collateralAmount_, "wrong collateral balance");
    console.log("Borrowed token", borrowedToken_);
    require(_borrowRates[borrowedToken_] != 0, "borrowed token is not supported");

    // transfer collateral to the pool
    IERC20(_collateralUnderline).transfer(_pool, collateralAmount_);

    // mint ctokens and keep them on our balance
    uint amountCTokens = collateralBalance; //TODO: exchange rate 1:1, it's not always true
    _cTokenMock.mint(address(this), amountCTokens);
    console.log("mint ctokens amount=%d to=%s", amountCTokens, address(this));

    // price of the collateral and borrowed token in USD
    uint priceCollateral = getPrice18(_collateralUnderline);
    uint priceBorrowedUSD = getPrice18(borrowedToken_);

    // ensure that we can borrow allowed amount
    uint maxAmountToBorrowUSD = _collateralFactor
      * (collateralAmount_ * priceCollateral)
      / 1e18
      / 1e18;
    uint claimedAmount = borrowedAmount_ * priceBorrowedUSD / 1e18;
    require(maxAmountToBorrowUSD >= claimedAmount, "borrow amount is too big");

    // get borrow tokens from the pool to the receiver
    PoolMock thePool = PoolMock(_pool);
    thePool.transferToReceiver(borrowedToken_, borrowedAmount_, receiver_);

    _addBorrow(borrowedToken_, borrowedAmount_, amountCTokens);
  }

  function _addBorrow(address borrowedToken_, uint borrowedAmount_, uint amountCTokens_) internal {
    _accumulateDebt(borrowedToken_, borrowedAmount_);
    // send notification to the debt monitor
    _debtMonitor.onBorrow(address(_cTokenMock), amountCTokens_, borrowedToken_);
    console.log("_borrowedAmounts[borrowedToken_]", _borrowedAmounts[borrowedToken_]);
  }

  function _accumulateDebt(address borrowedToken_, uint borrowedAmount_) internal {
    // accumulate exist debt and clear number of the passed blocks
    console.log("_accumulateDebt.1 to=%d add=%d + %d", _borrowedAmounts[borrowedToken_], _getAmountToRepay(borrowedToken_), borrowedAmount_);
    _borrowedAmounts[borrowedToken_] = _getAmountToRepay(borrowedToken_) + borrowedAmount_;
    _passedBlocks[borrowedToken_] = 0;
  }

  ///////////////////////////////////////////////////////
  ///           Repay emulation
  ///////////////////////////////////////////////////////

  function repay(
    address borrowedToken_,
    uint borrowedAmount_,
    address receiver_
  ) override external {
    console.log("repay");
    require(borrowedAmount_ > 0, "nothing to repay");
    // add debts to the borrowed amount
    _accumulateDebt(borrowedToken_, 0);
    require(borrowedAmount_ <= _borrowedAmounts[borrowedToken_], "try to repay too much");

    // ensure that we have received enough money on our balance just before repay was called
    uint amountReceivedBT = IERC20(borrowedToken_).balanceOf(address(this));
    require(amountReceivedBT == borrowedAmount_, "not enough money received");

    // transfer borrow amount back to the pool
    IERC20(borrowedToken_).transfer(_pool, borrowedAmount_);

    //return collateral
    uint collateralBalance = IERC20(_collateralUnderline).balanceOf(_pool);
    uint collateralToReturn = _borrowedAmounts[borrowedToken_] == amountReceivedBT
      ? collateralBalance
      : collateralBalance * amountReceivedBT / _borrowedAmounts[borrowedToken_];

    console.log("collateralBalance %d", collateralBalance);
    console.log("collateralToReturn %d", collateralToReturn);
    uint amountCTokens = collateralToReturn;
    _cTokenMock.burn(address(this), amountCTokens);

    PoolMock thePool = PoolMock(_pool);
    thePool.transferToReceiver(_collateralUnderline, collateralToReturn, receiver_);

    // update status
    _borrowedAmounts[borrowedToken_] -= amountReceivedBT;

    _debtMonitor.onRepay(address(_cTokenMock), amountCTokens, borrowedToken_);
  }


  ///////////////////////////////////////////////////////
  ///           Get-state functions
  ///////////////////////////////////////////////////////

  /// @notice How much we should pay to close the borrow
  function getAmountToRepay(address borrowedToken_) external view override returns (uint) {
    return _getAmountToRepay(borrowedToken_);
  }

  function _getAmountToRepay(address borrowedToken_) internal view returns (uint) {
    return _borrowedAmounts[borrowedToken_]
      + _borrowRates[borrowedToken_]
        * _borrowedAmounts[borrowedToken_]
        * _passedBlocks[borrowedToken_]
        / 1e18 //br has decimals 18
    ;
  }

  function getOpenedPositions() external view override returns (
    uint outCountItems,
    address[] memory outBorrowedTokens,
    uint[] memory outCollateralAmountsCT,
    uint[] memory outAmountsToPayBT
  ) {
    uint lengthTokens = _borrowTokens.length;

    outBorrowedTokens = new address[](lengthTokens);
    outCollateralAmountsCT = new uint[](lengthTokens);
    outAmountsToPayBT = new uint[](lengthTokens);

    for (uint i = 0; i < lengthTokens; ++i) {
      uint amountToPay = _getAmountToRepay(_borrowTokens[i]);
      if (amountToPay != 0) {
        outBorrowedTokens[outCountItems] = _borrowTokens[i];
        outCollateralAmountsCT[outCountItems] = _debtMonitor.activeCollaterals(address(this), _borrowTokens[i]);
        outAmountsToPayBT[outCountItems] = amountToPay;
        outCountItems += 1;
      }
    }

    return (outCountItems, outBorrowedTokens, outCollateralAmountsCT, outAmountsToPayBT);
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