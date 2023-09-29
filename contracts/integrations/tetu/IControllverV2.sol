// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

/// @notice Restored from TetuV2 controller implementation
///         impl: {0x128A0b5812828137a5098aF532199CD5e56C2691}, proxy: {0x33b27e0A2506a4A2FBc213a01C51d0451745343a}
interface IControllerV2 {
  event AddressAnnounceRemove(uint256 _type);
  event AddressChangeAnnounced(uint256 _type, address value);
  event AddressChanged(uint256 _type, address oldAddress, address newAddress);
  event ContractInitialized(address controller, uint256 ts, uint256 block);
  event Initialized(uint8 version);
  event OperatorAdded(address operator);
  event OperatorRemoved(address operator);
  event ProxyAnnounceRemoved(address proxy);
  event ProxyUpgradeAnnounced(address proxy, address implementation);
  event ProxyUpgraded(address proxy, address implementation);
  event RegisterVault(address vault);
  event RevisionIncreased(uint256 value, address oldLogic);
  event VaultRemoved(address vault);

  function CONTROLLABLE_VERSION() external view returns (string memory);

  function CONTROLLER_VERSION() external view returns (string memory);

  function TIME_LOCK() external view returns (uint256);

  function addressAnnouncesList()
  external
  view
  returns (ControllerV2.AddressAnnounce[] memory announces);

  function announceAddressChange(uint8 _type, address value) external;

  function announceProxyUpgrade(
    address[] memory proxies,
    address[] memory implementations
  ) external;

  function changeAddress(uint8 _type) external;

  function controller() external view returns (address);

  function created() external view returns (uint256);

  function createdBlock() external view returns (uint256);

  function forwarder() external view returns (address);

  function governance() external view returns (address);

  function increaseRevision(address oldLogic) external;

  function init(address _governance) external;

  function investFund() external view returns (address);

  function isController(address _value) external view returns (bool);

  function isGovernance(address _value) external view returns (bool);

  function isOperator(address value) external view returns (bool);

  function isValidVault(address _vault) external view returns (bool);

  function liquidator() external view returns (address);

  function operatorsList() external view returns (address[] memory);

  function platformVoter() external view returns (address);

  function previousImplementation() external view returns (address);

  function proxyAnnounces(address) external view returns (address);

  function proxyAnnouncesList()
  external
  view
  returns (ControllerV2.ProxyAnnounce[] memory announces);

  function registerOperator(address value) external;

  function registerVault(address vault) external;

  function removeAddressAnnounce(uint8 _type) external;

  function removeOperator(address value) external;

  function removeProxyAnnounce(address proxy) external;

  function removeVault(address vault) external;

  function revision() external view returns (uint256);

  function supportsInterface(bytes4 interfaceId) external view returns (bool);

  function upgradeProxy(address[] memory proxies) external;

  function vaults(uint256 id) external view returns (address);

  function vaultsList() external view returns (address[] memory);

  function vaultsListLength() external view returns (uint256);

  function veDistributor() external view returns (address);

  function voter() external view returns (address);
}

interface ControllerV2 {
  struct AddressAnnounce {
    uint256 _type;
    address newAddress;
    uint256 timeLockAt;
  }

  struct ProxyAnnounce {
    address proxy;
    address implementation;
    uint256 timeLockAt;
  }
}
