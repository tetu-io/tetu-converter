// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../../protocols/compound/CompoundLib.sol";

contract CompoundLibFacade {
  function getPrice(ICompoundPriceOracle priceOracle, address token) external view returns (uint) {
    return CompoundLib.getPrice(priceOracle, token);
  }

  function getUnderlying(CompoundLib.ProtocolFeatures memory f_, address cToken) external view returns (address) {
    return CompoundLib.getUnderlying(f_, cToken);
  }
}