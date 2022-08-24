// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

/// @notice Restored from 0xa89ebe8d7471d7d36acbfe4b0d086834390399b7 (optimism)
/// @dev See https://developers.dforce.network/lend/lend-and-synth/distribution
interface IDForceLendingData {
  function _acceptOwner() external;
  function _setPendingOwner(address newPendingOwner) external;
  function amounts(uint256) external view returns (uint256);
  function blocksPerYear() external view returns (uint256);

  function calcAccountEquity(address _account)
  external
  view
  returns (
    uint256,
    uint256,
    uint256,
    uint256
  );

  function canAccountRemoveFromCollateral(
    address _asset,
    address _account,
    uint256 _safeMaxFactor
  ) external returns (bool);

  function controller() external view returns (address);
  function decimals(uint256) external view returns (uint8);
  function getAccountAvailable(address _account) external view returns (bool);

  function getAccountBorrowData(
    address _asset,
    address _account,
    uint256 _safeMaxFactor
  )
  external
  returns (
    uint256,
    uint256,
    uint256,
    uint256,
    uint256,
    uint8
  );

  function getAccountBorrowInfo(
    address _asset,
    address _account,
    uint256 _safeMaxFactor
  ) external returns (
    uint256,
    uint256,
    uint256,
    bool
  );

  function getAccountBorrowStatus(address _account) external view returns (bool);
  function getAccountBorrowTokens(address _account) external returns (
    address[] memory,
    uint256[] memory,
    uint8[] memory
  );

  function getAccountBorrowValue(address _account) external returns (uint256 _borrowValue);

  function getAccountMSDTokens(address _account)
  external returns (
    address[] memory,
    uint256[] memory,
    uint8[] memory
  );

  function getAccountRewardAmount(address _account) external returns (uint256);

  function getAccountSupplyData(
    address _asset,
    address _account,
    uint256 _safeMaxFactor
  ) external returns (
    uint256,
    uint256,
    uint256,
    uint256,
    uint256,
    uint256,
    uint8
  );

  function getAccountSupplyInfo(
    address _asset,
    address _account,
    uint256 _safeMaxFactor
  ) external returns (
    uint256 _assetPrice,
    bool _asCollateral,
    bool _executed,
    bool _accountAvailable
  );

  function getAccountSupplyTokens(address _account)
  external returns (
    address[] memory,
    uint256[] memory,
    uint8[] memory
  );

  function getAccountTokens(address _account)
  external returns (
    address[] memory _supplyTokens,
    uint256[] memory _supplyAmounts,
    uint8[] memory _supplyDecimals,
    address[] memory _borrowTokens,
    uint256[] memory _borrowAmounts,
    uint8[] memory _borrowDecimals
  );

  function getAccountTotalValue(address _account)
  external returns (
    uint256,
    uint256,
    uint256,
    uint256
  );

  function getAssetUSDPrice(address _asset) external view returns (uint256);
  function getBalance(address _asset, address _account) external view returns (uint256);

  function getBorrowTokenData(address _asset)
  external
  view
  returns (
    uint256,
    uint256,
    uint256,
    uint256
  );

  function getLiquidationInfo(
    address _borrower,
    address _liquidator,
    address _assetBorrowed,
    address _assetCollateral
  ) external returns (
    uint256,
    uint256,
    uint256,
    bool
  );

  function getSupplyTokenData(address _asset)
  external view returns (
    uint256,
    uint256,
    uint256
  );

  function initialize(address _controller, address _priceToken) external;
  function owner() external view returns (address);
  function pendingOwner() external view returns (address);
  function priceToken() external view returns (address);
  function setController(address _newController) external;
  function setPriceToken(address _newAsset) external;
  function tokens(uint256) external view returns (address);
}
