// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface IComet {
  struct AssetInfo {
    uint8 offset;
    address asset;
    address priceFeed;
    uint64 scale;
    uint64 borrowCollateralFactor;
    uint64 liquidateCollateralFactor;
    uint64 liquidationFactor;
    uint128 supplyCap;
  }

  struct UserCollateral {
    uint128 balance;
    uint128 _reserved;
  }

  function baseTokenPriceFeed() external view returns (address);

  function numAssets() external view returns (uint8);

  function getAssetInfo(uint8 i) external view returns (AssetInfo memory);

  function getAssetInfoByAddress(address asset) external view returns (AssetInfo memory);

  function supply(address asset, uint amount) external;

  function withdraw(address asset, uint amount) external;

  function baseToken() external view returns (address);

  function balanceOf(address account) external view returns (uint);

  function totalSupply() external view returns (uint);

  function isSupplyPaused() external view returns (bool);

  function isWithdrawPaused() external view returns (bool);

  function getBorrowRate(uint utilization) external view returns (uint64);

  function getUtilization() external view returns (uint);

  function baseTrackingBorrowSpeed() external view returns (uint);

  function baseScale() external view returns (uint);

  function baseIndexScale() external view returns (uint);

  function totalBorrow() external view returns (uint);

  function baseBorrowMin() external view returns (uint);

  function pause(bool supplyPaused, bool transferPaused, bool withdrawPaused, bool absorbPaused, bool buyPaused) external;

  function pauseGuardian() external view returns (address);

  function userCollateral(address user, address asset) external view returns(UserCollateral memory);

  function borrowBalanceOf(address account) external view returns (uint);
}
