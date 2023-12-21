// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Restored from zkevm.0x65D53619b2BbBb69f8F895Be08758e796952101f, events were removed
interface IZerovixPriceOracle {
  function api3() external view returns (address);

  function api3Server() external view returns (address);

  function feeds(address) external view returns (bytes32);

  function getUnderlyingPrice(address kToken) external view returns (uint256 price);

  function heartbeats(bytes32) external view returns (uint256);

  function isPriceOracle() external view returns (bool);

  function kNative() external view returns (address);

  function owner() external view returns (address);

  function renounceOwnership() external;

  function setHeartbeat(address kToken, uint256 heartbeat) external;

  function setKNative(address _kNative) external;

  function setTokenId(address _kToken, bytes32 _tokenId, uint256 _heartbeat) external;

  function transferOwnership(address newOwner) external;
}