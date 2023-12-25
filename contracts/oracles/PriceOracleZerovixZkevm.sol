// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../libs/AppErrors.sol";
import "../interfaces/IPriceOracle.sol";
import "../integrations/compound/ICompoundPriceOracle.sol";
import "../openzeppelin/IERC20Metadata.sol";

/// @notice Trivial implementation of a price oracle as a wrapper of Zerovix price oracle
///         Key difference: it returns prices with decimals 18
contract PriceOracleZerovixZkevm is IPriceOracle {
  ICompoundPriceOracle public immutable priceOracle;

  constructor(address compoundPriceOracle) {
    require(compoundPriceOracle != address(0), AppErrors.ZERO_ADDRESS);
    priceOracle = ICompoundPriceOracle(compoundPriceOracle);
  }

  /// @notice Return asset price in USD, decimals 18
  function getAssetPrice(address asset) external view override returns (uint256) {
    // get oToken by asset
    address oToken;
    if (asset == 0xA8CE8aee21bC2A48a5EF670afCc9274C7bbbC035) { // usdc
      oToken = 0x68d9baA40394dA2e2c1ca05d30BF33F52823ee7B; // oUsdc
    } else if (asset == 0x1E4a5963aBFD975d8c9021ce480b42188849D41d) { // USDT
      oToken = 0xad41C77d99E282267C1492cdEFe528D7d5044253; // oUsdt
    } else if (asset == 0x4F9A0e7FD2Bf6067db6994CF12E4495Df938E6e9) { // WETH
      oToken = 0xbC59506A5Ce024B892776d4F7dd450B0FB3584A2; // oWeth
    } else if (asset == 0xa2036f0538221a77A3937F1379699f44945018d0) { // Matic
      oToken = 0x8903Dc1f4736D2FcB90C1497AebBABA133DaAC76; // oMatic
    } else if (asset == 0xEA034fb02eB1808C2cc3adbC15f447B93CbE08e1) { // WBTC
      oToken = 0x503deabad9641c5B4015041eEb0F1263E415715D; // oWBTC
    }

    if (oToken != address(0)) {
      // Compound price oracle returns price with decimals (36 - assetDecimals), we need decimals 18
      try priceOracle.getUnderlyingPrice(oToken) returns (uint value) {
        return value * 10 ** IERC20Metadata(asset).decimals() / 1e18;
      } catch {}
    }

    return 0; // unknown asset or unknown price
  }
}
