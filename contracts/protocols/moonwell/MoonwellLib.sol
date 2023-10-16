// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../compound/CompoundLib.sol";

library MoonwellLib {
  function initProtocolFeatures(CompoundLib.ProtocolFeatures memory dest) internal pure {
    dest.nativeToken = 0x4200000000000000000000000000000000000006;
//    dest.cTokenNative = 0x628ff693426583D9a7FB391E54366292F509D457;
//    dest.nativeToken = address(0);
    dest.cTokenNative = address(0);
    dest.compoundStorageVersion = CompoundLib.COMPOUND_STORAGE_V1;
  }
}