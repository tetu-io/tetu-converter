// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "./Aave3PoolAdapterBase.sol";

/// @notice PoolAdapter for AAVE-v3-protocol that uses ordinal borrow mode (not E-mode)
contract Aave3PoolAdapter
  // we use inheritance to split normal/E-mode
  // because all pool adapters are created using minimal proxy pattern
  // and there is no way to pass additional params to standard initialize function
  is Aave3PoolAdapterBase
{

  /// @dev This adapter is for not-e-mode, so this function is empty
  function prepareToBorrow() internal override {
    //nothing to do
  }

}