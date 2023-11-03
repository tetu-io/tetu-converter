// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

library TestUtilsLib {
  /// @notice Calculate unique key value for the given array of addresses
  function keccak256addresses(address[] memory items) internal pure returns (bytes32) {
    bytes memory sum;

    for (uint i = 0; i < items.length; i++) {
      sum = abi.encodePacked(sum, items[i]);
    }

    return keccak256(sum);
  }
}