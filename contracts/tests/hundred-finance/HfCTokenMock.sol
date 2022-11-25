// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../../integrations/hundred-finance/IHfCToken.sol";
import "../../openzeppelin/SafeERC20.sol";
import "./HfComptrollerMock.sol";
import "hardhat/console.sol";

/// @notice Delegate all calls made from HfPoolAdapter to HfComptrollerMock
///         For simplicity, we ignore the case with native token
/// @dev This mock is used to check communication between HfPoolAdapter and HundredFinance-comptroller
///      HundredFinance-comptroller is mocked, so we are able to imitate various HundredFinacne-comptroller-errors
contract HfCTokenMock is IHfCToken {
  using SafeERC20 for IERC20;

  HfComptrollerMock mockedComptroller;
  address public underlyingAsset;
  IHfCToken cToken;

  function init(
    address mockedComptroller_,
    address underlying_,
    address cToken_
  ) external {
    cToken = IHfCToken(cToken_);
    mockedComptroller = HfComptrollerMock(mockedComptroller_);
    underlyingAsset = underlying_;

    IERC20(underlying_).safeApprove(mockedComptroller_, type(uint).max);
  }

  /////////////////////////////////////////////////////////////////
  ///       HfCToken facade
  ///       All functions required by HfPoolAdapter
  ///       Replace mocked-cTokens by real one on the fly
  /////////////////////////////////////////////////////////////////
  function balanceOf(address owner) external override view returns (uint256) {
    console.log("HfCTokenMock.balanceOf", owner);
    return mockedComptroller.balanceOf(cToken, owner);
  }
  function mint(uint256 mintAmount) external override returns (uint256) {
    console.log("HfCTokenMock.mintAmount", mintAmount);
    IERC20(underlyingAsset).safeTransferFrom(msg.sender, address(this), mintAmount);
    console.log("HfCTokenMock.balance", address(this), IERC20(underlyingAsset).balanceOf(address(this)));
    return mockedComptroller.mint(cToken, mintAmount);
  }
  function redeem(uint256 redeemTokens) external override returns (uint256) {
    console.log("HfCTokenMock.redeem", redeemTokens);
    uint dest = mockedComptroller.redeem(cToken, redeemTokens);
    uint amount = IERC20(underlyingAsset).balanceOf(address(this));
    IERC20(underlyingAsset).safeTransfer(msg.sender, amount);
    return dest;
  }
  function getAccountSnapshot(address account) external override view returns (
    uint256 error, uint256 tokenBalance, uint256 borrowBalance, uint256 exchangeRateMantissa
  ) {
    console.log("HfCTokenMock.getAccountSnapshot", account);
    return mockedComptroller.getAccountSnapshot(cToken, account);
  }
  function borrow(uint256 borrowAmount) external override returns (uint256) {
    console.log("HfCTokenMock.redeem", borrowAmount);
    uint dest = mockedComptroller.borrow(cToken, borrowAmount);
    uint balance = IERC20(underlyingAsset).balanceOf(address(this));
    console.log("HfCTokenMock.borrow.done", address(this), borrowAmount, balance);
    IERC20(underlyingAsset).safeTransfer(msg.sender, balance);
    return dest;
  }
  function repayBorrow(uint256 repayAmount) external override returns (uint256) {
    console.log("HfCTokenMock.repayBorrow", repayAmount);
    return mockedComptroller.repayBorrow(cToken, repayAmount);
  }


  /////////////////////////////////////////////////////////////////
  ///       HfCToken facade
  ///       All other functions
  ///
  ///       ATTENTION
  ///
  //        If you need any of following function
  //        move them into the above section
  //        and delegate their calls to HfComptrollerMock
  /////////////////////////////////////////////////////////////////
  function totalSupply() external override view returns (uint256) {
    return cToken.totalSupply();
  }

  function accrualBlockNumber() external override view returns (uint256) {
    return cToken.accrualBlockNumber();
  }
  function accrueInterest() external override returns (uint256) {
    return cToken.accrueInterest();
  }
  function admin() external override view returns (address) {
    return cToken.admin();
  }
  function allowance(address owner, address spender) external override view returns (uint256) {
    return cToken.allowance(owner, spender);
  }
  function approve(address spender, uint256 amount) external override returns (bool) {
    return cToken.approve(spender, amount);
  }
  function balanceOfUnderlying(address owner) external override returns (uint256) {
    return cToken.balanceOfUnderlying(owner);
  }
  function borrowBalanceCurrent(address account) external override returns (uint256) {
    return cToken.borrowBalanceCurrent(account);
  }
  function borrowBalanceStored(address account) external override view returns (uint256) {
    return cToken.borrowBalanceStored(account);
  }
  function borrowIndex() external override view returns (uint256)  {
    return cToken.borrowIndex();
  }
  function borrowRatePerBlock() external override view returns (uint256)  {
    return cToken.borrowRatePerBlock();
  }
  function comptroller() external override view returns (address) {
    return cToken.comptroller();
  }
  function decimals() external override view returns (uint8) {
    return cToken.decimals();
  }
  function exchangeRateCurrent() external override returns (uint256) {
    return cToken.exchangeRateCurrent();
  }
  function exchangeRateStored() external override view returns (uint256) {
    return cToken.exchangeRateStored();
  }
  function getCash() external override view returns (uint256) {
    return cToken.getCash();
  }
  function implementation() external override view returns (address) {
    return cToken.implementation();
  }

  function initialize(
    address underlying_,
    address comptroller_,
    address interestRateModel_,
    uint256 initialExchangeRateMantissa_,
    string memory name_,
    string memory symbol_,
    uint8 decimals_
  ) external override  {
    return cToken.initialize(underlying_, comptroller_, interestRateModel_, initialExchangeRateMantissa_, name_, symbol_, decimals_);
  }

  function initialize(
    address comptroller_,
    address interestRateModel_,
    uint256 initialExchangeRateMantissa_,
    string memory name_,
    string memory symbol_,
    uint8 decimals_
  ) external override {
    return cToken.initialize(comptroller_, interestRateModel_, initialExchangeRateMantissa_, name_, symbol_, decimals_);
  }

  function interestRateModel() external override view returns (address) {
    return cToken.interestRateModel();
  }
  function isCToken() external override view returns (bool) {
    return cToken.isCToken();
  }
  function liquidateBorrow(address borrower, uint256 repayAmount, address cTokenCollateral) external override returns (uint256) {
    return cToken.liquidateBorrow(borrower, repayAmount, cTokenCollateral);
  }
  function name() external override view returns (string memory) {
    return cToken.name();
  }
  function pendingAdmin() external override view returns (address)  {
    return cToken.pendingAdmin();
  }
  function redeemUnderlying(uint256 redeemAmount) external override returns (uint256) {
    return cToken.redeemUnderlying(redeemAmount);
  }
  function repayBorrowBehalf(address borrower, uint256 repayAmount) external override returns (uint256) {
    return cToken.repayBorrowBehalf(borrower, repayAmount);
  }
  function reserveFactorMantissa() external override view returns (uint256) {
    return cToken.reserveFactorMantissa();
  }
  function seize(address liquidator, address borrower, uint256 seizeTokens) external override returns (uint256) {
    return cToken.seize(liquidator, borrower, seizeTokens);
  }
  function supplyRatePerBlock() external override view returns (uint256) {
    return cToken.supplyRatePerBlock();
  }
  function sweepToken(address token) external override {
    return cToken.sweepToken(token);
  }
  function symbol() external override view returns (string memory) {
    return cToken.symbol();
  }
  function totalBorrows() external override view returns (uint256) {
    return cToken.totalBorrows();
  }
  function totalBorrowsCurrent() external override returns (uint256) {
    return cToken.totalBorrowsCurrent();
  }
  function totalReserves() external override view returns (uint256) {
    return cToken.totalReserves();
  }
  function transfer(address dst, uint256 amount) external override returns (bool)  {
    return cToken.transfer(dst, amount);
  }
  function transferFrom(address src, address dst, uint256 amount) external override returns (bool) {
    return cToken.transferFrom(src, dst, amount);
  }
  function underlying() external override view returns (address) {
    return cToken.underlying();
  }
}