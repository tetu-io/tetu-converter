// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../integrations/dforce/IDForceCToken.sol";
import "./DForceControllerMock.sol";

/// @notice Delegate all calls made from DForcePoolAdapter to DForceControllerMock
///         For simplicity, we ignore the case with native token
/// @dev This mock is used to check communication between DForcePoolAdapter and DForce-comptroller
///      DForce-comptroller is mocked, so we are able to imitate various DForce-comptroller-errors
contract DForceCTokenMock is IDForceCToken {
  using SafeERC20 for IERC20;

  DForceControllerMock mockedComptroller;
  address public underlyingAsset;
  IDForceCToken cToken;

  bool internal useMockedBalance;
  uint internal mockedBalanceValue;

  function init(
    address mockedComptroller_,
    address underlying_,
    address cToken_
  ) external {
    cToken = IDForceCToken(cToken_);
    mockedComptroller = DForceControllerMock(mockedComptroller_);
    underlyingAsset = underlying_;

    IERC20(underlying_).safeApprove(mockedComptroller_, type(uint).max);
  }

  //region ----------------------------------------------------- Settings
  function setMockedBalance(uint value) external {
    useMockedBalance = true;
    mockedBalanceValue = value;
  }
  //endregion -----------------------------------------------------  Settings

  //-----------------------------------------------------
  ///       IDForceCToken facade
  ///       All functions required by DForcePoolAdapter
  ///       Replace mocked-cTokens by real one on the fly
  //-----------------------------------------------------
  function mint(address _recipient, uint256 _mintAmount) external override {
    console.log("DForceCTokenMock.mint", address(this), _mintAmount);
    IERC20(underlyingAsset).safeTransferFrom(msg.sender, address(this), _mintAmount);
    console.log("DForceCTokenMock.balance", address(this), IERC20(underlyingAsset).balanceOf(address(this)));
    return mockedComptroller.mint(cToken, _recipient, _mintAmount);
  }
  function borrow(uint256 _borrowAmount) external override {
    console.log("DForceCTokenMock.borrow", address(this), _borrowAmount, IERC20(underlyingAsset).balanceOf(address(this)));
    mockedComptroller.borrow(cToken, _borrowAmount);
    uint balance = IERC20(underlyingAsset).balanceOf(address(this));
    console.log("DForceCTokenMock.borrow.done", address(this), _borrowAmount, balance);
    IERC20(underlyingAsset).safeTransfer(msg.sender, balance);
  }
  function balanceOf(address a) external override view returns (uint256) {
    console.log("DForceCTokenMock.balanceOf", a);
    if (useMockedBalance) {
      return mockedBalanceValue;
    }
    return mockedComptroller.balanceOf(cToken, a == msg.sender ? address(this) : a);
  }
  function redeem(address _from, uint256 _redeemiToken) external override {
    console.log("DForceCTokenMock.redeem from token", _from, _redeemiToken);
    mockedComptroller.redeem(cToken, _from, _redeemiToken);
    uint amount = IERC20(underlyingAsset).balanceOf(address(this));
    console.log("DForceCTokenMock.redeem.amount", amount);
    IERC20(underlyingAsset).safeTransfer(msg.sender, amount);
    console.log("DForceCTokenMock.redeem.end");
  }
  function borrowBalanceStored(address _account) external override view returns (uint256) {
    console.log("DForceCTokenMock.borrowBalanceStored", _account);
    return mockedComptroller.borrowBalanceStored(cToken, _account == msg.sender ? address(this) : _account);
  }
  function repayBorrow(uint256 _repayAmount) external override {
    console.log("DForceCTokenMock.repayBorrow", _repayAmount);
    IERC20(underlyingAsset).safeTransferFrom(msg.sender, address(this), _repayAmount);
    console.log("DForceCTokenMock.repayBorrow.balance.before", address(this), IERC20(underlyingAsset).balanceOf(address(this)));
    mockedComptroller.repayBorrow(cToken, _repayAmount);
    console.log("DForceCTokenMock.repayBorrow.balance.after", address(this), IERC20(underlyingAsset).balanceOf(address(this)));
  }
  function borrowBalanceCurrent(address /*_account*/) external override returns (uint256) {
    uint ret = mockedComptroller.borrowBalanceCurrent(cToken, address(this));
    console.log("DForceCTokenMock.borrowBalanceCurrent", ret, address(this));
    return ret;
  }

  //-----------------------------------------------------//////////
  ///       IDForceCToken facade
  ///       All other functions
  ///
  ///       ATTENTION
  ///
  //        If you need any of following function
  //        move them into the above section
  //        and delegate their calls to DForceControllerMock
  //-----------------------------------------------------//////////
  function accrualBlockNumber() external override view returns (uint256) {
    return cToken.accrualBlockNumber();
  }
  function allowance(address a, address b) external override view returns (uint256) {
    return cToken.allowance(a, b);
  }
  function approve(address spender, uint256 amount) external override returns (bool) {
    return cToken.approve(spender, amount);
  }
  function balanceOfUnderlying(address /*_account*/) external override returns (uint256) {
    return cToken.balanceOfUnderlying(address(this));
  }

  function borrowIndex() external override view returns (uint256) {
    return cToken.borrowIndex();
  }
  function borrowRatePerBlock() external override view returns (uint256) {
    return cToken.borrowRatePerBlock();
  }
  function borrowSnapshot(address /*_account*/) external override view returns (uint256 principal, uint256 interestIndex) {
    return cToken.borrowSnapshot(address(this));
  }
  function controller() external override view returns (address) {
    return cToken.controller();
  }
  function decimals() external override view returns (uint8) {
    return cToken.decimals();
  }
  function decreaseAllowance(address spender, uint256 subtractedValue) external override returns (bool) {
    return cToken.decreaseAllowance(spender, subtractedValue);
  }
  function exchangeRateCurrent() external override returns (uint256) {
    return cToken.exchangeRateCurrent();
  }
  function exchangeRateStored() external override view returns (uint256) {
    return cToken.exchangeRateStored();
  }
  function flashloanFeeRatio() external override view returns (uint256) {
    return cToken.flashloanFeeRatio();
  }
  function getCash() external override view returns (uint256) {
    return cToken.getCash();
  }
  function increaseAllowance(address spender, uint256 addedValue) external override returns (bool) {
    return cToken.increaseAllowance(spender, addedValue);
  }

  function initialize(
    address _underlyingToken,
    string memory _name,
    string memory _symbol,
    address _controller,
    address _interestRateModel
  ) external override {
    return cToken.initialize(_underlyingToken, _name, _symbol, _controller, _interestRateModel);
  }

  function interestRateModel() external override view returns (address) {
    return cToken.interestRateModel();
  }
  function isSupported() external override view returns (bool) {
    return cToken.isSupported();
  }
  function isiToken() external override pure returns (bool) {
    return false;
  }

  function liquidateBorrow(
    address _borrower,
    uint256 _repayAmount,
    address _cTokenCollateral
  ) external override {
    return cToken.liquidateBorrow(_borrower, _repayAmount, _cTokenCollateral);
  }

  function mintForSelfAndEnterMarket(uint256 _mintAmount) external override {
    return cToken.mintForSelfAndEnterMarket(_mintAmount);
  }
  function name() external override view returns (string memory) {
    return cToken.name();
  }
  function nonces(address a) external override view returns (uint256) {
    return cToken.nonces(a);
  }
  function owner() external override view returns (address) {
    return cToken.owner();
  }
  function pendingOwner() external override view returns (address) {
    return cToken.pendingOwner();
  }

  function permit(
    address _owner,
    address _spender,
    uint256 _value,
    uint256 _deadline,
    uint8 _v,
    bytes32 _r,
    bytes32 _s
  ) external override {
    return cToken.permit(_owner, _spender, _value, _deadline, _v, _r, _s);
  }

  function protocolFeeRatio() external override view returns (uint256) {
    return cToken.protocolFeeRatio();
  }
  function redeemUnderlying(address _from, uint256 _redeemUnderlying) external override {
    return cToken.redeemUnderlying(_from, _redeemUnderlying);
  }
  function repayBorrowBehalf(address _borrower, uint256 _repayAmount) external override {
    return cToken.repayBorrowBehalf(_borrower, _repayAmount);
  }
  function reserveRatio() external override view returns (uint256) {
    return cToken.reserveRatio();
  }
  function seize(
    address _liquidator,
    address _borrower,
    uint256 _seizeTokens
  ) external override {
    return cToken.seize(_liquidator, _borrower, _seizeTokens);
  }
  function supplyRatePerBlock() external override view returns (uint256) {
    return cToken.supplyRatePerBlock();
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
  function totalSupply() external override view returns (uint256) {
    return cToken.totalSupply();
  }
  function transfer(address _recipient, uint256 _amount) external override returns (bool) {
    return cToken.transfer(_recipient, _amount);
  }

  function transferFrom(
    address _sender,
    address _recipient,
    uint256 _amount
  ) external override returns (bool) {
    return cToken.transferFrom(_sender, _recipient, _amount);
  }

  function underlying() external override view returns (address) {
    return cToken.underlying();
  }

  function updateInterest() external override returns (bool) {
    return cToken.updateInterest();
  }
}
