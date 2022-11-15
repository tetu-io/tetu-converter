// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "./Aave3PoolAdapterBase.sol";
import "../../integrations/aave3/Aave3ReserveConfiguration.sol";

/// @notice PoolAdapter for AAVE-v3-protocol that uses high efficiency borrow mode (E-mode)
/// @dev https://docs.aave.com/faq/aave-v3-features#high-efficiency-mode-e-mode
contract Aave3PoolAdapterEMode
  // we use inheritance to split normal/E-mode
  // because all pool adapters are created using minimal proxy pattern
  // and there is no way to pass additional params to standard initialize function
  is Aave3PoolAdapterBase
{

  using Aave3ReserveConfiguration for Aave3DataTypes.ReserveConfigurationMap;

  /// @notice Enter to E-mode
  function prepareToBorrow() internal override {
    Aave3DataTypes.ReserveData memory d = _pool.getReserveData(borrowAsset);
    _pool.setUserEMode(uint8(d.configuration.getEModeCategory()));
  }

}
