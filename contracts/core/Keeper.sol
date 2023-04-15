// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../libs/AppErrors.sol";
import "../libs/AppUtils.sol";
import "../interfaces/IHealthKeeperCallback.sol";
import "../interfaces/IConverterController.sol";
import "../interfaces/IDebtMonitor.sol";
import "../interfaces/IKeeperCallback.sol";
import "../integrations/gelato/IResolver.sol";
import "../integrations/gelato/OpsReady.sol";

/// @notice Executor + Resolver for Gelato
///         to check health of opened positions and call requireRepay for unhealthy pool adapters
///         Same keeper is also responsible for updating block-per-day value in controller.
contract Keeper is OpsReady, IHealthKeeperCallback, IResolver {
  using AppUtils for uint;

  /// @notice Max count of opened positions to be checked in single request
  uint constant public maxCountToCheck = 500;

  /// @notice Max count of unhealthy positions to be returned in single request
  uint constant public maxCountToReturn = 1;

  /// @notice Period of auto-update of the blocksPerDay-value in seconds
  ///         0 - auto-update checking is disabled
  uint public blocksPerDayAutoUpdatePeriodSecs; // i.e. 2 * 7 * 24 * 60 * 60 for 2 weeks


  /// @notice Start index of pool adapter for next checkHealth-request
  ///         We store here result of previous call of IDebtMonitor.checkHealth
  uint256 public override nextIndexToCheck0;
  IConverterController immutable public controller;

  //-----------------------------------------------------
  //               Events
  //-----------------------------------------------------
  event OnFixHealth(uint nextIndexToCheck0, address[] poolAdapters, uint[] amountBorrowAsset, uint[] amountCollateralAsset);

  //-----------------------------------------------------
  //              Initialization and configuration
  //-----------------------------------------------------
  constructor(
    address controller_,
    address payable ops_,
    uint blocksPerDayAutoUpdatePeriodSecs_
  ) OpsReady(ops_) {
    require(controller_ != address(0), AppErrors.ZERO_ADDRESS);
    controller = IConverterController(controller_);
    blocksPerDayAutoUpdatePeriodSecs = blocksPerDayAutoUpdatePeriodSecs_;
  }

  //-----------------------------------------------------
  //              Read-only gelato-resolver
  //-----------------------------------------------------

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

    // it's necessary to run writable fixHealth() ...
    canExecOut =
      // ... if there is unhealthy pool adapter
      outPoolAdapters.length != 0

      // ... if we cannot check all adapters in one pass; we've checked a one portion, now we need to check the other portions
      || newNextIndexToCheck0 != startIndex

      /// ... if it's the time to recalculate blocksPerDay value
      || (blocksPerDayAutoUpdatePeriodSecs != 0
          && controller.isBlocksPerDayAutoUpdateRequired(blocksPerDayAutoUpdatePeriodSecs)
         );

    execPayloadOut = abi.encodeWithSelector(
      IHealthKeeperCallback.fixHealth.selector,
      newNextIndexToCheck0,
      outPoolAdapters,
      outAmountBorrowAsset,
      outAmountCollateralAsset
    );
  }

  //-----------------------------------------------------
  //            Executor to fix unhealthy pool adapters
  //-----------------------------------------------------

  /// @notice Make rebalancing of the given unhealthy positions (a position == pool adapter)
  ///         Call TetuConverter.requireRepay for each position
  function fixHealth(
    uint nextIndexToCheck0_,
    address[] calldata poolAdapters_,
    uint[] calldata amountBorrowAsset_,
    uint[] calldata amountCollateralAsset_
  ) external override onlyOps {
    uint countPoolAdapters = poolAdapters_.length;
    require(
      countPoolAdapters == amountBorrowAsset_.length
      && countPoolAdapters == amountCollateralAsset_.length,
      AppErrors.WRONG_LENGTHS
    );

    nextIndexToCheck0 = nextIndexToCheck0_;

    if (countPoolAdapters != 0) {
      IKeeperCallback keeperCallback = IKeeperCallback(controller.tetuConverter());
      for (uint i = 0; i < countPoolAdapters; i = i.uncheckedInc()) {
        keeperCallback.requireRepay(
          amountBorrowAsset_[i],
          amountCollateralAsset_[i],
          poolAdapters_[i]
        );
      }
    }

    if (blocksPerDayAutoUpdatePeriodSecs != 0
        && controller.isBlocksPerDayAutoUpdateRequired(blocksPerDayAutoUpdatePeriodSecs)
    ) {
      controller.updateBlocksPerDay(blocksPerDayAutoUpdatePeriodSecs);
    }

    emit OnFixHealth(
      nextIndexToCheck0_,
      poolAdapters_,
      amountBorrowAsset_,
      amountCollateralAsset_
    );
  }
}
