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
import "../interfaces/IController.sol";
import "../core/AppErrors.sol";

contract PoolAdapterMock is IPoolAdapter {

  address public controller;
  address private _pool;
  address private _user;
  address private _collateralAsset;
  address private _borrowAsset;

  MockERC20 private _cTokenMock;
  uint private _collateralFactor;

  address[] private _borrowTokens;
  uint private _borrowedAmounts;
  uint private _borrowRates;

  /// @dev block.number is a number of blocks passed since last borrow/repay
  ///      we set it manually
  uint private _passedBlocks;

  /// @notice Last synced amount of given token on the balance of this contract
  mapping(address => uint) public reserveBalances;

  ///////////////////////////////////////////////////////
  ///           Setup mock behavior
  ///////////////////////////////////////////////////////

  function setUpMock(
    address cTokenMock_,
    uint collateralFactor_,
    address[] calldata borrowTokens_,
    uint[] calldata borrowRatesPerBlock_
  ) external {
    console.log("setUpMock");
    _cTokenMock = MockERC20(cTokenMock_);
    _collateralFactor = collateralFactor_;
    for (uint i = 0; i < borrowTokens_.length; ++i) {
      _borrowTokens.push(borrowTokens_[i]);
      _borrowRates = borrowRatesPerBlock_[i];
    }
  }

  function setPassedBlocks(uint countPassedBlocks) external {
    _passedBlocks = countPassedBlocks;
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
    address collateralAsset_,
    address borrowAsset_
  ) external {
    console.log("PoolAdapterMock.initialize controller=%s pool=%s user=%s", controller_, pool_, user_);
    controller = controller_;
    _pool = pool_;
    _user = user_;
    _collateralAsset = collateralAsset_;
    _borrowAsset = borrowAsset_;
  }

  ///////////////////////////////////////////////////////
  ///           Getters
  ///////////////////////////////////////////////////////
  function getConfig() external view override returns (
    address pool,
    address user,
    address collateralAsset,
    address borrowAsset
  ) {
    return (_pool, _user, _collateralAsset, _borrowAsset);
  }

  function getStatus() external view override returns (
    uint collateralAmount,
    uint amountToPay,
    uint healthFactorWAD
  ) {
    uint priceCollateral = getPrice18(_collateralAsset);
    uint priceBorrowedUSD = getPrice18(_borrowAsset);

    collateralAmount = IERC20(_collateralAsset).balanceOf(_pool);
    amountToPay = _getAmountToRepay();

    uint8 decimalsCollateral = IERC20Extended(_collateralAsset).decimals();
    uint8 decimalsBorrow = IERC20Extended(_borrowAsset).decimals();

    healthFactorWAD = _collateralFactor
      * _toMantissa(collateralAmount, decimalsCollateral, 18) * priceCollateral
      / (_toMantissa(amountToPay, decimalsBorrow, 18) * priceBorrowedUSD);

    console.log("healthFactorWAD=%d", healthFactorWAD);
    console.log("_collateralFactor=%d", _collateralFactor);
    console.log("collateralAmount=%d", _toMantissa(collateralAmount, decimalsCollateral, 18));
    console.log("amountToPay=%d", _toMantissa(amountToPay, decimalsBorrow, 18));
    console.log("priceCollateral=%d", priceCollateral);
    console.log("priceBorrowedUSD=%d", priceBorrowedUSD);

    return (
      collateralAmount,
      amountToPay,
      healthFactorWAD
    );
  }

  function getConversionKind() external pure override returns (AppDataTypes.ConversionKind) {
    return AppDataTypes.ConversionKind.BORROW_2;
  }

  function syncBalance(bool beforeBorrow) external override {
    console.log("syncBalance beforeBorrow=%d", beforeBorrow ? 1 : 0);
    uint collateralBalance = IERC20(_collateralAsset).balanceOf(address(this));
    uint borrowBalance = IERC20(_borrowAsset).balanceOf(address(this));
    console.log("Pool adapter balances: collateral=%d, borrow=%d", collateralBalance, borrowBalance);

    if (beforeBorrow) {
      reserveBalances[_collateralAsset] = collateralBalance;
    }

    reserveBalances[_borrowAsset] = borrowBalance;
  }

  ///////////////////////////////////////////////////////
  ///           Borrow emulation
  ///////////////////////////////////////////////////////

  function borrow(
    uint collateralAmount_,
    uint borrowAmount_,
    address receiver_
  ) external override {
    console.log("Pool adapter.borrow sender=%s", msg.sender);

    // ensure we have received expected collateral amount
    require(collateralAmount_ >= IERC20(_collateralAsset).balanceOf(address(this)) - reserveBalances[_collateralAsset]
    , AppErrors.WRONG_COLLATERAL_BALANCE);

    // send the collateral to the pool
    IERC20(_collateralAsset).transfer(_pool, collateralAmount_);

    // mint ctokens and keep them on our balance
    uint amountCTokens = collateralAmount_; //TODO: exchange rate 1:1, it's not always true
    _cTokenMock.mint(address(this), amountCTokens);
    console.log("mint ctokens amount=%d to=%s", amountCTokens, address(this));

    // price of the collateral and borrowed token in USD
    uint priceCollateral = getPrice18(_collateralAsset);
    uint priceBorrowedUSD = getPrice18(_borrowAsset);
    console.log("1");

    // ensure that we can borrow allowed amount
    uint maxAmountToBorrowUSD = _collateralFactor
      * (_toMantissa(collateralAmount_, IERC20Extended(_collateralAsset).decimals(), 18) * priceCollateral)
      / 1e18
      / 1e18;
    console.log("2 %d", maxAmountToBorrowUSD);
    console.log("collateralAmount_=%d", collateralAmount_);
    console.log("priceCollateral=%d", priceCollateral);
    console.log("borrowAmount_=%d", _toMantissa(borrowAmount_, IERC20Extended(_borrowAsset).decimals(), 18));
    console.log("priceBorrowedUSD=%d", priceBorrowedUSD);
    uint claimedAmount = _toMantissa(borrowAmount_, IERC20Extended(_borrowAsset).decimals(), 18) * priceBorrowedUSD / 1e18;
    console.log("claimedAmount=%d", claimedAmount);
    console.log("maxAmountToBorrowUSD=%d", maxAmountToBorrowUSD);
    require(maxAmountToBorrowUSD >= claimedAmount, "borrow amount is too big");

    console.log("2.2");
    // send the borrow amount to the receiver
    PoolMock thePool = PoolMock(_pool);
    console.log("3");
    thePool.transferToReceiver(_borrowAsset, borrowAmount_, receiver_);
    console.log("4");
    _addBorrow(borrowAmount_);
    console.log("5");
  }

  function _addBorrow(uint borrowedAmount_) internal {
    _accumulateDebt(borrowedAmount_);
    // send notification to the debt monitor
  IDebtMonitor dm = IDebtMonitor(IController(controller).debtMonitor());
  dm.onOpenPosition();
    console.log("_borrowedAmounts", _borrowedAmounts);
  }

  function _accumulateDebt(uint borrowedAmount_) internal {
    // accumulate exist debt and clear number of the passed blocks
    console.log("_accumulateDebt.1 to=%d add=%d + %d", _borrowedAmounts, _getAmountToRepay(), borrowedAmount_);
    _borrowedAmounts = _getAmountToRepay() + borrowedAmount_;
    _passedBlocks = 0;
  }

  ///////////////////////////////////////////////////////
  ///           Repay emulation
  ///////////////////////////////////////////////////////

  function repay(
    uint amountToRepay_,
    address receiver_,
    bool closePosition_
  ) external override {
    console.log("repay");
    require(amountToRepay_ > 0, "nothing to repay");
    // add debts to the borrowed amount
    _accumulateDebt(0);
    require(_borrowedAmounts >= amountToRepay_, "try to repay too much");

    // ensure that we have received enough money on our balance just before repay was called
    uint amountReceivedBT = IERC20(_borrowAsset).balanceOf(address(this));
    require(amountReceivedBT == amountToRepay_, "not enough money received");

    // transfer borrow amount back to the pool
    IERC20(_borrowAsset).transfer(_pool, amountToRepay_);

    //return collateral
    console.log("_borrowedAmounts %s", _borrowedAmounts);
    console.log("amountReceivedBT %s", amountReceivedBT);
    uint collateralBalance = IERC20(_collateralAsset).balanceOf(_pool);
    uint collateralToReturn = _borrowedAmounts == amountReceivedBT
      ? collateralBalance
      : collateralBalance * amountReceivedBT / _borrowedAmounts;

    console.log("collateralBalance %d", collateralBalance);
    console.log("collateralToReturn %d", collateralToReturn);
    uint amountCTokens = collateralToReturn;
    _cTokenMock.burn(address(this), amountCTokens);

    PoolMock thePool = PoolMock(_pool);
    thePool.transferToReceiver(_collateralAsset, collateralToReturn, receiver_);

    // update status
    _borrowedAmounts -= amountReceivedBT;

    if (closePosition_) {
      IDebtMonitor dm = IDebtMonitor(IController(controller).debtMonitor());
      dm.onClosePosition();
    }
  }


  ///////////////////////////////////////////////////////
  ///           Get-state functions
  ///////////////////////////////////////////////////////

  function _getAmountToRepay() internal view returns (uint) {
    return _borrowedAmounts
      + _borrowRates
        * _borrowedAmounts
        * _passedBlocks
        / 1e18 //br has decimals 18
    ;
  }

//  function getOpenedPositions() external view override returns (
//    uint outCountItems,
//    address[] memory outBorrowedTokens,
//    uint[] memory outCollateralAmountsCT,
//    uint[] memory outAmountsToPayBT
//  ) {
//    uint lengthTokens = _borrowTokens.length;
//
//    outBorrowedTokens = new address[](lengthTokens);
//    outCollateralAmountsCT = new uint[](lengthTokens);
//    outAmountsToPayBT = new uint[](lengthTokens);
//
//    for (uint i = 0; i < lengthTokens; ++i) {
//      uint amountToPay = _getAmountToRepay(_borrowTokens[i]);
//      if (amountToPay != 0) {
//        outBorrowedTokens[outCountItems] = _borrowTokens[i];
//        outCollateralAmountsCT[outCountItems] = _debtMonitor.activeCollaterals(address(this), _borrowTokens[i]);
//        outAmountsToPayBT[outCountItems] = amountToPay;
//        outCountItems += 1;
//      }
//    }
//
//    return (outCountItems, outBorrowedTokens, outCollateralAmountsCT, outAmountsToPayBT);
//  }

  ///////////////////////////////////////////////////////
  ///           Utils
  ///////////////////////////////////////////////////////

  function getPrice18(address asset) internal view returns (uint) {
    console.log("getPrice18");
    address priceOracleAddress = IController(controller).priceOracle();
    IPriceOracle priceOracle = IPriceOracle(priceOracleAddress);

    uint price18 = priceOracle.getAssetPrice(asset);
    console.log("getPrice18 %d", price18);
    return price18;
  }

  /// @notice Convert {amount} with [sourceDecimals} to new amount with {targetDecimals}
  function _toMantissa(uint amount, uint16 sourceDecimals, uint16 targetDecimals) internal pure returns (uint) {
    return sourceDecimals == targetDecimals
    ? amount
    : amount * (10 ** targetDecimals) / (10 ** sourceDecimals);
  }

}