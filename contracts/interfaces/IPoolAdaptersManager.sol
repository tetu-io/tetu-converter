// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

/// @notice Manager of pool-adapters.
///         Pool adapter is an instance of an adapter of the lending platform
///         linked to one of platform's pools, address of user contract and collateral token.
///         Address of a pool adapter is a borrower of funds for AAVE, Compound and other lending protocols.
///         Pool adapters are created using minimal-proxy pattern, see
///         https://blog.openzeppelin.com/deep-dive-into-the-minimal-proxy-contract/
interface IPoolAdaptersManager {

  /// @notice Register a pool adapter for (pool, user, collateral) if the adapter wasn't created before
  /// @param user_ Address of the caller contract who requires access to the pool adapter
  /// @return Address of registered pool adapter
  function registerPoolAdapter(
    address converter_,
    address user_,
    address collateral_,
    address borrowToken_
  ) external returns (address);

  /// @notice Get pool adapter or 0 if the pool adapter is not registered
  function getPoolAdapter(
    address converter_,
    address user_,
    address collateral_,
    address borrowToken_
  ) external view returns (address);

  function isPoolAdapter(address poolAdapter_) external view returns (bool);

  /// @notice Notify borrow manager that the pool adapter with the given params is unhealthy and should be replaced
  /// @dev "Unhealthy" means that a liquidation happens. Borrow should be repaid or fixed in other way.
  function markAsUnhealthy(
    address converter_,
    address user_,
    address collateral_,
    address borrowToken_
  ) external;
}