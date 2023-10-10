// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../../integrations/compound/ICTokenBase.sol";
import {ERC20} from "@rari-capital/solmate/src/tokens/ERC20.sol";

/// @notice Min common set of functions of Compound cTokens
/// required to implement platform and pool adapters
contract CompoundCTokenBaseMock is ICTokenBase, ERC20 {
  address internal _underlying;
  uint internal _cash;
  uint internal _totalBorrows;
  uint internal _totalReserves;
  uint internal _reserveFactorMantissa;
  address internal _interestRateModel;

  constructor(
    string memory _name,
    string memory _symbol,
    uint8 _decimals
  ) ERC20(_name, _symbol, _decimals) {}

  function mint(address to, uint256 value) public virtual {
    _mint(to, value);
  }

  function burn(address from, uint256 value) public virtual {
    _burn(from, value);
  }

  //region ------------------------------------------------------------- Set up ICTokenBase
  function setUnderlying(address underlying_) external {
    _underlying = underlying_;
  }
  function setInterestRateModel(address interestRateModel_) external {
    _interestRateModel = interestRateModel_;
  }
  function setCash(uint cash_) external {
    _cash = cash_;
  }
  function setTotalBorrows(uint totalBorrows_) external {
    _totalBorrows = totalBorrows_;
  }
  function setTotalReserves(uint totalReserves_) external {
    _totalReserves = totalReserves_;
  }
  function setReserveFactorMantissa(uint reserveFactorMantissa_) external {
    _reserveFactorMantissa = reserveFactorMantissa_;
  }
  //endregion ------------------------------------------------------------- Set up ICTokenBase

  //region ------------------------------------------------------------- ICTokenBase
  function underlying() external view returns (address) {
    return _underlying;
  }

  /// @notice Get cash balance of this mToken in the underlying asset
  /// @return The quantity of underlying asset owned by this contract
  function getCash() external view returns (uint256) {
    return _cash;
  }

  /// @notice Total amount of outstanding borrows of the underlying in this market
  function totalBorrows() external view returns (uint256) {
    return _totalBorrows;
  }

  function totalReserves() external view returns (uint256) {
    return _totalReserves;
  }

  /// @notice Model which tells what the current interest rate should be
  function interestRateModel() external view returns (address) {
    return _interestRateModel;
  }

  /// @notice Fraction of interest currently set aside for reserves
  function reserveFactorMantissa() external view returns (uint256) {
    return _reserveFactorMantissa;
  }

  /// @notice Accrue interest to updated borrowIndex and then calculate account's borrow balance using the updated borrowIndex
  /// @param account The address whose balance should be calculated after updating borrowIndex
  /// @return The calculated balance
  function borrowBalanceCurrent(address account) external  pure  returns (uint256) {
    account;
    // todo
    return 0;
  }

  /// @notice Accrue interest then return the up-to-date exchange rate
  /// @return Calculated exchange rate scaled by 1e18
  function exchangeRateCurrent() external  pure  returns (uint256) {
    // todo
    return 0;
  }

  /// @notice Get a snapshot of the account's balances, and the cached exchange rate
  /// @dev This is used by comptroller to more efficiently perform liquidity checks.
  /// @param account Address of the account to snapshot
  function getAccountSnapshot(address account) external pure returns (
    uint256 errorCode,
    uint256 tokenBalance,
    uint256 borrowBalance,
    uint256 exchangeRateMantissa
  ) {
    account;
    // todo
    return (errorCode, tokenBalance, borrowBalance, exchangeRateMantissa);
  }

/// @notice Sender borrows assets from the protocol to their own address
  /// @param borrowAmount The amount of the underlying asset to borrow
  /// @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
  function borrow(uint256 borrowAmount) external  pure  returns (uint256) {
    borrowAmount;
    // todo
    return 0;
  }

  /// @notice Sender supplies assets into the market and receives mTokens in exchange
  /// @dev Accrues interest whether or not the operation succeeds, unless reverted
  /// @param mintAmount The amount of the underlying asset to supply
  /// @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
  function mint(uint256 mintAmount) external  pure  returns (uint256) {
    mintAmount;
    // todo
    return 0;
  }

  /// @notice Sender repays their own borrow
  /// @param repayAmount The amount to repay
  /// @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
  function repayBorrow(uint256 repayAmount) external  pure  returns (uint256) {
    repayAmount;
    // todo
    return 0;
  }

  /// @notice Sender redeems mTokens in exchange for the underlying asset
  /// @dev Accrues interest whether or not the operation succeeds, unless reverted
  /// @param redeemTokens The number of mTokens to redeem into underlying
  /// @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
  function redeem(uint256 redeemTokens) external  pure  returns (uint256) {
    redeemTokens;
    // todo
    return 0;
  }
  //endregion ------------------------------------------------------------- ICTokenBase
}
