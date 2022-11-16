// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../integrations/gelato/OpsReady.sol";
import "../interfaces/IHealthKeeperCallback.sol";
import "../core/AppErrors.sol";
import "../core/AppUtils.sol";
import "../integrations/gelato/IResolver.sol";
import "../interfaces/IController.sol";
import "../interfaces/IDebtsMonitor.sol";
import "../interfaces/IKeeperCallback.sol";

/// @notice Executor + Resolver for Gelato
///         to check health of opened positions and call requireRepay for unhealthy pool adapters
contract Keeper is OpsReady, IHealthKeeperCallback, IResolver {
  using AppUtils for uint;

  /// @notice Max count of opened positions to be checked in single request
  uint constant public maxCountToCheck = 500;

  /// @notice Max count of unhealthy positions to be returned in single request
  uint constant public maxCountToReturn = 1;

  /// @notice Start index of pool adapter for next checkHealth-request
  ///         We store here result of previous call of IDebtMonitor.checkHealth
  uint256 public override nextIndexToCheck0;
  IController immutable public controller;

  ///////////////////////////////////////////////////////////////////
  ///              Initialization and configuration
  ///////////////////////////////////////////////////////////////////
  constructor(
    address controller_,
    address payable ops_
  ) OpsReady(ops_) {
    require(controller_ != address(0), AppErrors.ZERO_ADDRESS);
    controller = IController(controller_);
  }

  ///////////////////////////////////////////////////////////////////
  ///              Read-only gelato-resolver
  ///////////////////////////////////////////////////////////////////

  /// @notice Check health of opened positions starting from nth-position, where n = nextIndexToCheck0
  /// @dev Read-only checker function called by Gelato.
  /// @return canExecOut True if it's necessary to call rebalancing write-function
  /// @return execPayloadOut Wrapped call of the rebalancing function (it will be called by Gelato)
  function checker()
  external
  view
  override
  returns (
    bool canExecOut,
    bytes memory execPayloadOut
  ) {
    IDebtMonitor debtMonitor = IDebtMonitor(controller.debtMonitor());

    // IHealthKeeperCallback is implemented inside this class
    // but we access it through controller to be able to split checker and executor in unit tests
    IHealthKeeperCallback keeper = IHealthKeeperCallback(controller.keeper());
    uint startIndex = keeper.nextIndexToCheck0();

    (
      uint newNextIndexToCheck0,
      address[] memory outPoolAdapters,
      uint[] memory outAmountBorrowAsset,
      uint[] memory outAmountCollateralAsset
    ) = debtMonitor.checkHealth(
      startIndex,
      maxCountToCheck,
      maxCountToReturn
    );

    canExecOut = outPoolAdapters.length != 0 || newNextIndexToCheck0 != startIndex;

    execPayloadOut = abi.encodeWithSelector(
      IHealthKeeperCallback.fixHealth.selector,
      newNextIndexToCheck0,
      outPoolAdapters,
      outAmountBorrowAsset,
      outAmountCollateralAsset
    );
  }

  ///////////////////////////////////////////////////////////////////
  ///            Executor to fix unhealthy pool adapters
  ///////////////////////////////////////////////////////////////////

  /// @notice Make rebalancing of the given unhealthy positions (a position == pool adapter)
  ///         Call TetuConverter.requireRepay for each position
  function fixHealth(
    uint nextIndexToCheck0_,
    address[] memory poolAdapters_,
    uint[] memory amountBorrowAsset_,
    uint[] memory amountCollateralAsset_
  ) external override onlyOps {
    uint countPoolAdapters = poolAdapters_.length;
    require(
      countPoolAdapters == amountBorrowAsset_.length
      && countPoolAdapters == amountCollateralAsset_.length,
      AppErrors.WRONG_LENGTHS
    );

    nextIndexToCheck0 = nextIndexToCheck0_;

    if (countPoolAdapters > 0) {
      IKeeperCallback keeperCallback = IKeeperCallback(controller.tetuConverter());
      for (uint i = 0; i < countPoolAdapters; i = i.uncheckedInc()) {
        keeperCallback.requireRepay(
          amountBorrowAsset_[i],
          amountCollateralAsset_[i],
          poolAdapters_[i]
        );
      }
    }

  }
}
