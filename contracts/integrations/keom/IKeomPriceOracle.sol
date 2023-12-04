// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Restored from 0x828fb251167145F89cd479f9D71a5A762F23BF13, events were removed
interface IKeomPriceOracle {
  function admin() external view returns (address);

  function getFeed(address kToken) external view returns (address);

  function getUnderlyingPrice(address kToken) external view returns (uint256);

  function heartbeats(address) external view returns (uint256);

  function isPriceOracle() external view returns (bool);

  function kNative() external view returns (address);

  function setAdmin(address newAdmin) external;

  function setFeed(address kToken, address feed, uint256 heartbeat) external;

  function setHeartbeat(address kToken, uint256 heartbeat) external;

  function setKNative(address _cNative) external;

  function setUnderlyingPrice(address kToken, uint256 underlyingPriceMantissa, uint256 updatedAt) external;

  function setValidPeriod(uint256 period) external;

  function validPeriod() external view returns (uint256);
}
