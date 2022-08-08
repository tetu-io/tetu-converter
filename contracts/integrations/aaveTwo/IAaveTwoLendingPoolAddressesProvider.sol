// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

/// @notice Restored from 0xd05e3e715d945b59290df0ae8ef85c1bdb684744 (events were removed)
interface IAaveTwoLendingPoolAddressesProvider {
  function getAddress(bytes32 id) external view returns (address);
  function getEmergencyAdmin() external view returns (address);
  function getLendingPool() external view returns (address);
  function getLendingPoolCollateralManager() external view returns (address);
  function getLendingPoolConfigurator() external view returns (address);
  function getLendingRateOracle() external view returns (address);
  function getMarketId() external view returns (string memory);
  function getPoolAdmin() external view returns (address);
  function getPriceOracle() external view returns (address);
  function owner() external view returns (address);
  function renounceOwnership() external;
  function setAddress(bytes32 id, address newAddress) external;
  function setAddressAsProxy(bytes32 id, address implementationAddress) external;
  function setEmergencyAdmin(address emergencyAdmin) external;
  function setLendingPoolCollateralManager(address manager) external;
  function setLendingPoolConfiguratorImpl(address configurator) external;
  function setLendingPoolImpl(address pool) external;
  function setLendingRateOracle(address lendingRateOracle) external;
  function setMarketId(string memory marketId) external;
  function setPoolAdmin(address admin) external;
  function setPriceOracle(address priceOracle) external;
  function transferOwnership(address newOwner) external;
}
