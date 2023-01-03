// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Restored from 0xcF427E1AC52A2D976B02B83F72BaeB905A92e488 (events and _xxx were removed)
/// @dev it's implementation of iDAI, 0xec85F77104Ffa35a5411750d70eDFf8f1496d95b
///      see https://developers.dforce.network/lend/lend-and-synth/deployed-contracts
interface IDForceCToken {

  /**
   * @dev Block number that interest was last accrued at.
     */
  function accrualBlockNumber() external view returns (uint256);
  function allowance(address, address) external view returns (uint256);
  function approve(address spender, uint256 amount) external returns (bool);
  function balanceOf(address) external view returns (uint256);
  function balanceOfUnderlying(address _account) external returns (uint256);

  /**
   * @dev Caller borrows tokens from the protocol to their own address.
     * @param _borrowAmount The amount of the underlying token to borrow.
     */
  function borrow(uint256 _borrowAmount) external;
  /**
   * @dev Gets the user's borrow balance with the latest `borrowIndex`.
     */
  function borrowBalanceCurrent(address _account) external returns (uint256);
  /**
   * @dev Gets the borrow balance of user without accruing interest.
     */
  function borrowBalanceStored(address _account) external view returns (uint256);
  /**
   * @dev The interest index for borrows of asset as of blockNumber.
     */
  function borrowIndex() external view returns (uint256);
  /**
   * @dev Returns the current per-block borrow interest rate.
     */
  function borrowRatePerBlock() external view returns (uint256);
  /**
   * @dev Gets user borrowing information.
   *      principal, interestIndex
   */
  function borrowSnapshot(address _account) external view returns (uint256 principal, uint256 interestIndex);
  function controller() external view returns (address);
  function decimals() external view returns (uint8);
  function decreaseAllowance(address spender, uint256 subtractedValue) external returns (bool);
  /**
   * @dev Gets the newest exchange rate by accruing interest.
   */
  function exchangeRateCurrent() external returns (uint256);
  /**
   * @dev Calculates the exchange rate without accruing interest.
   */
  function exchangeRateStored() external view returns (uint256);
  /**
   * @notice This ratio is relative to the total flashloan fee.
   * @dev Flash loan fee rate(scaled by 1e18).
   */
  function flashloanFeeRatio() external view returns (uint256);
  /**
   * @dev Get cash balance of this iToken in the underlying token.
   */
  function getCash() external view returns (uint256);
  function increaseAllowance(address spender, uint256 addedValue) external returns (bool);

  function initialize(
    address _underlyingToken,
    string memory _name,
    string memory _symbol,
    address _controller,
    address _interestRateModel
  ) external;

  /**
   * @dev Current interest rate model contract.
   */
  function interestRateModel() external view returns (address);
  /**
   * @dev Whether this token is supported in the market or not.
   */
  function isSupported() external view returns (bool);
  function isiToken() external pure returns (bool);

  function liquidateBorrow(
    address _borrower,
    uint256 _repayAmount,
    address _cTokenCollateral
  ) external;

  function mint(address _recipient, uint256 _mintAmount) external;
  function mintForSelfAndEnterMarket(uint256 _mintAmount) external;
  function name() external view returns (string memory);
  function nonces(address) external view returns (uint256);
  function owner() external view returns (address);
  function pendingOwner() external view returns (address);

  /// @dev EIP2612 permit function. For more details, please look at here:
  function permit(
    address _owner,
    address _spender,
    uint256 _value,
    uint256 _deadline,
    uint8 _v,
    bytes32 _r,
    bytes32 _s
  ) external;

  /**
   * @notice This ratio is relative to the total flashloan fee.
   * @dev Protocol fee rate when a flashloan happens(scaled by 1e18);
   */
  function protocolFeeRatio() external view returns (uint256);

  /**
   * @dev Caller redeems specified iToken from `_from` to get underlying token.
     * @param _from The account that would burn the iToken.
     * @param _redeemiToken The number of iToken to redeem.
     */
  function redeem(address _from, uint256 _redeemiToken) external;

  /**
   * @dev Caller redeems specified underlying from `_from` to get underlying token.
     * @param _from The account that would burn the iToken.
     * @param _redeemUnderlying The number of underlying to redeem.
     */
  function redeemUnderlying(address _from, uint256 _redeemUnderlying) external;

  /**
   * @dev Caller repays their own borrow.
     * @param _repayAmount The amount to repay.
     */
  function repayBorrow(uint256 _repayAmount) external;

  /**
   * @dev Caller repays a borrow belonging to borrower.
     * @param _borrower the account with the debt being payed off.
     * @param _repayAmount The amount to repay.
     */
  function repayBorrowBehalf(address _borrower, uint256 _repayAmount) external;

  /**
   * @dev Interest ratio set aside for reserves(scaled by 1e18).
     */
  function reserveRatio() external view returns (uint256);

  /**
   * @dev Transfers this tokens to the liquidator.
     * @param _liquidator The account receiving seized collateral.
     * @param _borrower The account having collateral seized.
     * @param _seizeTokens The number of iTokens to seize.
     */
  function seize(
    address _liquidator,
    address _borrower,
    uint256 _seizeTokens
  ) external;

  /**
   * @dev Returns the current per-block supply interest rate.
     *  Calculates the supply rate:
     *  underlying = totalSupply × exchangeRate
     *  borrowsPer = totalBorrows ÷ underlying
     *  supplyRate = borrowRate × (1-reserveFactor) × borrowsPer
     */
  function supplyRatePerBlock() external view returns (uint256);
  function symbol() external view returns (string memory);

  /**
   * @dev Total amount of this reserve borrowed.
     */
  function totalBorrows() external view returns (uint256);
  function totalBorrowsCurrent() external returns (uint256);

  /**
   * @dev Total amount of this reserves accrued.
     */
  function totalReserves() external view returns (uint256);
  function totalSupply() external view returns (uint256);
  function transfer(address _recipient, uint256 _amount) external returns (bool);

  function transferFrom(
    address _sender,
    address _recipient,
    uint256 _amount
  ) external returns (bool);

  function underlying() external view returns (address);

  /**
   * @notice Calculates interest and update total borrows and reserves.
   * @dev Updates total borrows and reserves with any accumulated interest.
   */
  function updateInterest() external returns (bool);
}
