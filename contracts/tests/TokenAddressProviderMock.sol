// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../interfaces/ITokenAddressProvider.sol";

contract TokenAddressProviderMock is ITokenAddressProvider {
  address public cToken1Value;
  address public cToken2Value;
  constructor (address cToken1_, address cToken2_) {
    cToken1Value = cToken1_;
    cToken2Value = cToken2_;
  }
  function getCTokenByUnderlying(address token1, address token2) external view override returns (
    address cToken1,
    address cToken2
  ) {
    token1;
    token2;
    return (cToken1Value, cToken2Value);
  }
}