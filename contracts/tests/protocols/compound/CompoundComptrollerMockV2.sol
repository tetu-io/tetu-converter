// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../../integrations/compound/ICompoundComptrollerBase.sol";
import "../../utils/TestUtilsLib.sol";
import "./CompoundComptrollerMock.sol";
import "../../../integrations/compound/ICompoundComptrollerBaseV2.sol";

/// @notice Min common set of functions of Compound cTokens
/// required to implement platform and pool adapters
contract CompoundComptrollerMockV2 is CompoundComptrollerMock, ICompoundComptrollerBaseV2 {
  struct MarketInfo {
    bool isListed;
    uint256 collateralFactorMantissa;
    bool isComped;
  }
  mapping(address => MarketInfo) internal _markets;

  function setMarkets(address token, bool isListed, uint256 collateralFactorMantissa, bool isComped) external {
    _markets[token] = MarketInfo({isListed: isListed, collateralFactorMantissa: collateralFactorMantissa, isComped: isComped});
  }

  /// @return isListed represents whether the comptroller recognizes this cToken
  /// @return collateralFactorMantissa scaled by 1e18, is multiplied by a supply balance to determine how much value can be borrowed
  function markets(address token) external view returns (
    bool isListed,
    uint256 collateralFactorMantissa,
    bool isComped
  ) {
    MarketInfo memory marketInfo = _markets[token];
    return (marketInfo.isListed, marketInfo.collateralFactorMantissa, marketInfo.isComped);
  }
}