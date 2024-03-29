// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../../integrations/compound/ICTokenBase.sol";
import "../../../openzeppelin/IERC20.sol";
import "../../../openzeppelin/IERC20Metadata.sol";
import {ERC20} from "@rari-capital/solmate/src/tokens/ERC20.sol";
import "hardhat/console.sol";

/// @notice Min common set of functions of Compound cTokens
/// required to implement platform and pool adapters
contract CompoundCTokenBaseMock is ICTokenBase, ERC20 {
  address internal _underlying;
  uint internal _cash;
  uint internal _totalBorrows;
  uint internal _totalReserves;
  uint internal _reserveFactorMantissa;
  address internal _interestRateModel;
  uint internal _mintErrorCode;
  uint internal _getAccountSnapshotErrorCode;
  uint internal _borrowErrorCode;
  uint internal _repayBorrowErrorCode;
  uint internal _redeemErrorCode;
  /// @notice  tokenBalance, borrowBalance, exchangeRateMantissa
  uint[3] internal _getAccountSnapshotValues;
  uint internal _borrowAmountToSendToPoolAdapter;
  uint internal _collateralAmountToSendToPoolAdapter;

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
  function setMintErrorCode(uint errorCode_) external {
    _mintErrorCode = errorCode_;
  }
  function setGetAccountSnapshotErrorCode(uint errorCode_) external {
    _getAccountSnapshotErrorCode = errorCode_;
  }
  function setBorrowErrorCode(uint errorCode_) external {
    _borrowErrorCode = errorCode_;
  }
  function setRepayBorrowErrorCode(uint errorCode_) external {
    _repayBorrowErrorCode = errorCode_;
  }
  function setRedeemErrorCode(uint errorCode_) external {
    _redeemErrorCode = errorCode_;
  }
  function setGetAccountSnapshotValues(uint tokenBalance, uint borrowBalance, uint exchangeRateMantissa) external {
    _getAccountSnapshotValues[0] = tokenBalance;
    _getAccountSnapshotValues[1] = borrowBalance;
    _getAccountSnapshotValues[2] = exchangeRateMantissa;
  }
  function setBorrowAmountToSendToPoolAdapter(uint value) external {
    _borrowAmountToSendToPoolAdapter = value;
  }
  function setCollateralAmountToSendToPoolAdapter(uint value) external {
    _collateralAmountToSendToPoolAdapter = value;
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
  function borrowBalanceCurrent(address account) external view returns (uint256) {
    account;
    return _getAccountSnapshotValues[1];
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
  function getAccountSnapshot(address account) external view returns (
    uint256 errorCode,
    uint256 tokenBalance,
    uint256 borrowBalance,
    uint256 exchangeRateMantissa
  ) {
    account;
    // todo
    return (_getAccountSnapshotErrorCode,
      _getAccountSnapshotValues[0],
      _getAccountSnapshotValues[1],
      _getAccountSnapshotValues[2]
    );
  }

  function borrow(uint256 borrowAmount_) external returns (uint256) {
    console.log("borrow.borrowAmount_", borrowAmount_);
    console.log("borrow._borrowAmountToSendToPoolAdapter", _borrowAmountToSendToPoolAdapter);
    uint256 borrowAmount = _borrowAmountToSendToPoolAdapter == 0
      ? borrowAmount_
      : _borrowAmountToSendToPoolAdapter;
    console.log("borrow.borrowAmount", borrowAmount);

    IERC20(_underlying).transfer(msg.sender, borrowAmount);
    _getAccountSnapshotValues[1] += borrowAmount;
    return _borrowErrorCode;
  }

  /// @notice Sender supplies assets into the market and receives mTokens in exchange
  /// @dev Accrues interest whether or not the operation succeeds, unless reverted
  /// @param mintAmount The amount of the underlying asset to supply
  /// @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
  function mint(uint256 mintAmount) external returns (uint256) {
    console.log("mintAmount", mintAmount);
    uint tokensAmount = mintAmount * 1e18 / _getAccountSnapshotValues[2];
    console.log("exchange rate", _getAccountSnapshotValues[2]);
    console.log("tokensAmount", tokensAmount);
    console.log("_underlying balance", IERC20(_underlying).balanceOf(address(this)));
    IERC20(_underlying).transferFrom(msg.sender, address(this), mintAmount);
    console.log("mint.1");
    mint(msg.sender, tokensAmount);
    console.log("mint.2");
    _getAccountSnapshotValues[0] += tokensAmount;
    return _mintErrorCode;
  }

  /// @notice Sender repays their own borrow
  /// @param repayAmount The amount to repay
  /// @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
  function repayBorrow(uint256 repayAmount) external returns (uint256) {
    IERC20(_underlying).transferFrom(msg.sender, address(this), repayAmount);
    _getAccountSnapshotValues[1] -= repayAmount;
    return _repayBorrowErrorCode;
  }

  /// @notice Sender redeems mTokens in exchange for the underlying asset
  /// @dev Accrues interest whether or not the operation succeeds, unless reverted
  /// @param redeemTokens The number of mTokens to redeem into underlying
  /// @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
  function redeem(uint256 redeemTokens) external returns (uint256) {
    console.log("redeem.redeemTokens", redeemTokens);
    console.log("redeem._getAccountSnapshotValues[2]", _getAccountSnapshotValues[2]);
    uint underlyingAmount = _collateralAmountToSendToPoolAdapter == 0
      ? redeemTokens * _getAccountSnapshotValues[2] / 1e18
      : _collateralAmountToSendToPoolAdapter;
    console.log("redeem.underlyingAmount", underlyingAmount);
    console.log("redeem.balance", IERC20(_underlying).balanceOf(address(this)));

    IERC20(_underlying).transfer(msg.sender, underlyingAmount);
    console.log("redeem.1");
    uint redeemTokensActual = underlyingAmount * 1e18 / _getAccountSnapshotValues[2];
    burn(msg.sender, redeemTokensActual);
    console.log("redeem.2");
    _getAccountSnapshotValues[0] -= redeemTokensActual;
    console.log("redeem.3");

    return _redeemErrorCode;
  }
  //endregion ------------------------------------------------------------- ICTokenBase
}
