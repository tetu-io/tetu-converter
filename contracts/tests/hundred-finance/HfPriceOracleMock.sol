// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;
import "hardhat/console.sol";

contract HfPriceOracleMock {
  mapping(address => uint) public prices;

  function setUnderlyingPrice(address cToken_, uint price_) external {
    console.log("HfPriceOracleMock.setUnderlyingPrice");
    prices[cToken_] = price_;
  }

  function ethUsdChainlinkAggregatorAddress() external pure returns (address) {
    return 0xF9680D99D6C9589e2a93a78A04A279e509205945;
  }

  /// @notice Indicator that this is a PriceOracle contract (for inspection)
  function isPriceOracle() external pure returns (bool) {
    return true;
  }

  function owner() external pure returns (address) {
    return 0xD0A27F0eBA2B407f2cCA8327b4Adb50BBAddFF24;
  }

  function getUnderlyingPrice(address cToken_) external view returns (uint256) {
    console.log("HfPriceOracleMock.getUnderlyingPrice", cToken_, prices[cToken_]);
    return prices[cToken_];
  }

  function renounceOwnership() external view {
    console.log("HfPriceOracleMock.renounceOwnership");
  }

  function setEthUsdChainlinkAggregatorAddress(address addr) external pure {
    addr;
  }

  function setTokenConfigs(
    address[] memory cTokenAddress,
    address[] memory chainlinkAggregatorAddress,
    uint256[] memory chainlinkPriceBase,
    uint256[] memory underlyingTokenDecimals
  ) external view {
    cTokenAddress;
    chainlinkAggregatorAddress;
    chainlinkPriceBase;
    underlyingTokenDecimals;
    console.log("HfPriceOracleMock.setTokenConfigs");
  }

  function tokenConfig(address) external view returns (
    address chainlinkAggregatorAddress,
    uint256 chainlinkPriceBase,
    uint256 underlyingTokenDecimals
  ) {
    console.log("HfPriceOracleMock.tokenConfig");
    return (chainlinkAggregatorAddress, chainlinkPriceBase, underlyingTokenDecimals);
  }

  function transferOwnership(address newOwner) external pure {
    newOwner;
  }
}

