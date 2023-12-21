// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../libs/AppErrors.sol";
import "../interfaces/IPriceOracle.sol";
import "../integrations/compound/ICompoundPriceOracle.sol";
import "../openzeppelin/IERC20Metadata.sol";
import "hardhat/console.sol";

/// @notice Trivial implementation of a price oracle as a wrapper of Keom price oracle on zkEVM.
///         Key difference: it returns prices with decimals 18
contract PriceOracleKeomZkevm is IPriceOracle {
  ICompoundPriceOracle public immutable priceOracle;

  constructor(address compoundPriceOracle) {
    require(compoundPriceOracle != address(0), AppErrors.ZERO_ADDRESS);
    priceOracle = ICompoundPriceOracle(compoundPriceOracle);
  }

  /// @notice Return asset price in USD, decimals 18
  function getAssetPrice(address asset) external view override returns (uint256) {
    // get kToken by asset
    address kToken;
    if (asset == 0xA8CE8aee21bC2A48a5EF670afCc9274C7bbbC035) { // usdc
      kToken = 0x68d9baA40394dA2e2c1ca05d30BF33F52823ee7B; // kUsdc
    } else if (asset == 0x1E4a5963aBFD975d8c9021ce480b42188849D41d) { // USDT
      kToken = 0xad41C77d99E282267C1492cdEFe528D7d5044253; // kUsdt
    } else if (asset == 0x4F9A0e7FD2Bf6067db6994CF12E4495Df938E6e9) { // WETH
      kToken = 0xee1727f5074E747716637e1776B7F7C7133f16b1; // kWeth
    } else if (asset == 0xa2036f0538221a77A3937F1379699f44945018d0) { // Matic
      kToken = 0x8903Dc1f4736D2FcB90C1497AebBABA133DaAC76; // kMatic
    }

    if (kToken != address(0)) {
      console.log("kToken", kToken);
      // Compound price oracle returns price with decimals (36 - assetDecimals), we need decimals 18
      try priceOracle.getUnderlyingPrice(kToken) returns (uint value) {
        return value * 10 ** IERC20Metadata(asset).decimals() / 1e18;
      } catch {
        console.log("error");
      }
    }

    return 0; // unknown asset or unknown price
  }
}
