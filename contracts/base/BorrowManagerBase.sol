// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../openzeppelin/Clones.sol";
import "../interfaces/IController.sol";
import "../interfaces/IBorrowManager.sol";
import "../interfaces/IPoolAdapter.sol";

/// @notice Maintain list of registered pool adapters
abstract contract BorrowManagerBase is IBorrowManager {
  using Clones for address;

  struct PoolAdapterInfo {
    /// @notice Pool of a lending platform, i.e. address of comptroller contract in Compound protocol
    address pool;
    /// @notice Address of the caller contract who borrows amounts using the pool adapter
    address user;
    /// @notice Token used as collateral (underline, not cToken)
    address collateralUnderline;
  }

  IController public immutable controller;

  /// @notice Complete list ever created pool adapters
  /// @dev pool => user => collateralUnderline => address of the pool adapter
  mapping (address => mapping(address => mapping(address => address))) public poolAdaptersAll;

  /// @notice Pool adapter address => details
  mapping (address => PoolAdapterInfo) public poolAdaptersByAddress;

  ///////////////////////////////////////////////////////
  ///         Constructor
  ///////////////////////////////////////////////////////
  constructor (address controller_) {
    require(controller_ != address(0), "zero controller");
    controller = IController(controller_);
  }


  ///////////////////////////////////////////////////////
  ///         Minimal proxy creation
  ///////////////////////////////////////////////////////

  /// @notice Register a pool adapter for (pool, user, collateral) if the adapter wasn't created before
  /// @param pool_ Pool of a lending platform, i.e. address of comptroller contract in Compound protocol
  /// @param user_ Address of the caller contract who borrows amounts using the pool adapter
  function registerPoolAdapter(address pool_, address user_, address collateralUnderline_) external override {
    if (poolAdaptersAll[pool_][user_][collateralUnderline_] == address(0) ) {
      address poolAdapterTemplateContract = _getTemplatePoolAdapter(pool_);
      require(poolAdapterTemplateContract != address(0), "template contract not found");

      // create an instance of the pool adapter using minimal proxy pattern, initialize newly created contract
      address poolAdapter = poolAdapterTemplateContract.clone();
      IPoolAdapter(poolAdapter).initialize(address(controller), pool_, user_, collateralUnderline_);

      // register newly created pool adapter in the list of the pool adapters forever
      poolAdaptersAll[pool_][user_][collateralUnderline_] = poolAdapter;
      poolAdaptersByAddress[poolAdapter] = PoolAdapterInfo({
        pool: pool_,
        user: user_,
        collateralUnderline: collateralUnderline_
      });
    }
  }

  ///////////////////////////////////////////////////////
  ///         Virtual functions
  ///////////////////////////////////////////////////////
  function _getTemplatePoolAdapter(address pool_) internal view virtual returns (address);

  ///////////////////////////////////////////////////////
  ///               View
  ///////////////////////////////////////////////////////
  /// @notice Get pool adapter or 0 if the pool adapter is not registered
  function getPoolAdapter(address pool_, address user_, address collateralUnderline_)
  external
  view
  override returns (address) {
    return poolAdaptersAll[pool_][user_][collateralUnderline_];
  }

  /// @notice return info about pool adapter {pa_}
  /// @dev Return pool == 0 if the pool adapter is not found
  function getInfo(address pa_)
  external
  view
  override returns (address pool, address user, address collateralUnderline) {
    PoolAdapterInfo memory pai = poolAdaptersByAddress[pa_];
    return (pai.pool, pai.user, pai.collateralUnderline);
  }
}