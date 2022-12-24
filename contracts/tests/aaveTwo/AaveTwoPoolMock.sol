// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../../integrations/aaveTwo/IAaveTwoPool.sol";
import "../../openzeppelin/IERC20.sol";
import "../../openzeppelin/SafeERC20.sol";
import "hardhat/console.sol";

/// @notice Implement some key-functions of the IAaveTwoPool
///         used by AaveTwoPoolAdapter
///         Function calls are just delegated to original pool
///         But the mock allows to change the logic of any function if it's necessary for tests
contract AaveTwoPoolMock is IAaveTwoPool {
  using SafeERC20 for IERC20;

  IAaveTwoPool public aavePool;
  bool public ignoreSupply;
  bool public ignoreRepay;
  bool public ignoreWithdraw;
  bool public ignoreBorrow;
  bool public skipSendingATokens;
  bool public grabAllBorrowAssetFromSenderOnRepay;

  constructor (
    address aavePool_,
    address collateralAsset_,
    address borrowAsset_
  ) {
    aavePool = IAaveTwoPool(aavePool_);
    IERC20(collateralAsset_).safeApprove(aavePool_, type(uint).max);
    IERC20(borrowAsset_).safeApprove(aavePool_, type(uint).max);
    console.log("AaveTwoPoolMock is used instead of real aave pool", address(this), aavePool_);
  }

  /////////////////////////////////////////////////////////////////
  ///       Config the mock
  /////////////////////////////////////////////////////////////////
  function setIgnoreSupply() external {
    console.log("setIgnoreSupply");
    ignoreSupply = true;
  }
  function setIgnoreRepay() external {
    console.log("setIgnoreRepay");
    ignoreRepay = true;
  }
  function setIgnoreWithdraw() external {
    console.log("setIgnoreWithdraw");
    ignoreWithdraw = true;
  }
  function setIgnoreBorrow() external {
    console.log("setIgnoreBorrow");
    ignoreBorrow = true;
  }
  function setSkipSendingATokens() external {
    console.log("setSkipSendingATokens");
    skipSendingATokens = true;
  }
  function setGrabAllBorrowAssetFromSenderOnRepay() external {
    console.log("setGrabAllBorrowAssetFromSenderOnRepay");
    grabAllBorrowAssetFromSenderOnRepay = true;
  }

  /////////////////////////////////////////////////////////////////
  ///       IAaveTwoPool facade
  ///       All functions required by AaveTwoPoolAdapter
  /////////////////////////////////////////////////////////////////
  function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf) external override {
    if (ignoreBorrow) {
      console.log("AaveTwoPoolMock.borrow.ignored");
    } else {
      console.log("AaveTwoPoolMock.borrow");
      aavePool.borrow(
        asset,
        amount,
        interestRateMode,
        referralCode,
        onBehalfOf == msg.sender
        ? address(this)
        : onBehalfOf
      );
      IERC20(asset).safeTransfer(msg.sender, IERC20(asset).balanceOf(address(this)) );
    }
  }
  function getAddressesProvider() external view override returns (address) {
    return aavePool.getAddressesProvider();
  }
  function getConfiguration(address asset) external view override returns (DataTypes.ReserveConfigurationMap memory) {
    return aavePool.getConfiguration(asset);
  }
  function getReserveData(address asset) external view override  returns (DataTypes.ReserveData memory) {
    return aavePool.getReserveData(asset);
  }
  function getReserveNormalizedIncome(address asset) external view override returns (uint256) {
    return aavePool.getReserveNormalizedIncome(asset);
  }
  function getReserveNormalizedVariableDebt(address asset) external view override returns (uint256) {
    return aavePool.getReserveNormalizedVariableDebt(asset);
  }
  function getReservesList() external view override returns (address[] memory) {
    return aavePool.getReservesList();
  }
  function getUserAccountData(address user) external view override returns (
    uint256 totalCollateralETH,
    uint256 totalDebtETH,
    uint256 availableBorrowsETH,
    uint256 currentLiquidationThreshold,
    uint256 ltv,
    uint256 healthFactor
  ) {
    return aavePool.getUserAccountData(
      user == msg.sender
      ? address(this)
      : user
    );
  }
  function getUserConfiguration(address user) external view override returns (DataTypes.ReserveConfigurationMap memory) {
    return aavePool.getUserConfiguration(user);
  }
  function repay(address asset, uint256 amount, uint256 rateMode, address onBehalfOf) external override returns (uint256) {
    if (! ignoreRepay) {
      console.log("AaveTwoPoolMock.repay", asset, amount, onBehalfOf);
      console.log("Balance of sender", IERC20(asset).balanceOf(msg.sender));
      IERC20(asset).safeTransferFrom(
        msg.sender,
        address(this),
        IERC20(asset).balanceOf(msg.sender) // the amount can be equal to max(uint) ..
      );
      return aavePool.repay(
        asset,
        amount,
        rateMode,
        onBehalfOf == msg.sender
        ? address(this)
        : onBehalfOf
      );
//      uint balance = IERC20(asset).balanceOf(address(this));
//      if (grabAllBorrowAssetFromSenderOnRepay) {
//        console.log("Repay: don't return unused borrow-asset-amount back to sender", balance);
//      } else {
//        // return unused borrow-asset-amount back to sender
//        // real pool doesn't take exceed amount at all
//
//        IERC20(asset).safeTransfer(msg.sender, balance);
//        console.log("Repay: return unused borrow-asset-amount back to sender", balance);
//      }
    } else {
      console.log("AaveTwoPoolMock.repay ignored");
    }
    return 0;
  }
  function setUserUseReserveAsCollateral(address asset, bool useAsCollateral) external override {
    console.log("setUserUseReserveAsCollateral", asset, useAsCollateral);
    aavePool.setUserUseReserveAsCollateral(asset, useAsCollateral);
  }
  function withdraw(address asset, uint256 amount, address to) external override returns (uint256) {
    if (! ignoreWithdraw) {
      console.log("AaveTwoPoolMock.withdraw");
      uint ret = aavePool.withdraw(asset, amount, to);
      IERC20(asset).safeTransfer(msg.sender, IERC20(asset).balanceOf(address(this)) );
      return ret;
    } else {
      console.log("AaveTwoPoolMock.withdraw ignored");
    }
    return 0;
  }
  function deposit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external override {
    if (! ignoreSupply) {
      console.log("AaveTwoPoolMock.deposit", asset, amount);
      IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
      console.log("Balance before deposit", IERC20(asset).balanceOf(address(this)) );

      // we need to supply twice more amount then required
      // to be able to split a-tokens on two equal parts
      // one part send to the sender (to pass validation on sender's side)
      // another part keep on our balance to be able to make a borrow
      // We assume, that this contract already have required amount on its balance
      aavePool.deposit(
        asset,
        amount * 2,
        onBehalfOf == msg.sender
        ? address(this)
        : onBehalfOf,
        referralCode);
      console.log("Balance after deposit", IERC20(asset).balanceOf(address(this)) );

      DataTypes.ReserveData memory d = aavePool.getReserveData(asset);
      console.log("Balance atokens", IERC20(d.aTokenAddress).balanceOf(address(this)) );
      if (!skipSendingATokens) {
        IERC20(d.aTokenAddress).transfer(msg.sender, IERC20(d.aTokenAddress).balanceOf(address(this)) / 2);
        console.log("Balance atokens 2", IERC20(d.aTokenAddress).balanceOf(address(this)) );
      }
    } else {
      console.log("AaveTwoPoolMock.deposit ignored");
    }
  }


  function FLASHLOAN_PREMIUM_TOTAL() external view override returns (uint256) {
    return aavePool.FLASHLOAN_PREMIUM_TOTAL();
  }
  function LENDINGPOOL_REVISION() external view override returns (uint256) {
    return aavePool.LENDINGPOOL_REVISION();
  }
  function MAX_NUMBER_RESERVES() external view override returns (uint256) {
    return aavePool.MAX_NUMBER_RESERVES();
  }
  function MAX_STABLE_RATE_BORROW_SIZE_PERCENT() external view override returns (uint256) {
    return aavePool.MAX_STABLE_RATE_BORROW_SIZE_PERCENT();
  }
  function finalizeTransfer(address asset, address from, address to, uint256 amount,
    uint256 balanceFromBefore, uint256 balanceToBefore
  ) external override {
    aavePool.finalizeTransfer(asset, from, to, amount, balanceFromBefore, balanceToBefore);
  }

  function flashLoan(address receiverAddress, address[] memory assets, uint256[] memory amounts,
    uint256[] memory modes, address onBehalfOf, bytes memory params, uint16 referralCode) external override {
    aavePool.flashLoan(receiverAddress, assets, amounts,
      modes, onBehalfOf, params, referralCode
    );
  }
  function initReserve(address asset, address aTokenAddress, address stableDebtAddress, address variableDebtAddress,
    address interestRateStrategyAddress
  ) external override {
    aavePool.initReserve(asset, aTokenAddress, stableDebtAddress, variableDebtAddress, interestRateStrategyAddress);
  }
  function initialize(address provider) external override {
    aavePool.initialize(provider);
  }
  function liquidationCall(address collateralAsset, address debtAsset, address user,
    uint256 debtToCover, bool receiveAToken
  ) external override {
    aavePool.liquidationCall(collateralAsset, debtAsset, user, debtToCover, receiveAToken);
  }
  function paused() external view override returns (bool) {
    return aavePool.paused();
  }
  function rebalanceStableBorrowRate(address asset, address user) external override {
    aavePool.rebalanceStableBorrowRate(asset, user);
  }

  function setConfiguration(address asset, uint256 configuration) external override {
    aavePool.setConfiguration(asset, configuration);
  }
  function setPause(bool val) external override {
    aavePool.setPause(val);
  }
  function setReserveInterestRateStrategyAddress(address asset, address rateStrategyAddress) external override {
    aavePool.setReserveInterestRateStrategyAddress(asset, rateStrategyAddress);
  }
  function swapBorrowRateMode(address asset, uint256 rateMode) external override {
    aavePool.swapBorrowRateMode(asset, rateMode);
  }
}