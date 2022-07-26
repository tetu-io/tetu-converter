// SPDX-License-Identifier: MIT
pragma solidity >=0.7.0 <0.9.0;

/// @notice Restored from 0xcf427e1ac52a2d976b02b83f72baeb905a92e488 (Optimism; events and _xxx were removed)
/// @dev We need sources of Controller, see https://developers.dforce.network/lend/lend-and-synth/deployed-contracts
///      but contract 0x52eaCd19E38D501D006D2023C813d7E37F025f37 doesn't have sources on polygonscan
///      So, the sources were taken from the Optimism (source on Ethereum are exactly the same)
interface IDForceController {
  function afterBorrow(
    address _iToken,
    address _borrower,
    uint256 _borrowedAmount
  ) external;

  function afterFlashloan(
    address _iToken,
    address _to,
    uint256 _amount
  ) external;

  function afterLiquidateBorrow(
    address _iTokenBorrowed,
    address _iTokenCollateral,
    address _liquidator,
    address _borrower,
    uint256 _repaidAmount,
    uint256 _seizedAmount
  ) external;

  function afterMint(
    address _iToken,
    address _minter,
    uint256 _mintAmount,
    uint256 _mintedAmount
  ) external;

  function afterRedeem(
    address _iToken,
    address _redeemer,
    uint256 _redeemAmount,
    uint256 _redeemedUnderlying
  ) external;

  function afterRepayBorrow(
    address _iToken,
    address _payer,
    address _borrower,
    uint256 _repayAmount
  ) external;

  function afterSeize(
    address _iTokenCollateral,
    address _iTokenBorrowed,
    address _liquidator,
    address _borrower,
    uint256 _seizedAmount
  ) external;

  function afterTransfer(
    address _iToken,
    address _from,
    address _to,
    uint256 _amount
  ) external;

  function beforeBorrow(
    address _iToken,
    address _borrower,
    uint256 _borrowAmount
  ) external;

  function beforeFlashloan(
    address _iToken,
    address _to,
    uint256 _amount
  ) external;

  function beforeLiquidateBorrow(
    address _iTokenBorrowed,
    address _iTokenCollateral,
    address _liquidator,
    address _borrower,
    uint256 _repayAmount
  ) external;

  function beforeMint(
    address _iToken,
    address _minter,
    uint256 _mintAmount
  ) external;

  function beforeRedeem(
    address _iToken,
    address _redeemer,
    uint256 _redeemAmount
  ) external;

  function beforeRepayBorrow(
    address _iToken,
    address _payer,
    address _borrower,
    uint256 _repayAmount
  ) external;

  function beforeSeize(
    address _iTokenCollateral,
    address _iTokenBorrowed,
    address _liquidator,
    address _borrower,
    uint256 _seizeAmount
  ) external;

  function beforeTransfer(
    address _iToken,
    address _from,
    address _to,
    uint256 _amount
  ) external;

  function calcAccountEquity(address _account)
  external
  view
  returns (
    uint256,
    uint256,
    uint256,
    uint256
  );

  function closeFactorMantissa() external view returns (uint256);
  function enterMarketFromiToken(address _market, address _account) external;
  function enterMarkets(address[] memory _iTokens) external returns (bool[] memory _results);
  function exitMarkets(address[] memory _iTokens) external returns (bool[] memory _results);
  function getAlliTokens() external view returns (address[] memory _alliTokens);
  function getBorrowedAssets(address _account) external view returns (address[] memory _borrowedAssets);
  function getEnteredMarkets(address _account) external view returns (address[] memory _accountCollaterals);
  function hasBorrowed(address _account, address _iToken) external view returns (bool);
  function hasEnteredMarket(address _account, address _iToken) external view returns (bool);
  function hasiToken(address _iToken) external view returns (bool);
  function initialize() external;
  function isController() external view returns (bool);

  function liquidateCalculateSeizeTokens(
    address _iTokenBorrowed,
    address _iTokenCollateral,
    uint256 _actualRepayAmount
  ) external view returns (uint256 _seizedTokenCollateral);

  function liquidationIncentiveMantissa() external view returns (uint256);

  function markets(address)
  external
  view
  returns (
    uint256 collateralFactorMantissa,
    uint256 borrowFactorMantissa,
    uint256 borrowCapacity,
    uint256 supplyCapacity,
    bool mintPaused,
    bool redeemPaused,
    bool borrowPaused
  );

  function owner() external view returns (address);
  function pauseGuardian() external view returns (address);
  function pendingOwner() external view returns (address);
  function priceOracle() external view returns (address);
  function rewardDistributor() external view returns (address);
  function seizePaused() external view returns (bool);
  function transferPaused() external view returns (bool);
}
