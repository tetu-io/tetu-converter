// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;
import "../interfaces/ILendingDataTypes.sol";

contract BorrowManagerStorage is ILendingDataTypes {
  /// @notice Generator of unique ID of the lending platforms: 1, 2, 3..
  /// @dev UID of the last added platform
  uint public platformsCount;

  /// @notice List of all available platforms and corresponded decorators
  /// @dev Allow to change decorator address without changing any other mappings
  mapping(uint => LendingPlatform) public platforms;

  /// @notice pool to lending platform UID
  mapping(address => uint) public poolToPlatform;

  /// @notice SourceToken => TargetToken => [all suitable pools]
  /// @dev SourceToken is always less then TargetToken
  mapping(address => mapping (address => address[])) public poolsForAssets;

  /// @notice Check if triple (source token, target token, pool) is already registered in {allPools}
  mapping(address => mapping (address => mapping (address => bool))) public assignedPoolsForAssets;

  function poolsForAssetsLength(address token1, address token2) public view returns (uint) {
    return poolsForAssets[token1][token2].length;
  }
}