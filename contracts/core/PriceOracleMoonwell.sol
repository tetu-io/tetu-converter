// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../libs/AppErrors.sol";
import "../interfaces/IPriceOracle.sol";
import "../integrations/compound/ICompoundPriceOracle.sol";
import "../openzeppelin/IERC20Metadata.sol";

/// @notice Trivial implementation of a price oracle as a wrapper of Moonwell price oracle
///         Key difference: it returns prices with decimals 18
contract PriceOracleMoonwell is IPriceOracle {
  ICompoundPriceOracle public immutable priceOracle;

  constructor(address compoundPriceOracle) {
    require(compoundPriceOracle != address(0), AppErrors.ZERO_ADDRESS);
    priceOracle = ICompoundPriceOracle(compoundPriceOracle);
  }

  /// @notice Return asset price in USD, decimals 18
  function getAssetPrice(address asset) external view override returns (uint256) {
    // get mToken by asset
    address mToken;
    if (asset == 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) { // usdc
      mToken = 0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22; // mUsdc
    } else if (asset == 0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA) { // USDDbC
      mToken = 0x703843C3379b52F9FF486c9f5892218d2a065cC8; // mUSDDbC
    } else if (asset == 0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb) {
      mToken = 0x73b06D8d18De422E269645eaCe15400DE7462417; // mDAI
    } else if (asset == 0x4200000000000000000000000000000000000006) {
      mToken = 0x628ff693426583D9a7FB391E54366292F509D457; // mWETH
    }

    if (mToken != address(0)) {
      // Compound price oracle returns price with decimals (36 - assetDecimals), we need decimals 18
      try priceOracle.getUnderlyingPrice(mToken) returns (uint value) {
        return value * 10 ** IERC20Metadata(asset).decimals() / 1e18;
      } catch {}
    }

    return 0; // unknown asset or unknown price
  }
}
