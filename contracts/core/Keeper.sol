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

  uint constant public maxCountToCheck = 500;
  uint constant public maxCountToReturn = 1;

  /// @notice Result of previous calling of IDebtMonitor.checkHealth
  uint256 public override nextIndexToCheck0;
  address public controller;

  ///////////////////////////////////////////////////////////////////
  ///              Initialization and configuration
  ///////////////////////////////////////////////////////////////////
  constructor(
    address controller_,
    address payable ops_
  ) OpsReady(ops_) {
    require(controller_ != address(0), AppErrors.ZERO_ADDRESS);
    controller = controller_;
  }

  function setController(address controller_) external {
    require(msg.sender == IController(controller).governance(), AppErrors.GOVERNANCE_ONLY);
    controller = controller_;
  }

  ///////////////////////////////////////////////////////////////////
  ///              Read-only gelato-resolver
  ///////////////////////////////////////////////////////////////////

  function checker()
  external
  view
  override
  returns (
    bool canExecOut,
    bytes memory execPayloadOut
  ) {
    IDebtMonitor debtMonitor = IDebtMonitor(IController(controller).debtMonitor());
    IHealthKeeperCallback keeper = IHealthKeeperCallback(IController(controller).keeper());

    (
    uint nextIndexToCheck0,
    address[] memory outPoolAdapters,
    uint[] memory outAmountBorrowAsset,
    uint[] memory outAmountCollateralAsset
    ) = debtMonitor.checkHealth(
      keeper.nextIndexToCheck0(),
      maxCountToCheck,
      maxCountToReturn
    );

    canExecOut = !(outPoolAdapters.length == 0 && nextIndexToCheck0 == 0);
    execPayloadOut = abi.encodeWithSelector(
      IHealthKeeperCallback.fixHealth.selector,
      nextIndexToCheck0,
      outPoolAdapters,
      outAmountBorrowAsset,
      outAmountCollateralAsset
    );
  }

  ///////////////////////////////////////////////////////////////////
  ///            Executor to fix unhealthy pool adapters
  ///////////////////////////////////////////////////////////////////

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
      IKeeperCallback keeperCallback = IKeeperCallback(IController(controller).tetuConverter());
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
