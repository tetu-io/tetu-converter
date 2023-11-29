// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../integrations/compound/ICompoundPriceOracle.sol";
import "../../openzeppelin/IERC20Metadata.sol";
import "../../libs/AppErrors.sol";
import "../../libs/AppUtils.sol";
import "../../libs/AppDataTypes.sol";
import "../../integrations/compound/ICTokenBase.sol";
import "../../integrations/compound/ICompoundInterestRateModel.sol";
import "../../integrations/compound/ICompoundPriceOracle.sol";

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

  function getPrice(ICompoundPriceOracle priceOracle, address token) internal view returns (uint) {
    try priceOracle.getUnderlyingPrice(token) returns (uint value) {
      require(value != 0, AppErrors.ZERO_PRICE);
      return value;
    } catch {
      revert(AppErrors.ZERO_PRICE);
    }
  }

  function getUnderlying(CompoundLib.ProtocolFeatures memory f_, address cToken) internal view returns (address) {
    return cToken == f_.cTokenNative
      ? f_.nativeToken
      : ICTokenBase(cToken).underlying();
  }

}
