// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../interfaces/IChangePriceForTests.sol";
import "../../../libs/AppUtils.sol";

/// @notice Replacement for the original Keom price oracle
contract KeomOracleMock is IChangePriceForTests {
  /// @notice cToken => price
  mapping(address => uint) public prices;

  /// @notice Take exist price of the asset and multiple it on (multiplier100_/100)
  function changePrice(address cToken_, uint multiplier100_) external {
    prices[cToken_] = multiplier100_ * prices[cToken_] / 100;
  }

  function _setUnderlyingPrice(address mToken, uint256 underlyingPriceMantissa) external {
    prices[mToken] = underlyingPriceMantissa;
  }

  //region -------------------------------- Same set of functions as in the original Zerovix oracle
  function admin() external view returns (address) {
    if (AppUtils.getChainID() == 1101) {
      return address(0); // todo zkevm
    } else {
      return 0x7A10033Fb8F474F28C66caB7578F4aF9e6dAd37D; // polygon
    }
  }

  function getFeed(address kToken) external pure returns (address) {
    kToken;
    return address(0);
  }

  function getUnderlyingPrice(address kToken) external view returns (uint256) {
    return prices[kToken];
  }

  function heartbeats(address) external pure returns (uint256) {
    return 1e18;
  }

  function isPriceOracle() external pure returns (bool) {
    return true;
  }

  function kNative() external view returns (address) {
    if (AppUtils.getChainID() == 1101) {
      return address(0); // todo KEOM_WETH
    } else {
      return 0x7854D4Cfa7d0B877E399bcbDFfb49536d7A14fc7; // KEOM MATIC
    }
  }

  function setAdmin(address newAdmin) external pure {
    newAdmin;
  }

  function setFeed(address kToken, address feed, uint256 heartbeat) external pure {
    kToken;
    feed;
    heartbeat;
  }

  function setHeartbeat(address kToken, uint256 heartbeat) external pure {
    kToken;
    heartbeat;
  }

  function setKNative(address _cNative) external pure {
    _cNative;
  }

  function setUnderlyingPrice(address kToken, uint256 underlyingPriceMantissa, uint256 updatedAt) external {
    prices[kToken] = underlyingPriceMantissa;
    updatedAt;
  }

  function setValidPeriod(uint256 period) external pure {
    period;
  }

  function validPeriod() external pure returns (uint256) {
    return 1e18;
  }
  //endregion -------------------------------- Same set of functions as in the original Zerovix oracle
}

