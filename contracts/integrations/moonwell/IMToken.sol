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

}
