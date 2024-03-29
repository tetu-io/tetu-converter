// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "../interfaces/IControllable.sol";
import "../interfaces/IProxyControlled.sol";
import "../interfaces/IConverterControllable.sol";
import "./UpgradeableProxy.sol";

/// @title EIP1967 Upgradable proxy implementation.
/// @dev Only Controller has access and should implement time-lock for upgrade action.
/// @author belbix
contract ProxyControlled is UpgradeableProxy, IProxyControlled {

  /// @notice Version of the contract
  /// @dev Should be incremented when contract changed
  string public constant PROXY_CONTROLLED_VERSION = "1.0.0";

  /// @dev Initialize proxy implementation. Need to call after deploy new proxy.
  function initProxy(address _logic) external override {
    //make sure that given logic is controllable and not inited
    require(IConverterControllable(_logic).created() >= 0, "Proxy: Wrong implementation");
    _init(_logic);
  }

  /// @notice Upgrade contract logic
  /// @dev Upgrade allowed only for Controller of tetu-contracts-v2 and should be done only after time-lock period
  /// @param _newImplementation Implementation address
  function upgrade(address _newImplementation) external override {
    require(IConverterControllable(address(this)).isProxyUpdater(msg.sender), "Proxy: Forbidden");
    IConverterControllable(address(this)).increaseRevision(_implementation());
    _upgradeTo(_newImplementation);
    // the new contract must have the same ABI and you must have the power to change it again
    require(IConverterControllable(address(this)).isProxyUpdater(msg.sender), "Proxy: Wrong implementation");
  }

  /// @notice Return current logic implementation
  function implementation() external override view returns (address) {
    return _implementation();
  }
}
