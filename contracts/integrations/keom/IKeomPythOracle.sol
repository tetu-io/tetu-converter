// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Restored from 0x828fb251167145F89cd479f9D71a5A762F23BF13, events were removed
interface IKeomPythOracle {
  function owner() external view returns (address);

  function getUnderlyingPrice(address kToken) external view returns (uint256);

  function setHeartbeat(address kToken, uint256 heartbeat) external;

  function setKNative(address _cNative) external;

  function heartbeats(address) external view returns (uint256);

  function kNative() external view returns (address);

  function pyth() external view returns (address);
}
