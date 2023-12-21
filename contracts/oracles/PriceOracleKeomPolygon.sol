// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../libs/AppErrors.sol";
import "../interfaces/IPriceOracle.sol";
import "../integrations/compound/ICompoundPriceOracle.sol";
import "../openzeppelin/IERC20Metadata.sol";

/// @notice Trivial implementation of a price oracle as a wrapper of Keom price oracle on Polygon.
///         Key difference: it returns prices with decimals 18
contract PriceOracleKeomPolygon is IPriceOracle {
  ICompoundPriceOracle public immutable priceOracle;

  constructor(address compoundPriceOracle) {
    require(compoundPriceOracle != address(0), AppErrors.ZERO_ADDRESS);
    priceOracle = ICompoundPriceOracle(compoundPriceOracle);
  }

  /// @notice Return asset price in USD, decimals 18
  function getAssetPrice(address asset) external view override returns (uint256) {
    // get kToken by asset
    address kToken;
    if (asset == 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174) { // usdc
      kToken = 0xF5EcA026809785165Ad468171cE10E1DA59CA866; // kUsdc
    } else if (asset == 0xc2132D05D31c914a87C6611C10748AEb04B58e8F) { // USDT
      kToken = 0xce71F99c6B09ba50AEA18F8132D674dC57fe0839; // kUsdt
    } else if (asset == 0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619) { // WETH
      kToken = 0x44010CBf1EC8B8D8275d86D8e28278C06DD07C48; // kWeth
    } else if (asset == 0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270) { // Matic
      kToken = 0x7854D4Cfa7d0B877E399bcbDFfb49536d7A14fc7; // kMatic
    } else if (asset == 0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6) { // WBTC
      kToken = 0x4e7d313918B9A8c32f18BC1Df346c79E36D0f9DC; // kWBTC
    } else if (asset == 0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063) { // DAI
      kToken = 0x83f98471F6F5D0ad82b0FE99d2Ce26F65995Ef32; //kDAI
    } else if (asset == 0xa3Fa99A148fA48D14Ed51d610c367C61876997F1) { // miMatic
      kToken = 0x0edc2B1239D3d4ad03A2deB23517A50A406eB6D2; //kDAI
    } else if (asset == 0xfa68FB4628DFF1028CFEc22b4162FCcd0d45efb6) { // MaticX
      kToken = 0x6b4c8e36Cec677D68cfbAbA375230F959199A673; //kstMaticX
    } else if (asset == 0x3A58a54C066FdC0f2D55FC9C89F0415C92eBf3C4) { // stMatic
      kToken = 0x4bc6E73B215B7F1dDfcE83B887525f72a53e1ED8; //kstMatic
    } else if (asset == 0x03b54A6e9a984069379fae1a4fC4dBAE93B3bCCD) { // wstETH
      kToken = 0x0e9f5E4e8ec73E909830B67E3E61b5DB70E3b2E9; //kwstETH
    }

    if (kToken != address(0)) {
      // Compound price oracle returns price with decimals (36 - assetDecimals), we need decimals 18
      try priceOracle.getUnderlyingPrice(kToken) returns (uint value) {
        return value * 10 ** IERC20Metadata(asset).decimals() / 1e18;
      } catch {}
    }

    return 0; // unknown asset or unknown price
  }
}
