// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "./Aave3PoolAdapterBase.sol";
import "../../../integrations/aave/ReserveConfiguration.sol";

/// @notice PoolAdapter for AAVE-protocol that uses high efficiency borrow mode (E-mode)
/// @dev https://docs.aave.com/faq/aave-v3-features#high-efficiency-mode-e-mode
contract Aave3PoolAdapterEMode is Aave3PoolAdapterBase {
  using ReserveConfiguration for DataTypes.ReserveConfigurationMap;

  /// @notice Enter to E-mode
  function prepareToBorrow() internal override {
    DataTypes.ReserveData memory d = _pool.getReserveData(borrowAsset);
    _pool.setUserEMode(uint8(d.configuration.getEModeCategory()));
  }

}