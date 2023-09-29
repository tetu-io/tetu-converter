// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../compound/ICToken.sol";
import "../compound/ICTokenRatesPerTimestamp.sol";

/// @notice Restored from implementation 0x1FADFF493529C3Fcc7EE04F1f15D19816ddA45B7
/// of 0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22
interface IMToken is ICTokenBase, ICTokenRatesPerTimestamp {
  event AccrueInterest(
    uint256 cashPrior,
    uint256 interestAccumulated,
    uint256 borrowIndex,
    uint256 totalBorrows
  );
  event Approval(
    address indexed owner,
    address indexed spender,
    uint256 amount
  );
  event Borrow(
    address borrower,
    uint256 borrowAmount,
    uint256 accountBorrows,
    uint256 totalBorrows
  );
  event Failure(uint256 error, uint256 info, uint256 detail);
  event LiquidateBorrow(
    address liquidator,
    address borrower,
    uint256 repayAmount,
    address mTokenCollateral,
    uint256 seizeTokens
  );
  event Mint(address minter, uint256 mintAmount, uint256 mintTokens);
  event NewAdmin(address oldAdmin, address newAdmin);
  event NewComptroller(address oldComptroller, address newComptroller);
  event NewMarketInterestRateModel(
    address oldInterestRateModel,
    address newInterestRateModel
  );
  event NewPendingAdmin(address oldPendingAdmin, address newPendingAdmin);
  event NewProtocolSeizeShare(
    uint256 oldProtocolSeizeShareMantissa,
    uint256 newProtocolSeizeShareMantissa
  );
  event NewReserveFactor(
    uint256 oldReserveFactorMantissa,
    uint256 newReserveFactorMantissa
  );
  event Redeem(address redeemer, uint256 redeemAmount, uint256 redeemTokens);
  event RepayBorrow(
    address payer,
    address borrower,
    uint256 repayAmount,
    uint256 accountBorrows,
    uint256 totalBorrows
  );
  event ReservesAdded(
    address benefactor,
    uint256 addAmount,
    uint256 newTotalReserves
  );
  event ReservesReduced(
    address admin,
    uint256 reduceAmount,
    uint256 newTotalReserves
  );
  event Transfer(address indexed from, address indexed to, uint256 amount);

  function _acceptAdmin() external returns (uint256);

  function _addReserves(uint256 addAmount) external returns (uint256);

  function _becomeImplementation(bytes memory data) external;

  function _reduceReserves(uint256 reduceAmount) external returns (uint256);

  function _resignImplementation() external;

  function _setComptroller(address newComptroller) external returns (uint256);

  function _setInterestRateModel(address newInterestRateModel) external returns (uint256);

  function _setPendingAdmin(address newPendingAdmin) external returns (uint256);

  function _setProtocolSeizeShare(uint256 newProtocolSeizeShareMantissa) external returns (uint256);

  function _setReserveFactor(uint256 newReserveFactorMantissa) external returns (uint256);


  /// @notice Block number that interest was last accrued at
  function accrualBlockTimestamp() external view returns (uint256);

  function protocolSeizeShareMantissa() external view returns (uint256);

  function isMToken() external view returns (bool);

  /// @notice Applies accrued interest to total borrows and reserves
  /// @dev This calculates interest accrued from the last checkpointed block
  ///      up to the current block and writes new checkpoint to storage.
  function accrueInterest() external returns (uint256);

  function admin() external view returns (address);

  function allowance(address owner, address spender) external view returns (uint256);

  function approve(address spender, uint256 amount) external returns (bool);

  function balanceOf(address owner) external view returns (uint256);

  function balanceOfUnderlying(address owner) external returns (uint256);

  /// @notice Sender borrows assets from the protocol to their own address
  /// @param borrowAmount The amount of the underlying asset to borrow
  /// @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
  function borrow(uint256 borrowAmount) external returns (uint256);


  /// @notice Accrue interest to updated borrowIndex and then calculate account's borrow balance using the updated borrowIndex
  /// @param account The address whose balance should be calculated after updating borrowIndex
  /// @return The calculated balance
  function borrowBalanceCurrent(address account) external returns (uint256);

