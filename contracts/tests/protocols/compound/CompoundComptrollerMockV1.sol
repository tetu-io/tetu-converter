// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../../integrations/compound/ICompoundComptrollerBase.sol";
import "../../utils/TestUtilsLib.sol";
import "./CompoundComptrollerMock.sol";
import "../../../integrations/compound/ICompoundComptrollerBaseV1.sol";

/// @notice Min common set of functions of Compound cTokens
/// required to implement platform and pool adapters
contract CompoundComptrollerMockV1 is CompoundComptrollerMock, ICompoundComptrollerBaseV1 {
  struct MarketInfo {
    bool isListed;
    uint256 collateralFactorMantissa;
  }
  mapping(address => MarketInfo) internal _markets;

  function setMarkets(address token, bool isListed, uint256 collateralFactorMantissa) external {
    _markets[token] = MarketInfo({isListed: isListed, collateralFactorMantissa: collateralFactorMantissa});
  }

  /// @return isListed represents whether the comptroller recognizes this cToken
  /// @return collateralFactorMantissa scaled by 1e18, is multiplied by a supply balance to determine how much value can be borrowed
  function markets(address token) external view returns (
    bool isListed,
    uint256 collateralFactorMantissa
  ) {
    MarketInfo memory marketInfo = _markets[token];
    return (marketInfo.isListed, marketInfo.collateralFactorMantissa);
  }
}