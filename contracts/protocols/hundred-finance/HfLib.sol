// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../compound/CompoundLib.sol";
import "../../libs/AppDataTypes.sol";
import "../../integrations/tetu/ITetuLiquidator.sol";

library HfLib {
  /// @notice For any assets
  uint constant public MIN_ALLOWED_AMOUNT_TO_LIQUIDATE = 1000;

  function initProtocolFeatures(CompoundLib.ProtocolFeatures memory dest) internal pure {
    dest.nativeToken = 0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270;
    dest.cTokenNative = 0xEbd7f3349AbA8bB15b897e03D6c1a4Ba95B55e31;
    dest.compoundStorageVersion = CompoundLib.COMPOUND_STORAGE_V2;
  }
}