  /// @notice Accrue interest to updated borrowIndex and then calculate account's borrow balance using the updated borrowIndex
  /// @param account The address whose balance should be calculated after updating borrowIndex
  /// @return The calculated balance
  function borrowBalanceStored(address account) external view returns (uint256);

  /// @notice Accumulator of the total earned interest rate since the opening of the market
  function borrowIndex() external view returns (uint256);

  function comptroller() external view returns (address);

  function decimals() external view returns (uint8);

  /// @notice Accrue interest then return the up-to-date exchange rate
  /// @return Calculated exchange rate scaled by 1e18
  function exchangeRateCurrent() external returns (uint256);

  /// @notice Calculates the exchange rate from the underlying to the MToken
  /// @dev This function does not accrue interest before calculating the exchange rate
  /// @return Calculated exchange rate scaled by 1e18
  function exchangeRateStored() external view returns (uint256);

  /// @notice Get a snapshot of the account's balances, and the cached exchange rate
  /// @dev This is used by comptroller to more efficiently perform liquidity checks.
  /// @param account Address of the account to snapshot
  /// @return (possible error, token balance, borrow balance, exchange rate mantissa)
  function getAccountSnapshot(address account) external view returns (
    uint256 errorCode,
    uint256 tokenBalance,
    uint256 borrowBalance,
    uint256 exchangeRateMantissa
  );


  function implementation() external view returns (address);

  function initialize(
    address underlying_,
    address comptroller_,
    address interestRateModel_,
    uint256 initialExchangeRateMantissa_,
    string memory name_,
    string memory symbol_,
    uint8 decimals_
  ) external;

  function initialize(
    address comptroller_,
    address interestRateModel_,
    uint256 initialExchangeRateMantissa_,
    string memory name_,
    string memory symbol_,
    uint8 decimals_
  ) external;

  function liquidateBorrow(address borrower, uint256 repayAmount, address mTokenCollateral) external returns (uint256);

  /// @notice Sender supplies assets into the market and receives mTokens in exchange
  /// @dev Accrues interest whether or not the operation succeeds, unless reverted
  /// @param mintAmount The amount of the underlying asset to supply
  /// @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
  function mint(uint256 mintAmount) external returns (uint256);

  function mintWithPermit(uint256 mintAmount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external returns (uint256);

  function name() external view returns (string memory);

  function pendingAdmin() external view returns (address);

  /// @notice Sender redeems mTokens in exchange for the underlying asset
  /// @dev Accrues interest whether or not the operation succeeds, unless reverted
  /// @param redeemTokens The number of mTokens to redeem into underlying
  /// @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
  function redeem(uint256 redeemTokens) external returns (uint256);

  /// @notice Sender redeems mTokens in exchange for a specified amount of underlying asset
  /// @dev Accrues interest whether or not the operation succeeds, unless reverted
  /// @param redeemAmount The amount of underlying to redeem
  /// @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
  function redeemUnderlying(uint256 redeemAmount) external returns (uint256);

  /// @notice Sender repays their own borrow
  /// @param repayAmount The amount to repay
  /// @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
  function repayBorrow(uint256 repayAmount) external returns (uint256);

  /// @notice Sender repays a borrow belonging to borrower
  /// @param borrower the account with the debt being payed off
  /// @param repayAmount The amount to repay
  /// @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
  function repayBorrowBehalf(address borrower, uint256 repayAmount) external returns (uint256);

  function seize(address liquidator, address borrower, uint256 seizeTokens) external returns (uint256);

  /// @notice A public function to sweep accidental ERC-20 transfers to this contract. Tokens are sent to admin (timelock)
  /// @param token The address of the ERC-20 token to sweep
  function sweepToken(address token) external;

  function symbol() external view returns (string memory);

  /// @notice Returns the current total borrows plus accrued interest
  /// @return The total borrows with interest
  function totalBorrowsCurrent() external returns (uint256);

  /// @notice Total number of tokens in circulation
  function totalSupply() external view returns (uint256);

  function transfer(address dst, uint256 amount) external returns (bool);

  function transferFrom(address src, address dst, uint256 amount) external returns (bool);
}
