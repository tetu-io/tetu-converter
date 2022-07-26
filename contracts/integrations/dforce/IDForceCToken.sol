// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

/// @notice Restored from 0xcF427E1AC52A2D976B02B83F72BaeB905A92e488 (events and _xxx were removed)
/// @dev it's implementation of iDAI, 0xec85F77104Ffa35a5411750d70eDFf8f1496d95b
///      see https://developers.dforce.network/lend/lend-and-synth/deployed-contracts
interface IDForceCToken {

  function accrualBlockNumber() external view returns (uint256);
  function allowance(address, address) external view returns (uint256);
  function approve(address spender, uint256 amount) external returns (bool);
  function balanceOf(address) external view returns (uint256);
  function balanceOfUnderlying(address _account) external returns (uint256);
  function borrow(uint256 _borrowAmount) external;
  function borrowBalanceCurrent(address _account) external returns (uint256);
  function borrowBalanceStored(address _account) external view returns (uint256);
  function borrowIndex() external view returns (uint256);
  function borrowRatePerBlock() external view returns (uint256);
  function borrowSnapshot(address _account) external view returns (uint256, uint256);
  function controller() external view returns (address);
  function decimals() external view returns (uint8);
  function decreaseAllowance(address spender, uint256 subtractedValue) external returns (bool);
  function exchangeRateCurrent() external returns (uint256);
  function exchangeRateStored() external view returns (uint256);
  function flashloanFeeRatio() external view returns (uint256);
  function getCash() external view returns (uint256);
  function increaseAllowance(address spender, uint256 addedValue) external returns (bool);

  function initialize(
    address _underlyingToken,
    string memory _name,
    string memory _symbol,
    address _controller,
    address _interestRateModel
  ) external;

  function interestRateModel() external view returns (address);
  function isSupported() external view returns (bool);
  function isiToken() external pure returns (bool);

  function liquidateBorrow(
    address _borrower,
    uint256 _repayAmount,
    address _assetCollateral
  ) external;

  function mint(address _recipient, uint256 _mintAmount) external;
  function mintForSelfAndEnterMarket(uint256 _mintAmount) external;
  function name() external view returns (string memory);
  function nonces(address) external view returns (uint256);
  function owner() external view returns (address);
  function pendingOwner() external view returns (address);

  function permit(
    address _owner,
    address _spender,
    uint256 _value,
    uint256 _deadline,
    uint8 _v,
    bytes32 _r,
    bytes32 _s
  ) external;

  function protocolFeeRatio() external view returns (uint256);
  function redeem(address _from, uint256 _redeemiToken) external;
  function redeemUnderlying(address _from, uint256 _redeemUnderlying) external;
  function repayBorrow(uint256 _repayAmount) external;
  function repayBorrowBehalf(address _borrower, uint256 _repayAmount) external;
  function reserveRatio() external view returns (uint256);

  function seize(
    address _liquidator,
    address _borrower,
    uint256 _seizeTokens
  ) external;

  function supplyRatePerBlock() external view returns (uint256);
  function symbol() external view returns (string memory);
  function totalBorrows() external view returns (uint256);
  function totalBorrowsCurrent() external returns (uint256);
  function totalReserves() external view returns (uint256);
  function totalSupply() external view returns (uint256);
  function transfer(address _recipient, uint256 _amount) external returns (bool);

  function transferFrom(
    address _sender,
    address _recipient,
    uint256 _amount
  ) external returns (bool);

  function underlying() external view returns (address);
  function updateInterest() external returns (bool);
}
