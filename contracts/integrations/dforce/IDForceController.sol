// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

/// @notice Restored from 0xcf427e1ac52a2d976b02b83f72baeb905a92e488 (Optimism; events and _xxx were removed)
/// @dev We need sources of Controller, see https://developers.dforce.network/lend/lend-and-synth/deployed-contracts
///      but contract 0x52eaCd19E38D501D006D2023C813d7E37F025f37 doesn't have sources on polygonscan
///      So, the sources were taken from the Optimism (source on Ethereum are exactly the same)
interface IDForceController {
  /**
   * @notice Hook function after iToken `borrow()`
     * Will `revert()` if any operation fails
     * @param _iToken The iToken being borrewd
     * @param _borrower The account which borrowed iToken
     * @param _borrowedAmount  The amount of underlying being borrowed
     */
  function afterBorrow(
    address _iToken,
    address _borrower,
    uint256 _borrowedAmount
  ) external;

  /**
   * @notice Hook function after iToken `flashloan()`
     * Will `revert()` if any operation fails
     * @param _iToken The iToken was flashloaned
     * @param _to The account flashloan transfer to
     * @param _amount  The amount was flashloaned
     */
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

  /**
   * @notice Hook function before iToken `borrow()`
     * Checks if the account should be allowed to borrow the given iToken
     * Will `revert()` if any check fails
     * @param _iToken The iToken to check the borrow against
     * @param _borrower The account which would borrow iToken
     * @param _borrowAmount The amount of underlying to borrow
     */
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

  /// @notice return account equity, shortfall, collateral value, borrowed value.
  function calcAccountEquity(address _account)
  external
  view
  returns (
    uint256 accountEquity,
    uint256 shortfall,
    uint256 collateralValue,
    uint256 borrowedValue
  );

  /**
   * @notice Multiplier used to calculate the maximum repayAmount when liquidating a borrow
     */
  function closeFactorMantissa() external view returns (uint256);

  /**
   * @notice Only expect to be called by iToken contract.
     * @dev Add the market to the account's markets list for liquidity calculations
     * @param _account The address of the account to modify
     */
  function enterMarketFromiToken(address _market, address _account) external;

  /**
   * @notice Add markets to `msg.sender`'s markets list for liquidity calculations
     * @param _iTokens The list of addresses of the iToken markets to be entered
     * @return _results Success indicator for whether each corresponding market was entered
     */
  function enterMarkets(address[] memory _iTokens) external returns (bool[] memory _results);

  /**
   * @notice Remove markets from `msg.sender`'s collaterals for liquidity calculations
     * @param _iTokens The list of addresses of the iToken to exit
     * @return _results Success indicators for whether each corresponding market was exited
     */
  function exitMarkets(address[] memory _iTokens) external returns (bool[] memory _results);

  /**
   * @notice Return all of the iTokens
     * @return _alliTokens The list of iToken addresses
     */
  function getAlliTokens() external view returns (address[] memory _alliTokens);

  /**
 * @notice Returns the asset list the account has borrowed
     * @param _account The address of the account to query
     * @return _borrowedAssets The asset list the account has borrowed
     */
  function getBorrowedAssets(address _account) external view returns (address[] memory _borrowedAssets);

  /**
 * @notice Returns the markets list the account has entered
     * @param _account The address of the account to query
     * @return _accountCollaterals The markets list the account has entered
     */
  function getEnteredMarkets(address _account) external view returns (address[] memory _accountCollaterals);

  /**
   * @notice Returns whether the given account has borrowed the given iToken
     * @param _account The address of the account to check
     * @param _iToken The iToken to check against
     * @return True if the account has borrowed the iToken, otherwise false.
     */
  function hasBorrowed(address _account, address _iToken) external view returns (bool);

  /**
 * @notice Returns whether the given account has entered the market
     * @param _account The address of the account to check
     * @param _iToken The iToken to check against
     * @return True if the account has entered the market, otherwise false.
     */
  function hasEnteredMarket(address _account, address _iToken) external view returns (bool);

  /**
 * @notice Check whether a iToken is listed in controller
     * @param _iToken The iToken to check for
     * @return true if the iToken is listed otherwise false
     */
  function hasiToken(address _iToken) external view returns (bool);
  function initialize() external;
  function isController() external view returns (bool);

  function liquidateCalculateSeizeTokens(
    address _iTokenBorrowed,
    address _iTokenCollateral,
    uint256 _actualRepayAmount
  ) external view returns (uint256 _seizedTokenCollateral);

  function liquidationIncentiveMantissa() external view returns (uint256);

  /// @notice Mapping of iTokens to corresponding markets
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

  /**
   * @notice Oracle to query the price of a given asset
     */
  function priceOracle() external view returns (address);
  function rewardDistributor() external view returns (address);

  function seizePaused() external view returns (bool);

  /// @notice whether global transfer is paused
  function transferPaused() external view returns (bool);
}
