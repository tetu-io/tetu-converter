// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../compound/CompoundLib.sol";
import "../../libs/AppDataTypes.sol";
import "../../integrations/tetu/ITetuLiquidator.sol";

library KeomLib {
  /// @notice For any assets
  uint constant public MIN_ALLOWED_AMOUNT_TO_LIQUIDATE = 1000;

  function initProtocolFeatures(CompoundLib.ProtocolFeatures memory dest) internal view {
    dest.compoundStorageVersion = CompoundLib.COMPOUND_STORAGE_CUSTOM;
    (dest.nativeToken, dest.cTokenNative) = getNativeTokens();
  }

  function getNativeTokens() internal view returns (address asset, address cToken) {
    if (_getChainID() == 1101) {
      // Polygon zkEVM
      return (0x4F9A0e7FD2Bf6067db6994CF12E4495Df938E6e9, address(0)); // WETH
    } else {
      // Polygon POS
      return (0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270, 0x7854D4Cfa7d0B877E399bcbDFfb49536d7A14fc7); // WMATIC, KEOM_MATIC
    }
  }

  function _getChainID() internal view returns (uint256) {
    uint256 id;
    assembly {
      id := chainid()
    }
    return id;
  }
}