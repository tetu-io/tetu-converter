// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../compound/CompoundLib.sol";
import "../../libs/AppDataTypes.sol";
import "../../integrations/tetu/ITetuLiquidator.sol";

library ZerovixLib {
  /// @notice For any assets
  uint constant public MIN_ALLOWED_AMOUNT_TO_LIQUIDATE = 1000;

  function initProtocolFeatures(CompoundLib.ProtocolFeatures memory dest) internal view {
    if (_getChainID() == 1101) {
      // Polygon zkEVM
      dest.nativeToken = 0x4F9A0e7FD2Bf6067db6994CF12E4495Df938E6e9; // WETH
    } else {
      // Polygon POS
      dest.nativeToken = 0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270; // WMATIC
    }
    dest.cTokenNative = address(0);
    dest.compoundStorageVersion = CompoundLib.COMPOUND_STORAGE_CUSTOM;
  }

  function _getChainID() internal view returns (uint256) {
    uint256 id;
    assembly {
      id := chainid()
    }
    return id;
  }
}