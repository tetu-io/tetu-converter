// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "./DataTypes.sol";
import "../interfaces/IBorrowManager.sol";
import "../interfaces/IPriceOracle.sol";

abstract contract BorrowManagerStorage is IBorrowManager {
  //TODO contract version

  /// @dev All input params for _findPool; 18 means that decimals 18 is used
  struct BorrowInput {
    address targetToken;
    uint96 healthFactor18;
    uint16 targetDecimals;
    uint sourceAmount18;
    uint targetAmount18;
    uint priceTarget18;
    uint priceSource18;
  }

  /// @notice Generator of unique ID of the lending platforms: 1, 2, 3..
  /// @dev UID of the last added platform
  uint public platformsCount;
  IPriceOracle public priceOracle;

  /// @notice List of all available platforms and corresponded decorators
  /// @dev Allow to change decorator address without changing any other mappings
  mapping(uint => DataTypes.LendingPlatform) public platforms;

  /// @notice pool to lending platform UID
  mapping(address => uint) public poolToPlatform;

  /// @notice SourceToken => TargetToken => [all suitable pools]
  /// @dev SourceToken is always less then TargetToken
  mapping(address => mapping (address => address[])) public poolsForAssets;

  /// @notice Check if triple (source token, target token, pool) is already registered in {allPools}
  mapping(address => mapping (address => mapping (address => bool))) public assignedPoolsForAssets;

  /// @notice Default health factors (HF) for assets. Default HF is used if user hasn't provided HF value, decimals 18
  /// @dev Health factor = collateral / minimum collateral. It should be greater then 1; 1 => liquidation.
  mapping(address => uint96) public defaultHealthFactors;

  function poolsForAssetsLength(address token1, address token2) public view returns (uint) {
    return poolsForAssets[token1][token2].length;
  }
}