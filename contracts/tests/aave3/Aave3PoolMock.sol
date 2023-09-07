// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../integrations/aave3/IAavePool.sol";
import "../../openzeppelin/IERC20.sol";
import "../../openzeppelin/SafeERC20.sol";
import "hardhat/console.sol";

/// @notice Implement some key-functions of the IAavePool
///         used by Aave3PoolAdapterBase
///         Function calls are just delegated to original pool
///         But the mock allows to change the logic of any function if it's necessary for tests
contract Aave3PoolMock is IAavePool {
  using SafeERC20 for IERC20;

  struct UserAccountData {
    bool initialized;
    uint256 totalCollateralBase;
    uint256 totalDebtBase;
    uint256 availableBorrowsBase;
    uint256 currentLiquidationThreshold;
    uint256 ltv;
    uint256 healthFactor;
  }

  IAavePool public aavePool;
  bool public ignoreSupply;
  bool public ignoreRepay;
  bool public ignoreWithdraw;
  bool public ignoreBorrow;
  bool public skipSendingATokens;
  bool public grabAllBorrowAssetFromSenderOnRepay;
  UserAccountData internal userAccountData;

  /// @notice After repay get actual user account data, save it to userAccountData and add {addon} to the healthFactor
  int internal healthFactorAddonAfterRepay;

  constructor (
    address aavePool_,
    address collateralAsset_,
    address borrowAsset_
  ) {
    aavePool = IAavePool(aavePool_);
    IERC20(collateralAsset_).safeApprove(aavePool_, type(uint).max);
    IERC20(borrowAsset_).safeApprove(aavePool_, type(uint).max);
    console.log("Aave3PoolMock is used instead of real aave pool", address(this), aavePool_);
  }

  //region ------------------------------------- Config the mock
  function setIgnoreSupply() external {
    ignoreSupply = true;
  }
  function setIgnoreRepay() external {
    ignoreRepay = true;
  }
  function setIgnoreWithdraw() external {
    ignoreWithdraw = true;
  }
  function setIgnoreBorrow() external {
    ignoreBorrow = true;
  }
  function setSkipSendingATokens() external {
    skipSendingATokens = true;
  }
  function setGrabAllBorrowAssetFromSenderOnRepay() external {
    grabAllBorrowAssetFromSenderOnRepay = true;
  }
  function setUserAccountData(
    uint256 totalCollateralBase,
    uint256 totalDebtBase,
    uint256 availableBorrowsBase,
    uint256 currentLiquidationThreshold,
    uint256 ltv,
    uint256 healthFactor
  ) external {
    userAccountData = UserAccountData({
      initialized: true,
      totalCollateralBase: totalCollateralBase,
      totalDebtBase: totalDebtBase,
      availableBorrowsBase: availableBorrowsBase,
      currentLiquidationThreshold: currentLiquidationThreshold,
      ltv: ltv,
      healthFactor: healthFactor
    });
  }
  /// @notice After repay get actual user account data, save it to userAccountData and add {addon} to the healthFactor
  function setHealthFactorAddonAfterRepay(int addon) external {
    healthFactorAddonAfterRepay = addon;
  }
  //endregion ------------------------------ Config the mock

  //region --------------------------------- IAavePool facade. All functions required by Aave3PoolAdapterBase

  function ADDRESSES_PROVIDER() external view override returns (address) {
    return aavePool.ADDRESSES_PROVIDER();
  }

  function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf) external override {
    if (!ignoreBorrow) {
      console.log("Aave3PoolMock.borrow");
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
    } else {
      console.log("Aave3PoolMock.borrow.ignored");
    }
  }

  function getConfiguration(address asset) external view override returns (Aave3DataTypes.ReserveConfigurationMap memory) {
    return aavePool.getConfiguration(asset);
  }

  function getEModeCategoryData(uint8 id) external view override returns (Aave3DataTypes.EModeCategory memory) {
    return aavePool.getEModeCategoryData(id);
  }

  function getReserveData(address asset) external view override returns (Aave3DataTypes.ReserveData memory) {
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
    uint256 totalCollateralBase,
    uint256 totalDebtBase,
    uint256 availableBorrowsBase,
    uint256 currentLiquidationThreshold,
    uint256 ltv,
    uint256 healthFactor
  ) {
    if (userAccountData.initialized) {
      return (
        userAccountData.totalCollateralBase,
        userAccountData.totalDebtBase,
        userAccountData.availableBorrowsBase,
        userAccountData.currentLiquidationThreshold,
        userAccountData.ltv,
        userAccountData.healthFactor
      );
    } else {
      (
        totalCollateralBase,
        totalDebtBase,
        availableBorrowsBase,
        currentLiquidationThreshold,
        ltv,
        healthFactor
      ) = aavePool.getUserAccountData(
        user == msg.sender
          ? address(this)
          : user
      );
      console.log("getUserAccountData.healthFactor", healthFactor);
      return (totalCollateralBase, totalDebtBase, availableBorrowsBase, currentLiquidationThreshold, ltv, healthFactor);
    }
  }

  function getUserConfiguration(address user) external view override returns (Aave3DataTypes.ReserveConfigurationMap memory) {
    return aavePool.getUserConfiguration(
      user == msg.sender
        ? address(this)
        : user
    );
  }

  function getUserEMode(address user) external view override returns (uint256) {
    return aavePool.getUserEMode(
      user == msg.sender
        ? address(this)
        : user
    );
  }

  function repay(
    address asset,
    uint256 amount,
    uint256 interestRateMode,
    address onBehalfOf
  ) external override returns (uint256) {
    if (! ignoreRepay) {
      console.log("Aave3PoolMock.repay", asset, amount, onBehalfOf);
      console.log("Balance of sender", IERC20(asset).balanceOf(msg.sender));
      IERC20(asset).safeTransferFrom(
        msg.sender,
        address(this),
        IERC20(asset).balanceOf(msg.sender) // the amount can be equal to max(uint) ..
      );
      uint dest = aavePool.repay(
        asset,
        amount,
        interestRateMode,
        onBehalfOf == msg.sender
          ? address(this)
          : onBehalfOf
      );

      if (healthFactorAddonAfterRepay != 0) {
        console.log("healthFactorAddonAfterRepay"); console.logInt(healthFactorAddonAfterRepay);
        // get actual user account data, save it to userAccountData and add {addon} to the healthFactor
        (
          uint256 totalCollateralBase,
          uint256 totalDebtBase,
          uint256 availableBorrowsBase,
          uint256 currentLiquidationThreshold,
          uint256 ltv,
          uint256 healthFactor
        ) = aavePool.getUserAccountData(address(this));
        console.log("healthFactorAddonAfterRepay.healthFactor", healthFactor);
        console.log("healthFactorAddonAfterRepay.healthFactor.fixed", uint(int(healthFactor) + healthFactorAddonAfterRepay));
        userAccountData = UserAccountData({
          initialized: true,
          totalCollateralBase: totalCollateralBase,
          totalDebtBase: totalDebtBase,
          availableBorrowsBase: availableBorrowsBase,
          currentLiquidationThreshold: currentLiquidationThreshold,
          ltv: ltv,
          healthFactor: uint(int(healthFactor) + healthFactorAddonAfterRepay)
        });
      }

      return dest;
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
      console.log("Aave3PoolMock.repay ignored");
    }
    return 0;
  }

  function setUserEMode(uint8 categoryId) external override {
    aavePool.setUserEMode(categoryId);
  }

  function setUserUseReserveAsCollateral(address asset, bool useAsCollateral) external override {
    console.log("setUserUseReserveAsCollateral", asset, useAsCollateral);
    aavePool.setUserUseReserveAsCollateral(asset, useAsCollateral);
  }

  function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external override {
    if (! ignoreSupply) {
      console.log("Aave3PoolMock.supply", asset, amount);
      IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
      console.log("Balance before supply", IERC20(asset).balanceOf(address(this)) );

      // we need to supply twice more amount then required
      // to be able to split a-tokens on two equal parts
      // one part send to the sender (to pass validation on sender's side)
      // another part keep on our balance to be able to make a borrow
      // We assume, that this contract already have required amount on its balance
      aavePool.supply(
        asset,
        amount * 2,
        onBehalfOf == msg.sender
          ? address(this)
          : onBehalfOf,
        referralCode);
      console.log("Balance after supply", IERC20(asset).balanceOf(address(this)) );

      Aave3DataTypes.ReserveData memory d = aavePool.getReserveData(asset);
      console.log("Balance atokens", IERC20(d.aTokenAddress).balanceOf(address(this)) );
      if (!skipSendingATokens) {
        IERC20(d.aTokenAddress).transfer(msg.sender, IERC20(d.aTokenAddress).balanceOf(address(this)) / 2);
        console.log("Balance atokens 2", IERC20(d.aTokenAddress).balanceOf(address(this)) );
      }
    } else {
      console.log("Aave3PoolMock.supply ignored");
    }
  }

  function withdraw(address asset, uint256 amount, address to) external override returns (uint256) {
    if (! ignoreWithdraw) {
      console.log("Aave3PoolMock.withdraw");
      uint ret = aavePool.withdraw(asset, amount, to);
      IERC20(asset).safeTransfer(msg.sender, IERC20(asset).balanceOf(address(this)) );
      return ret;
    } else {
      console.log("Aave3PoolMock.withdraw ignored");
    }
    return 0;
  }
  //endregion --------------------------------- IAavePool facade. All functions required by Aave3PoolAdapterBase

  //region --------------------------------- IAavePool - all other functions
  function BRIDGE_PROTOCOL_FEE() external view override returns (uint256) {
    return aavePool.BRIDGE_PROTOCOL_FEE();
  }

  function FLASHLOAN_PREMIUM_TOTAL() external view override returns (uint128) {
    return aavePool.FLASHLOAN_PREMIUM_TOTAL();
  }

  function FLASHLOAN_PREMIUM_TO_PROTOCOL() external view override returns (uint128) {
    return aavePool.FLASHLOAN_PREMIUM_TO_PROTOCOL();
  }

  function MAX_NUMBER_RESERVES() external view override returns (uint16) {
    return aavePool.MAX_NUMBER_RESERVES();
  }

  function MAX_STABLE_RATE_BORROW_SIZE_PERCENT() external view override returns (uint256) {
    return aavePool.MAX_STABLE_RATE_BORROW_SIZE_PERCENT();
  }

  function POOL_REVISION() external view override returns (uint256) {
    return aavePool.POOL_REVISION();
  }

  function backUnbacked(address asset, uint256 amount, uint256 fee) external override {
    aavePool.backUnbacked(asset, amount, fee);
  }

  function dropReserve(address asset) external override {
    aavePool.dropReserve(asset);
  }

  function finalizeTransfer(
    address asset,
    address from,
    address to,
    uint256 amount,
    uint256 balanceFromBefore,
    uint256 balanceToBefore
  ) external override {
    aavePool.finalizeTransfer(asset, from, to, amount, balanceFromBefore, balanceToBefore);
  }

  function flashLoan(
    address receiverAddress,
    address[] memory assets,
    uint256[] memory amounts,
    uint256[] memory interestRateModes,
    address onBehalfOf,
    bytes memory params,
    uint16 referralCode
  ) external override {
    aavePool.flashLoan(receiverAddress, assets, amounts, interestRateModes, onBehalfOf, params, referralCode);
  }

  function flashLoanSimple(
    address receiverAddress,
    address asset,
    uint256 amount,
    bytes memory params,
    uint16 referralCode
  ) external override {
    aavePool.flashLoanSimple(receiverAddress, asset, amount, params, referralCode);
  }

  function getReserveAddressById(uint16 id) external view override returns (address) {
    return aavePool.getReserveAddressById(id);
  }
  function initReserve(
    address asset,
    address aTokenAddress,
    address stableDebtAddress,
    address variableDebtAddress,
    address interestRateStrategyAddress
  ) external override {
    aavePool.initReserve(asset, aTokenAddress, stableDebtAddress, variableDebtAddress, interestRateStrategyAddress);
  }

  function initialize(address provider) external override {
    aavePool.initialize(provider);
  }

  function liquidationCall(
    address collateralAsset,
    address debtAsset,
    address user,
    uint256 debtToCover,
    bool receiveAToken
  ) external override {
    aavePool.liquidationCall(collateralAsset, debtAsset, user, debtToCover, receiveAToken);
  }

  function mintToTreasury(address[] memory assets) external override {
    return aavePool.mintToTreasury(assets);
  }

  function mintUnbacked(
    address asset,
    uint256 amount,
    address onBehalfOf,
    uint16 referralCode
  ) external override {
    aavePool.mintUnbacked(asset, amount, onBehalfOf, referralCode);
  }

  function rebalanceStableBorrowRate(address asset, address user) external override {
    aavePool.rebalanceStableBorrowRate(asset, user);
  }
  function repayWithATokens(
    address asset,
    uint256 amount,
    uint256 interestRateMode
  ) external override returns (uint256) {
    return aavePool.repayWithATokens(asset, amount, interestRateMode);
  }

  function repayWithPermit(
    address asset,
    uint256 amount,
    uint256 interestRateMode,
    address onBehalfOf,
    uint256 deadline,
    uint8 permitV,
    bytes32 permitR,
    bytes32 permitS
  ) external override returns (uint256) {
    return aavePool.repayWithPermit(asset, amount, interestRateMode, onBehalfOf, deadline, permitV, permitR, permitS);
  }

  function rescueTokens(
    address token,
    address to,
    uint256 amount
  ) external override {
    aavePool.rescueTokens(token, to, amount);
  }

  function resetIsolationModeTotalDebt(address asset) external override {
    aavePool.resetIsolationModeTotalDebt(asset);
  }

  function setConfiguration(
    address asset,
    Aave3DataTypes.ReserveConfigurationMap memory configuration
  ) external override {
    aavePool.setConfiguration(asset, configuration);
  }

  function setReserveInterestRateStrategyAddress(
    address asset,
    address rateStrategyAddress
  ) external override {
    aavePool.setReserveInterestRateStrategyAddress(asset, rateStrategyAddress);
  }

  function supplyWithPermit(
    address asset,
    uint256 amount,
    address onBehalfOf,
    uint16 referralCode,
    uint256 deadline,
    uint8 permitV,
    bytes32 permitR,
    bytes32 permitS
  ) external override {
    aavePool.supplyWithPermit(asset, amount, onBehalfOf, referralCode, deadline, permitV, permitR, permitS);
  }

  function swapBorrowRateMode(address asset, uint256 interestRateMode) external override {
    aavePool.swapBorrowRateMode(asset, interestRateMode);
  }

  function updateBridgeProtocolFee(uint256 protocolFee) external override {
    aavePool.updateBridgeProtocolFee(protocolFee);
  }

  function updateFlashloanPremiums(
    uint128 flashLoanPremiumTotal,
    uint128 flashLoanPremiumToProtocol
  ) external override {
    return aavePool.updateFlashloanPremiums(flashLoanPremiumTotal, flashLoanPremiumToProtocol);
  }

  function configureEModeCategory(uint8 id, Aave3DataTypes.EModeCategory memory category) external override {
    aavePool.configureEModeCategory(id, category);
  }

  function deposit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external override {
    aavePool.deposit(asset, amount, onBehalfOf, referralCode);
  }
  //endregion --------------------------------- IAavePool - all other functions

}
