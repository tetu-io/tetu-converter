// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "./Aave3PoolAdapterBase.sol";

/// @notice PoolAdapter for AAVE-v3-protocol that uses ordinal borrow mode (not E-mode)
contract Aave3PoolAdapter is Aave3PoolAdapterBase {

  /// @dev This adapter is for not-e-mode, so this function is empty
  function prepareToBorrow() internal override {
    //nothing to do
  }

}