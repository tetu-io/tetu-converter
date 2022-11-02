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
import "hardhat/console.sol";

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
    console.log("Keeper.checker");
    IDebtMonitor debtMonitor = IDebtMonitor(IController(controller).debtMonitor());

    // IHealthKeeperCallback is implemented inside this class
    // but we access it through controller to be able to split checker and executor in unit tests
    IHealthKeeperCallback keeper = IHealthKeeperCallback(IController(controller).keeper());
    uint startIndex = keeper.nextIndexToCheck0();

    (
      uint nextIndexToCheck0,
      address[] memory outPoolAdapters,
      uint[] memory outAmountBorrowAsset,
      uint[] memory outAmountCollateralAsset
    ) = debtMonitor.checkHealth(
      startIndex,
      maxCountToCheck,
      maxCountToReturn
    );

    canExecOut = outPoolAdapters.length != 0 || nextIndexToCheck0 != startIndex;
    console.log("Keeper.checker canExecOut", canExecOut);
    console.log("Keeper.checker nextIndexToCheck0", nextIndexToCheck0);
    console.log("Keeper.checker startIndex", startIndex);
    console.log("Keeper instance is", address(this));

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
    console.log("Keeper.fixHealth", nextIndexToCheck0_, address(this));
    uint countPoolAdapters = poolAdapters_.length;
    require(
      countPoolAdapters == amountBorrowAsset_.length
      && countPoolAdapters == amountCollateralAsset_.length,
      AppErrors.WRONG_LENGTHS
    );

    console.log("nextIndexToCheck0 before=", nextIndexToCheck0);
    nextIndexToCheck0 = nextIndexToCheck0_;
    console.log("nextIndexToCheck0 after=", nextIndexToCheck0);

    if (countPoolAdapters > 0) {
      console.log("Keeper.fixHealth.countPoolAdapters", countPoolAdapters);
      IKeeperCallback keeperCallback = IKeeperCallback(IController(controller).tetuConverter());
      for (uint i = 0; i < countPoolAdapters; i = i.uncheckedInc()) {
        console.log("Keeper.fixHealth.call keeperCallback.requireRepay");
        keeperCallback.requireRepay(
          amountBorrowAsset_[i],
          amountCollateralAsset_[i],
          poolAdapters_[i]
        );
      }
    }

  }
}
