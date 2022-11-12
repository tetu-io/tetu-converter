// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "./Aave3PoolAdapterBase.sol";
import "../../integrations/aave3/Aave3ReserveConfiguration.sol";

/// @notice PoolAdapter for AAVE-v3-protocol that uses high efficiency borrow mode (E-mode)
/// @dev https://docs.aave.com/faq/aave-v3-features#high-efficiency-mode-e-mode
contract Aave3PoolAdapterEMode is Aave3PoolAdapterBase {
  using Aave3ReserveConfiguration for Aave3DataTypes.ReserveConfigurationMap;

  // todo maybe it doesn;t worth to create a dedicated inheritances? just use some variable on constructor
  /// @notice Enter to E-mode
  function prepareToBorrow() internal override {
    Aave3DataTypes.ReserveData memory d = _pool.getReserveData(borrowAsset);
    _pool.setUserEMode(uint8(d.configuration.getEModeCategory()));
  }

}
