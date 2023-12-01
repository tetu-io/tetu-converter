// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../interfaces/IChangePriceForTests.sol";

/// @notice Replacement for the original Zerovix price oracle
contract ZerovixOracleMock is IChangePriceForTests {
  /// @notice cToken => price
  mapping(address => uint) public prices;

  /// @notice Take exist price of the asset and multiple it on (multiplier100_/100)
  function changePrice(address cToken_, uint multiplier100_) external {
    prices[cToken_] = multiplier100_ * prices[cToken_] / 100;
  }

  function setUnderlyingPrice(address mToken, uint256 underlyingPriceMantissa) external {
    prices[mToken] = underlyingPriceMantissa;
  }

  //region -------------------------------- Same set of functions as in the original Zerovix oracle
  function api3() external pure returns (address) {
    return address(0);
  }

  function api3Server() external pure returns (address) {
    return 0x3dEC619dc529363767dEe9E71d8dD1A5bc270D76;
    }

  function feeds(address) external pure returns (bytes32) {
    return 0;
  }

  function getUnderlyingPrice(address kToken) external view returns (uint256 price) {
    return prices[kToken];
  }

  function heartbeats(bytes32) external pure returns (uint256) {
    return 0;
  }

  function isPriceOracle() external pure returns (bool) {
    return true;
  }

  function kNative() external pure returns (address) {
    return 0xee1727f5074E747716637e1776B7F7C7133f16b1;
  }

  function owner() external pure returns (address) {
    return 0x7A10033Fb8F474F28C66caB7578F4aF9e6dAd37D;
  }

  function renounceOwnership() external pure {

  }

  function setHeartbeat(address kToken, uint256 heartbeat) external pure {
    kToken;
    heartbeat;
  }

  function setKNative(address _kNative) external pure {
    _kNative;
  }

  function setTokenId(address _kToken, bytes32 _tokenId, uint256 _heartbeat) external pure {
    _kToken;
    _tokenId;
    _heartbeat;
  }

  function transferOwnership(address newOwner) external pure {
    newOwner;
  }

  //endregion -------------------------------- Same set of functions as in the original Zerovix oracle
}

