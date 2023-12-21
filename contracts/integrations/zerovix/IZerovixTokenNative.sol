// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Restored from zkevm.0x4C6E83B9f7e8835F583be748De899c5881FBc403, events were removed
interface IZerovixTokenNative {
  function _acceptAdmin() external returns (uint256);

  function _addReserves() external payable returns (uint256);

  function _reduceReserves(uint256 reduceAmount) external returns (uint256);

  function _setComptroller(address newComptroller) external returns (uint256);

  function _setInterestRateModel(address newInterestRateModel) external returns (uint256);

  function _setPendingAdmin(address newPendingAdmin) external returns (uint256);

  function _setProtocolSeizeShare(uint256 newProtocolSeizeShareMantissa) external returns (uint256);

  function _setReserveFactor(uint256 newReserveFactorMantissa) external returns (uint256);

  function accrualBlockTimestamp() external view returns (uint256);

  function accrueInterest() external returns (uint256);

  function admin() external view returns (address);

  function allowance(address owner, address spender) external view  returns (uint256);

  function approve(address spender, uint256 amount) external returns (bool);

  function balanceOf(address owner) external view returns (uint256);

  function balanceOfUnderlying(address owner) external returns (uint256);

  function borrow(uint256 borrowAmount) external returns (uint256);

  function borrowBalanceCurrent(address account) external returns (uint256);

  function borrowBalanceStored(address account) external view returns (uint256);

  function borrowIndex() external view returns (uint256);

  function borrowRatePerTimestamp() external view returns (uint256);

  function comptroller() external view returns (address);

  function decimals() external view returns (uint8);

  function exchangeRateCurrent() external returns (uint256);

  function exchangeRateStored() external view returns (uint256);

  function getAccountSnapshot(address account) external view returns (uint256, uint256, uint256, uint256);

  function getCash() external view returns (uint256);

  function init(address comptroller_, address interestRateModel_, uint256 initialExchangeRateMantissa_, string memory name_, string memory symbol_, uint8 decimals_, address admin_) external;

  function interestRateModel() external view returns (address);

  function isInit() external view returns (bool);

  function isOToken() external view returns (bool);

  function liquidateBorrow(address borrower, address oTokenCollateral) external payable;

  function mint() external payable;

  function name() external view returns (string memory);

  function pendingAdmin() external view returns (address);

  function protocolSeizeShareMantissa() external view returns (uint256);

  function redeem(uint256 redeemTokens) external returns (uint256);

  function redeemUnderlying(uint256 redeemAmount) external returns (uint256);

  function repayBorrow() external payable;

  function repayBorrowBehalf(address borrower) external payable;

  function reserveFactorMantissa() external view returns (uint256);

  function seize(address liquidator, address borrower, uint256 seizeTokens) external returns (uint256);

  function setAdmin(address _admin) external;

  function supplyRatePerTimestamp() external view returns (uint256);

  function symbol() external view returns (string memory);

  function totalBorrows() external view returns (uint256);

  function totalBorrowsCurrent() external returns (uint256);

  function totalReserves() external view returns (uint256);

  function totalSupply() external view returns (uint256);

  function transfer(address dst, uint256 amount) external returns (bool);

  function transferFrom(address src, address dst, uint256 amount) external returns (bool);

  receive() external payable;
}

