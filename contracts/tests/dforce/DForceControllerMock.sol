// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../integrations/dforce/IDForceController.sol";
import "../../openzeppelin/IERC20.sol";
import "../../openzeppelin/SafeERC20.sol";
import "hardhat/console.sol";
import "../../integrations/dforce/IDForceCToken.sol";

/// @notice Implement some key-functions of the IDForceController
///         used by DForcePoolAdapter
///         Function calls are just delegated to original pool
///         But the mock allows to change the logic of any function if it's necessary for tests
///         DForcePoolAdapter uses IDForceController together with CTokens, so
///         it's necessary to mock all contracts at the same time: controller, price-oracle, both cTokens
///         This contract provides real implementation for cToken-functions too.
/// @dev This mock is used to check communication between DForcePoolAdapter and DForce-comptroller
///      DForce-comptroller is mocked, so we are able to imitate various DForce-comptroller-errors
contract DForceControllerMock is IDForceController {
  using SafeERC20 for IERC20;

  IDForceController public comptroller;
  address public collateralCToken;
  address public borrowCToken;
  address public mockedCollateralCToken;
  address public mockedBorrowCToken;
  address public assetBorrow;
  address public assetCollateral;

  bool public ignoreBorrow;
  bool public borrowDontSendBorrowedAmount;
  bool public ignoreBorrowBalanceStored;
  uint public returnNotZeroTokenBalanceAfterRedeem;
  uint public returnNotZeroBorrowBalanceStoredAfterRedeem;
  /// @notice 0 - disabled, 1 - return increased borrow, N > 1: decrease this value with each call of borrowBalanceCurrent
  uint public borrowBalance1AfterCallingBorrowBalanceCurrent;
  address internal _rewardDistributor;

  constructor (
    address comptroller_,
    address collateralAsset_,
    address borrowAsset_,
    address collateralCToken_,
    address borrowCToken_,
    address mockedCollateralCToken_,
    address mockedBorrowCToken_
  ) {
    comptroller = IDForceController(comptroller_);
    IERC20(collateralCToken_).safeApprove(comptroller_, type(uint).max);
    IERC20(borrowCToken_).safeApprove(comptroller_, type(uint).max);
    console.log("DForceControllerMock is used instead of real DForce controller", address(this), comptroller_);

    collateralCToken = collateralCToken_;
    mockedCollateralCToken = mockedCollateralCToken_;
    borrowCToken = borrowCToken_;
    mockedBorrowCToken = mockedBorrowCToken_;
    assetBorrow = borrowAsset_;
    assetCollateral = collateralAsset_;

    IERC20(collateralAsset_).safeApprove(collateralCToken_, type(uint).max);
    IERC20(borrowAsset_).safeApprove(borrowCToken_, type(uint).max);
  }

  //-----------------------------------------------------
  //       Config the mock
  //-----------------------------------------------------
  function setIgnoreBorrow() external {
    console.log("Set ignoreBorrow=true");
    ignoreBorrow = true;
  }
  function setIgnoreBorrowBalanceStored() external {
    console.log("Set ignoreBorrowBalanceStored=true");
    ignoreBorrowBalanceStored = true;
  }
  function setReturnNotZeroTokenBalanceAfterRedeem() external {
    console.log("Set returnNotZeroTokenBalanceAfterRedeem");
    returnNotZeroTokenBalanceAfterRedeem = 1;
  }
  function setReturnNotZeroBorrowBalanceStoredAfterRedeem() external {
    console.log("Set returnNotZeroBorrowBalanceStoredAfterRedeem");
    returnNotZeroBorrowBalanceStoredAfterRedeem = 1;
  }
  function setBorrowBalance1AfterCallingBorrowBalanceCurrent(uint initialValue) external {
    console.log("Set setBorrowBalance1AfterCallingBorrowBalanceCurrent", initialValue);
    borrowBalance1AfterCallingBorrowBalanceCurrent = initialValue;
  }
  function setBorrowDontSendBorrowedAmount() external {
    console.log("Set borrowDontSendBorrowedAmount");
    borrowDontSendBorrowedAmount = true;
  }
  function setRewardDistributor(address rd) external {
    _rewardDistributor = rd;
  }

  //-----------------------------------------------------
  //        Calls from DForceCTokenMock
  //        delegated to real CTokens
  //        (this contract must be the message sender)
  //-----------------------------------------------------
  function mint(IDForceCToken cToken, address _recipient, uint256 _mintAmount) external {
    console.log("DForceControllerMock.mint", address(cToken), _mintAmount, _recipient);
    console.log("Balance of ctoken", msg.sender, IERC20(assetCollateral).balanceOf(msg.sender));
    IERC20(assetCollateral).safeTransferFrom(msg.sender, address(this), _mintAmount);
    console.log("Balance of comptroller", address(this), IERC20(assetCollateral).balanceOf(address(this)));
    cToken.mint(address(this), _mintAmount);

    (uint accountEquity, uint shortfall, uint collateralValue, uint borrowedValue) = comptroller.calcAccountEquity(address(this));
    console.log("calcAccountEquity.accountEquity", accountEquity);
    console.log("calcAccountEquity.shortfall", shortfall);
    console.log("calcAccountEquity.collateralValue", collateralValue);
    console.log("calcAccountEquity.borrowedValue", borrowedValue);
  }
  function borrow(IDForceCToken cToken, uint256 _borrowAmount) external {
    if (ignoreBorrow) {
      console.log("DForceControllerMock.borrow - ignored!");
    } else {
      console.log("DForceControllerMock.borrow", address(cToken), _borrowAmount);
      cToken.borrow(_borrowAmount);
      console.log("DForceControllerMock.borrow.done, received", IERC20(assetBorrow).balanceOf(address(this)));
      if (! borrowDontSendBorrowedAmount) {
        IERC20(assetBorrow).safeTransfer(msg.sender, _borrowAmount);
      }
    }
  }
  function balanceOf(IDForceCToken cToken, address a) external view returns (uint256) {
    console.log("DForceControllerMock.balanceof", address(cToken), a);
    uint balance = cToken.balanceOf(address(this));
    if (balance == 0 && returnNotZeroTokenBalanceAfterRedeem == 2) {
      return 1; // redeem was made, let's return not-zero token balance anyway
    }
    return balance;
  }
  function redeem(IDForceCToken cToken, address _from, uint256 amountTokens_) external {
    console.log("DForceControllerMock.redeem", address(cToken), _from, amountTokens_);
    cToken.redeem(address(this), amountTokens_);

    // we doesn't consider a case of native tokens, so it's allowed to call underlying() here
    uint amount = IERC20(cToken.underlying()).balanceOf(address(this));
    IERC20(cToken.underlying()).safeTransfer(msg.sender, amount);

    if (returnNotZeroTokenBalanceAfterRedeem != 0) {
      // now, redeem has been made
      // next calls of token balance should return not zero value
      returnNotZeroTokenBalanceAfterRedeem = 2;
    }
    if (returnNotZeroBorrowBalanceStoredAfterRedeem != 0) {
      // now, redeem has been made
      // next calls of borrowBalanceStored should return not zero value
      returnNotZeroBorrowBalanceStoredAfterRedeem = 2;
    }
    console.log("DForceControllerMock.end", amount);
  }

  function borrowBalanceStored(IDForceCToken cToken, address _account) external view returns (uint256) {
    uint balance;
    if (ignoreBorrowBalanceStored) {
      balance = 0;
    } else {
      balance = cToken.borrowBalanceStored(address(this));
      if (balance == 0 && returnNotZeroBorrowBalanceStoredAfterRedeem == 2) {
        balance = 1; // redeem has been made, but borrowBalanceStored returns not 0
      } else if (borrowBalance1AfterCallingBorrowBalanceCurrent == 1) {
        // see _getCollateralTokensToRedeem impl
        // borrowBalanceStored was called
        // now we return wrong value of borrowBalance
        // to have WRONG_BORROWED_BALANCE
        balance = 1;
      }
    }
    console.log("DForceControllerMock.borrowBalanceStored", _account, balance);
    return balance;
  }
  function repayBorrow(IDForceCToken cToken, uint256 _repayAmount) external {
    console.log("DForceControllerMock.repayBorrow", _repayAmount);
    IERC20(cToken.underlying()).safeTransferFrom(msg.sender, address(this), _repayAmount);
    cToken.repayBorrow(_repayAmount);
  }

  function borrowBalanceCurrent(IDForceCToken cToken, address /*_account*/) external returns (uint256) {
    console.log("DForceControllerMock.borrowBalanceCurrent.this", address(this));
    if (borrowBalance1AfterCallingBorrowBalanceCurrent > 1) {
      borrowBalance1AfterCallingBorrowBalanceCurrent -= 1;
      console.log("setBorrowBalance1AfterCallingBorrowBalanceCurrent", borrowBalance1AfterCallingBorrowBalanceCurrent);
    }
    
    uint ret = cToken.borrowBalanceCurrent(address(this));
    console.log("DForceControllerMock.borrowBalanceCurrent.ret", ret);
    return ret;
  }
  //-----------------------------------------------------
  //       IDForceController facade
  //       All functions required by DForcePoolAdapter
  //       Replace mocked-cTokens by real one on the fly
  //-----------------------------------------------------
  function enterMarkets(address[] memory _iTokens) external override returns (bool[] memory _results) {
    console.log("enterMarkets");
    address[] memory tokens = new address[](_iTokens.length);
    for (uint i = 0; i < _iTokens.length; ++i) {
      if (_iTokens[i] == mockedCollateralCToken) {
        tokens[i] = collateralCToken;
      } else if (_iTokens[i] == mockedBorrowCToken) {
        tokens[i] = borrowCToken;
      } else {
        tokens[i] = _iTokens[i];
      }
    }
    return comptroller.enterMarkets(tokens);
  }

  function calcAccountEquity(address _account) external view override returns (
    uint256 accountEquity,
    uint256 shortfall,
    uint256 collateralValue,
    uint256 borrowedValue
  ) {
    console.log("calcAccountEquity", _account);
    address account = address(this);
    console.log("calcAccountEquity", account);
    (accountEquity, shortfall, collateralValue, borrowedValue) = comptroller.calcAccountEquity(account);
    console.log("calcAccountEquity.accountEquity", accountEquity);
    console.log("calcAccountEquity.shortfall", shortfall);
    console.log("calcAccountEquity.collateralValue", collateralValue);
    console.log("calcAccountEquity.borrowedValue", borrowedValue);
  }

  function rewardDistributor() external view override returns (address) {
    console.log("rewardDistributor");
    if (_rewardDistributor != address(0)) {
      return _rewardDistributor;
    }
    return comptroller.rewardDistributor();
  }

  function priceOracle() external view override returns (address) {
    console.log("priceOracle");
    return comptroller.priceOracle();
  }

  function markets(address target_) external view override returns (
    uint256 collateralFactorMantissa,
    uint256 borrowFactorMantissa,
    uint256 borrowCapacity,
    uint256 supplyCapacity,
    bool mintPaused,
    bool redeemPaused,
    bool borrowPaused
  ) {
    console.log("markets");
    address target = target_ == mockedCollateralCToken
      ? collateralCToken
      : target_ == mockedBorrowCToken
        ? borrowCToken
        : target_;
    return comptroller.markets(target);
  }

  //-----------------------------------------------------
  //       IDForceController facade
  //       All other functions
  //
  //       ATTENTION
  //
  //        If you need any of following function
  //        move them in the above section
  //        and correctly replace params on the fly
  //        (cTokens addresses and user account address)
  //-----------------------------------------------------
  function afterBorrow(address _iToken, address _borrower, uint256 _borrowedAmount) external override {
    return comptroller.afterBorrow(_iToken, _borrower, _borrowedAmount);
  }
  function afterFlashloan(address _iToken, address _to, uint256 _amount) external override {
    comptroller.afterFlashloan(_iToken, _to, _amount);
  }

  function afterLiquidateBorrow(address _iTokenBorrowed, address _iTokenCollateral, address _liquidator,
    address _borrower, uint256 _repaidAmount, uint256 _seizedAmount) external override
  {
    comptroller.afterLiquidateBorrow(_iTokenBorrowed, _iTokenCollateral, _liquidator, _borrower, _repaidAmount, _seizedAmount);
  }

  function afterMint(address _iToken, address _minter, uint256 _mintAmount, uint256 _mintedAmount) external override {
    comptroller.afterMint(_iToken, _minter, _mintAmount, _mintedAmount);
  }
  function afterRedeem(address _iToken, address _redeemer, uint256 _redeemAmount, uint256 _redeemedUnderlying) external override {
    comptroller.afterRedeem(_iToken, _redeemer, _redeemAmount, _redeemedUnderlying);
  }
  function afterRepayBorrow(address _iToken, address _payer, address _borrower, uint256 _repayAmount) external override {
    comptroller.afterRepayBorrow(_iToken, _payer, _borrower, _repayAmount);
  }
  function afterSeize(address _iTokenCollateral, address _iTokenBorrowed, address _liquidator,
    address _borrower, uint256 _seizedAmount) external override {
    comptroller.afterSeize(_iTokenCollateral, _iTokenBorrowed, _liquidator, _borrower, _seizedAmount);
  }
  function afterTransfer(address _iToken, address _from, address _to, uint256 _amount) external override {
    comptroller.afterTransfer(_iToken, _from, _to, _amount);
  }
  function beforeBorrow(address _iToken, address _borrower, uint256 _borrowAmount) external override {
    comptroller.beforeBorrow(_iToken, _borrower, _borrowAmount);
  }
  function beforeFlashloan(address _iToken, address _to, uint256 _amount) external override {
    comptroller.beforeFlashloan(_iToken, _to, _amount);
  }
  function beforeLiquidateBorrow(address _iTokenBorrowed, address _iTokenCollateral,
    address _liquidator, address _borrower, uint256 _repayAmount) external override {
    comptroller.beforeLiquidateBorrow(_iTokenBorrowed, _iTokenCollateral, _liquidator, _borrower, _repayAmount);
  }
  function beforeMint(address _iToken, address _minter, uint256 _mintAmount) external override {
    comptroller.beforeMint(_iToken, _minter, _mintAmount);
  }
  function beforeRedeem(address _iToken, address _redeemer, uint256 _redeemAmount) external override {
    comptroller.beforeRedeem(_iToken, _redeemer, _redeemAmount);
  }
  function beforeRepayBorrow(address _iToken, address _payer, address _borrower, uint256 _repayAmount) external override {
    comptroller.beforeRepayBorrow(_iToken, _payer, _borrower, _repayAmount);
  }
  function beforeSeize(address _iTokenCollateral, address _iTokenBorrowed, address _liquidator,
    address _borrower, uint256 _seizeAmount) external override {
    comptroller.beforeSeize(_iTokenCollateral, _iTokenBorrowed, _liquidator, _borrower, _seizeAmount);
  }

  function beforeTransfer(address _iToken, address _from, address _to, uint256 _amount) external override {
    comptroller.beforeTransfer(_iToken, _from, _to, _amount);
  }

  function closeFactorMantissa() external view override returns (uint256) {
    return comptroller.closeFactorMantissa();
  }
  function enterMarketFromiToken(address _market, address _account) external override {
    comptroller.enterMarketFromiToken(_market, _account);
  }
  function exitMarkets(address[] memory _iTokens) external override returns (bool[] memory _results) {
    return comptroller.exitMarkets(_iTokens);
  }
  function getAlliTokens() external view override returns (address[] memory _alliTokens) {
    return comptroller.getAlliTokens();
  }
  function getBorrowedAssets(address _account) external view override returns (address[] memory _borrowedAssets) {
    return comptroller.getBorrowedAssets(_account);
  }
  function getEnteredMarkets(address _account) external view override returns (address[] memory _accountCollaterals) {
    return comptroller.getEnteredMarkets(_account);
  }
  function hasBorrowed(address _account, address _iToken) external view override returns (bool) {
    return comptroller.hasBorrowed(_account, _iToken);
  }
  function hasEnteredMarket(address _account, address _iToken) external view override returns (bool) {
    return comptroller.hasEnteredMarket(_account, _iToken);
  }
  function hasiToken(address _iToken) external view override returns (bool) {
    return comptroller.hasiToken(_iToken);
  }
  function initialize() external override {
    comptroller.initialize();
  }
  function isController() external view override returns (bool) {
    return comptroller.isController();
  }
  function liquidateCalculateSeizeTokens(address _iTokenBorrowed, address _iTokenCollateral,
    uint256 _actualRepayAmount) external view override returns (uint256 _seizedTokenCollateral) {
    return comptroller.liquidateCalculateSeizeTokens(_iTokenBorrowed, _iTokenCollateral, _actualRepayAmount);
  }
  function liquidationIncentiveMantissa() external view override returns (uint256) {
    return comptroller.liquidationIncentiveMantissa();
  }

  function owner() external view override returns (address) {
    return comptroller.owner();
  }
  function pauseGuardian() external view override returns (address) {
    return comptroller.pauseGuardian();
  }
  function pendingOwner() external view override returns (address) {
    return comptroller.pendingOwner();
  }

  function seizePaused() external view override returns (bool) {
    return comptroller.seizePaused();
  }
  function transferPaused() external view override returns (bool) {
    return comptroller.transferPaused();
  }

  function _setPriceOracle(address _newOracle) external override {
    comptroller._setPriceOracle(_newOracle);
  }
  function _setBorrowCapacity(address _iToken, uint256 _newBorrowCapacity) external override {
    comptroller._setBorrowCapacity(_iToken, _newBorrowCapacity);
  }
  function _setSupplyCapacity(address _iToken, uint256 _newSupplyCapacity) external override {
    comptroller._setSupplyCapacity(_iToken, _newSupplyCapacity);
  }
  function _setMintPaused(address _iToken, bool _paused) external override {
    comptroller._setMintPaused(_iToken, _paused);
  }
  function _setRedeemPaused(address _iToken, bool _paused) external override {
    comptroller._setRedeemPaused(_iToken, _paused);
  }
  function _setBorrowPaused(address _iToken, bool _paused) external override {
    comptroller._setBorrowPaused(_iToken, _paused);
  }
  function _setBorrowFactor(address iToken_, uint256 newBorrowFactorMantissa_) external override {
    comptroller._setBorrowFactor(iToken_, newBorrowFactorMantissa_);
  }
}
