// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../interfaces/ITokenAddressProvider.sol";

contract TokenAddressProviderMock is ITokenAddressProvider {
  bool public explicitMode;
  address public cToken1Value;
  address public cToken2Value;

  /// @notice token => cToken
  mapping(address => address) internal _cTokensInExplicitMode;

  function initCTokens(address cToken1_, address cToken2_) external {
    cToken1Value = cToken1_;
    cToken2Value = cToken2_;
    explicitMode = false;
  }

  function initExplicit(address token1, address cToken1_, address token2, address cToken2_) external {
    _cTokensInExplicitMode[token1] = cToken1_;
    _cTokensInExplicitMode[token2] = cToken2_;
    explicitMode = true;
  }

  function getCTokenByUnderlying(address token1, address token2) external view override returns (
    address cToken1,
    address cToken2
  ) {
    if (explicitMode) {
      return (
        _cTokensInExplicitMode[token1],
        _cTokensInExplicitMode[token2]
      );
    } else {
      return (cToken1Value, cToken2Value);
    }
  }
}
