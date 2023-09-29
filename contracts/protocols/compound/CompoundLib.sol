// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

library CompoundLib {

  /// @notice Protocol uses ComptrollerStorage, so comptroller supports ICompoundComptrollerBaseV1
  uint constant public COMPOUND_STORAGE_V1 = 1;

  /// @notice Protocol uses ComptrollerV2Storage, so comptroller supports ICompoundComptrollerBaseV2
  uint constant public COMPOUND_STORAGE_V2 = 2;

  struct ProtocolFeatures {
    /// @param Address of native token for the current chain, i.e. WMATIC on Polygon or WETH9 on Base
    address nativeToken;

    /// @param Address of cToken for the native token, i.e. hMATIC on Polygon or mWETH on Base
    address cTokenNative;

    /// @notice What version of interface ICompoundComptrollerBaseVXXX the comptroller supports.
    uint compoundStorageVersion;
  }
}
