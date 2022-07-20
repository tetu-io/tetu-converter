// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

/// @notice Manager of pool-adapters.
///         Pool adapter is an instance of an adapter of the lending platform
///         linked to one of platform's pools, address of user contract and collateral token.
///         Address of a pool adapter is a borrower of funds for AAVE, Compound and other lending protocols.
///         Pool adapters are created using minimal-proxy pattern, see
///         https://blog.openzeppelin.com/deep-dive-into-the-minimal-proxy-contract/
interface IPoolAdaptersManager {

  /// @notice return info about pool adapter {pa_}
  /// @dev Return pool == 0 if the pool adapter is not found
  function getInfo(address pa_) external view returns (address pool, address user, address collateralUnderline);

  /// @notice Register a pool adapter for (pool, user, collateral) if the adapter wasn't created before
  /// @param pool_ Pool of a lending platform, i.e. address of comptroller contract in Compound protocol
  /// @param user_ Address of the caller contract who requires access to the pool adapter
  function registerPoolAdapter(address pool_, address user_, address collateralUnderline_) external;

  /// @notice Get pool adapter or 0 if the pool adapter is not registered
  function getPoolAdapter(address pool_, address user_, address collateralUnderline_) external view returns (address);
}