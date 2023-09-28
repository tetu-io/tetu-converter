// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Common interface for any implementation of compound cTokens
/// @dev Created from Moonwell IMToken
interface ICTokenBase {
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

  /// @notice Get cash balance of this mToken in the underlying asset
  /// @return The quantity of underlying asset owned by this contract
  function getCash() external view returns (uint256);

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

  /// @notice Model which tells what the current interest rate should be
  function interestRateModel() external view returns (address);

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

  /// @notice Fraction of interest currently set aside for reserves
  function reserveFactorMantissa() external view returns (uint256);

  function seize(address liquidator, address borrower, uint256 seizeTokens) external returns (uint256);

  /// @notice A public function to sweep accidental ERC-20 transfers to this contract. Tokens are sent to admin (timelock)
  /// @param token The address of the ERC-20 token to sweep
  function sweepToken(address token) external;

  function symbol() external view returns (string memory);

  /// @notice Total amount of outstanding borrows of the underlying in this market
  function totalBorrows() external view returns (uint256);

  /// @notice Returns the current total borrows plus accrued interest
  /// @return The total borrows with interest
  function totalBorrowsCurrent() external returns (uint256);

  function totalReserves() external view returns (uint256);

  /// @notice Total number of tokens in circulation
  function totalSupply() external view returns (uint256);

  function transfer(address dst, uint256 amount) external returns (bool);

  function transferFrom(address src, address dst, uint256 amount) external returns (bool);

  function underlying() external view returns (address);
}
