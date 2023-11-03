// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../../integrations/compound3/IComet.sol";
import "../../../openzeppelin/IERC20.sol";
import "../../../openzeppelin/SafeERC20.sol";
import "hardhat/console.sol";

/// @notice Full implementation of IComet. Some functions required for testing are configurable.
///         Other function calls are just delegated to original pool
contract CometMock2 /*is IComet*/ { // some view functions are not view here
  using SafeERC20 for IERC20;

  IComet private comet;

  bool internal _disableTransferInWithdraw;
  /// @notice 0 - not used, 1 - return value immediately, 2 - return value after call of withdraw()
  ///         3 - return value after TWO calls of withdraw() and so on
  uint internal _borrowBalanceState12;
  uint internal _borrowBalanceValue;
  /// @notice 0 - not used, 1 - return value immediately, 2 - return value after call of withdraw()
  ///         3 - return value after TWO calls of withdraw() and so on
  uint internal _tokensBalanceState12;
  uint internal _tokensBalanceValue;

  constructor(address comet_) {
    comet = IComet(comet_);
  }

  //region -------------------------------------------- Set up
  function disableTransferInWithdraw() external {
    _disableTransferInWithdraw = true;
  }

  function setBorrowBalance(uint state12, uint value) external {
    _borrowBalanceState12 = state12;
    _borrowBalanceValue = value;
  }

  function setTokensBalance(uint state12, uint value) external {
    _tokensBalanceState12 = state12;
    _tokensBalanceValue = value;
  }
  //endregion -------------------------------------------- Set up

  //region -------------------------------------------- Overloaded functions
  function borrowBalanceOf(address /*account*/) external view returns (uint) {
    console.log("CometMock2.borrowBalanceOf");
    if (_borrowBalanceState12 == 1) {
      console.log("CometMock2.borrowBalanceOf is custom", _borrowBalanceValue);
      return _borrowBalanceValue;
    } else {
      return comet.borrowBalanceOf(address(this));
    }
  }


  function userCollateral(address /*user*/, address asset) external view returns (IComet.UserCollateral memory ret) {
    console.log("CometMock2.userCollateral._tokensBalanceZero", _tokensBalanceState12);
    ret = comet.userCollateral(address(this), asset);
    if (_tokensBalanceState12 == 1) {
      ret.balance = uint128(_tokensBalanceValue);
      console.log("CometMock2.userCollateral.custom balance", ret.balance);
    }
    console.log("CometMock2.userCollateral.return", ret.balance);
    return ret;
  }
  //endregion -------------------------------------------- Overloaded functions


  //region -------------------------------------------- Replacements
  function supply(address asset, uint amount) external {
    console.log("CometMock2.supply", asset, amount);
    IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
    IERC20(asset).safeApprove(address(comet), 2 ** 255);
    comet.supply(asset, amount);
  }

  function withdraw(address asset, uint amount) external {
    console.log("CometMock2.withdraw", asset, amount);
    comet.withdraw(asset, amount);
    console.log("CometMock2.withdraw.balance", IERC20(asset).balanceOf(address(this)));
    if (! _disableTransferInWithdraw) {
      IERC20(asset).safeTransfer(msg.sender, amount);
      console.log("CometMock2.withdraw.after transfer", IERC20(asset).balanceOf(address(this)));
    }
    if (_tokensBalanceState12 > 1) _tokensBalanceState12--;
    if (_borrowBalanceState12 > 1) _borrowBalanceState12--;
  }
  //endregion -------------------------------------------- Replacements

  //region -------------------------------------------- Delegated calls
  function baseTokenPriceFeed() external view returns (address) {
    console.log("CometMock2.baseTokenPriceFeed");
    return comet.baseTokenPriceFeed();
  }

  function numAssets() external view returns (uint8) {
    console.log("CometMock2.numAssets");
    return comet.numAssets();
  }

  function getAssetInfo(uint8 i) external view returns (IComet.AssetInfo memory) {
    console.log("CometMock2.getAssetInfo");
    return comet.getAssetInfo(i);
  }

  function getAssetInfoByAddress(address asset) external view returns (IComet.AssetInfo memory) {
    console.log("CometMock2.getAssetInfoByAddress");
    return comet.getAssetInfoByAddress(asset);
  }

  function baseToken() external view returns (address) {
    console.log("CometMock2.baseToken", comet.baseToken());
    return comet.baseToken();
  }

  function balanceOf(address account) external view returns (uint) {
    console.log("CometMock2.balanceOf");
    return comet.balanceOf(account);
  }

  function totalSupply() external view returns (uint) {
    console.log("CometMock2.totalSupply");
    return comet.totalSupply();
  }

  function isSupplyPaused() external view returns (bool) {
    console.log("CometMock2.isSupplyPaused");
    return comet.isSupplyPaused();
  }

  function isWithdrawPaused() external view returns (bool) {
    console.log("CometMock2.isWithdrawPaused");
    return comet.isWithdrawPaused();
  }

  function getBorrowRate(uint utilization) external view returns (uint64) {
    console.log("CometMock2.getBorrowRate");
    return comet.getBorrowRate(utilization);
  }

  function getUtilization() external view returns (uint) {
    console.log("CometMock2.getUtilization");
    return comet.getUtilization();
  }

  function baseTrackingBorrowSpeed() external view returns (uint) {
    console.log("CometMock2.baseTrackingBorrowSpeed");
    return comet.baseTrackingBorrowSpeed();
  }

  function baseScale() external view returns (uint) {
    console.log("CometMock2.baseScale", comet.baseScale());
    return comet.baseScale();
  }

  function baseIndexScale() external view returns (uint) {
    console.log("CometMock2.baseIndexScale");
    return comet.baseIndexScale();
  }

  function totalBorrow() external view returns (uint) {
    console.log("CometMock2.totalBorrow");
    return comet.totalBorrow();
  }

  function baseBorrowMin() external view returns (uint) {
    console.log("CometMock2.baseBorrowMin");
    return comet.baseBorrowMin();
  }

  function pause(bool supplyPaused, bool transferPaused, bool withdrawPaused, bool absorbPaused, bool buyPaused) external {
    console.log("CometMock2.pause");
    comet.pause(supplyPaused, transferPaused, withdrawPaused, absorbPaused, buyPaused);
  }

  function pauseGuardian() external view returns (address) {
    console.log("CometMock2.pauseGuardian");
    return comet.pauseGuardian();
  }

  function absorb(address absorber, address[] calldata accounts) external {
    console.log("CometMock2.absorb");
    return comet.absorb(absorber, accounts);
  }

  function quoteCollateral(address asset, uint baseAmount) external view returns (uint) {
    console.log("CometMock2.quoteCollateral");
    return comet.quoteCollateral(asset, baseAmount);
  }

  function buyCollateral(address asset, uint minAmount, uint baseAmount, address recipient) external {
    console.log("CometMock2.buyCollateral");
    return comet.buyCollateral(asset, minAmount, baseAmount, recipient);
  }

  function accrueAccount(address /*account*/) external {
    console.log("CometMock2.accrueAccount");
    return comet.accrueAccount(address(this));
  }
  //endregion -------------------------------------------- Delegated calls
}