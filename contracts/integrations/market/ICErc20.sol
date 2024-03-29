// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.17;

interface ICErc20 {
  function _acceptAdmin (  ) external returns ( uint );
  function _addReserves ( uint addAmount ) external returns ( uint );
  function _reduceReserves ( uint reduceAmount ) external returns ( uint );
  function _setComptroller ( address newComptroller ) external returns ( uint );
  function _setInterestRateModel ( address newInterestRateModel ) external returns ( uint );
  function _setPendingAdmin ( address newPendingAdmin ) external returns ( uint );
  function _setReserveFactor ( uint newReserveFactorMantissa ) external returns ( uint );
  function accrualBlockNumber (  ) external view returns ( uint );
  function accrueInterest (  ) external returns ( uint );
  function admin (  ) external view returns ( address );
  function allowance ( address owner, address spender ) external view returns ( uint );
  function approve ( address spender, uint amount ) external returns ( bool );
  function balanceOf ( address owner ) external view returns ( uint );
  function balanceOfUnderlying ( address owner ) external returns ( uint );
  function borrow ( uint borrowAmount ) external returns ( uint );
  function borrowBalanceCurrent ( address account ) external returns ( uint );
  function borrowBalanceStored ( address account ) external view returns ( uint );
  function borrowIndex (  ) external view returns ( uint );
  function borrowRatePerBlock (  ) external view returns ( uint );
  function comptroller (  ) external view returns ( address );
  function decimals (  ) external view returns ( uint8 );
  function exchangeRateCurrent (  ) external returns ( uint );
  function exchangeRateStored (  ) external view returns ( uint );
  function getAccountSnapshot ( address account ) external view returns ( uint, uint, uint, uint );
  function getCash (  ) external view returns ( uint );
  function interestRateModel (  ) external view returns ( address );
  function isCToken (  ) external view returns ( bool );
  function liquidateBorrow ( address borrower, uint repayAmount, address cTokenCollateral ) external returns ( uint );
  function mint ( uint mintAmount ) external returns ( uint );
  function name (  ) external view returns ( string memory);
  function pendingAdmin (  ) external view returns ( address );
  function redeem ( uint redeemTokens ) external returns ( uint );
  function redeemUnderlying ( uint redeemAmount ) external returns ( uint );
  function repayBorrow ( uint repayAmount ) external returns ( uint );
  function repayBorrowBehalf ( address borrower, uint repayAmount ) external returns ( uint );
  function reserveFactorMantissa (  ) external view returns ( uint );
  function seize ( address liquidator, address borrower, uint seizeTokens ) external returns ( uint );
  function supplyRatePerBlock (  ) external view returns ( uint );
  function sweepToken ( address token ) external;
  function symbol (  ) external view returns ( string memory);
  function totalBorrows (  ) external view returns ( uint );
  function totalBorrowsCurrent (  ) external returns ( uint );
  function totalReserves (  ) external view returns ( uint );
  function totalSupply (  ) external view returns ( uint );
  function transfer ( address dst, uint amount ) external returns ( bool );
  function transferFrom ( address src, address dst, uint amount ) external returns ( bool );
  function underlying (  ) external view returns ( address );

  function adminFeeMantissa() external view returns (uint256);
  function fuseFeeMantissa() external view returns (uint256);
  function totalAdminFees() external view returns (uint256);
  function totalFuseFees() external view returns (uint256);

}
