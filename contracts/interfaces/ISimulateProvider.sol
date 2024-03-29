// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Provider of simulate() function
interface ISimulateProvider {
  function simulate(
    address targetContract,
    bytes calldata calldataPayload
  ) external returns (bytes memory response);
}
