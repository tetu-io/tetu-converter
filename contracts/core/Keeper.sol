// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../libs/AppErrors.sol";
import "../libs/AppUtils.sol";
import "../interfaces/IHealthKeeperCallback.sol";
import "../interfaces/IConverterController.sol";
import "../interfaces/IDebtMonitor.sol";
import "../interfaces/IKeeperCallback.sol";
import "../integrations/gelato/IResolver.sol";
import "../openzeppelin/SafeERC20.sol";
import "../proxy/ControllableV3.sol";

/// @notice Executor + Resolver for Gelato
///         to check health of opened positions and call requireRepay for unhealthy pool adapters
///         Same keeper is also responsible for updating block-per-day value in controller.
contract Keeper is IHealthKeeperCallback, IResolver, ControllableV3 {
  using AppUtils for uint;

  //region ----------------------------------------------------- Constants
  string public constant KEEPER_VERSION = "1.0.1";
  address public constant ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

  /// @notice Max count of opened positions to be checked in single request
  uint constant public MAX_COUNT_TO_CHECK = 80;

  /// @notice Max count of unhealthy positions to be returned in single request
  uint constant public MAX_COUNT_TO_RETURN = 1;
  //endregion ----------------------------------------------------- Constants

  //region ----------------------------------------------------- Variables. Don't change names or ordering!
  /// @notice Deprecated, not used
  address public ops;
  /// @notice Deprecated, not used
  address payable public gelato;

  /// @notice Period of auto-update of the blocksPerDay-value in seconds
  ///         0 - auto-update checking is disabled
  uint public blocksPerDayAutoUpdatePeriodSec; // i.e. 2 * 7 * 24 * 60 * 60 for 2 weeks

  /// @notice Start index of pool adapter for next checkHealth-request
  ///         We store here result of previous call of IDebtMonitor.checkHealth
  uint256 public override nextIndexToCheck0;

  /// @notice Operators are able to run fixHealth
  mapping(address => bool) public operators;
  //endregion ----------------------------------------------------- Variables. Don't change names or ordering!

  //region ----------------------------------------------------- Events
  event OnFixHealth(uint nextIndexToCheck0, address[] poolAdapters, uint[] amountBorrowAsset, uint[] amountCollateralAsset);
  //endregion ----------------------------------------------------- Events

  //region ----------------------------------------------------- Initialization
  function init(address controller_, address payable ops_, uint blocksPerDayAutoUpdatePeriodSec_) external initializer {
    require(ops_ != address(0), AppErrors.ZERO_ADDRESS);

    __Controllable_init(controller_);
    ops = ops_;
    // gelato = IOps(ops_).gelato(); // gelato is not used anymore
    blocksPerDayAutoUpdatePeriodSec = blocksPerDayAutoUpdatePeriodSec_;
  }

  /// @notice Set period of auto-update of the blocksPerDay-value in seconds, 0 - auto-update checking is disabled
  function setBlocksPerDayAutoUpdatePeriodSecs(uint periodSeconds) external {
    require(IConverterController(controller()).governance() == msg.sender, AppErrors.GOVERNANCE_ONLY);

    blocksPerDayAutoUpdatePeriodSec = periodSeconds;
  }

  function changeOperatorStatus(address operator, bool status) external {
    require(IConverterController(controller()).governance() == msg.sender, AppErrors.GOVERNANCE_ONLY);
    operators[operator] = status;
  }
  //endregion ----------------------------------------------------- Initialization

  //region ----------------------------------------------------- Read-only gelato-resolver

  /// @notice Check health of opened positions starting from nth-position, where n = nextIndexToCheck0
  /// @dev Read-only checker function called by Gelato.
  /// @return canExecOut True if it's necessary to call rebalancing write-function
  /// @return execPayloadOut Wrapped call of the rebalancing function (it will be called by Gelato)
  function checker() external view override returns (
    bool canExecOut,
    bytes memory execPayloadOut
  ) {
    IConverterController _controller = IConverterController(controller());
    IDebtMonitor debtMonitor = IDebtMonitor(_controller.debtMonitor());

    // IHealthKeeperCallback is implemented inside this class
    // but we access it through controller to be able to split checker and executor in unit tests
    IHealthKeeperCallback keeper = IHealthKeeperCallback(_controller.keeper());
    uint startIndex = keeper.nextIndexToCheck0();

    (uint newNextIndexToCheck0,
      address[] memory outPoolAdapters,
      uint[] memory outAmountBorrowAsset,
      uint[] memory outAmountCollateralAsset
    ) = debtMonitor.checkHealth(startIndex, MAX_COUNT_TO_CHECK, MAX_COUNT_TO_RETURN);

    // it's necessary to run writable fixHealth() ...
    canExecOut =
      // ... if there is unhealthy pool adapter
      outPoolAdapters.length != 0

      // ... if we cannot check all adapters in one pass; we've checked a one portion, now we need to check the other portions
      || newNextIndexToCheck0 != startIndex

      /// ... if it's the time to recalculate blocksPerDay value
      || (blocksPerDayAutoUpdatePeriodSec != 0
        && _controller.isBlocksPerDayAutoUpdateRequired(blocksPerDayAutoUpdatePeriodSec)
      );

    execPayloadOut = abi.encodeWithSelector(
      IHealthKeeperCallback.fixHealth.selector,
      newNextIndexToCheck0,
      outPoolAdapters,
      outAmountBorrowAsset,
      outAmountCollateralAsset
    );
  }

  //endregion ----------------------------------------------------- Read-only gelato-resolver

  //region ----------------------------------------------------- Executor to fix unhealthy pool adapters

  /// @notice Make rebalancing of the given unhealthy positions (a position == pool adapter)
  ///         Call TetuConverter.requireRepay for each position
  function fixHealth(
    uint nextIndexToCheck0_,
    address[] calldata poolAdapters_,
    uint[] calldata amountBorrowAsset_,
    uint[] calldata amountCollateralAsset_
  ) external override {
    require(operators[msg.sender], AppErrors.GELATO_ONLY_OPS);

    IConverterController _controller = IConverterController(controller());

    uint len = poolAdapters_.length;
    require(len == amountBorrowAsset_.length && len == amountCollateralAsset_.length, AppErrors.WRONG_LENGTHS);

    if (nextIndexToCheck0 != nextIndexToCheck0_) {
      nextIndexToCheck0 = nextIndexToCheck0_;
    }

    if (len != 0) {
      IKeeperCallback keeperCallback = IKeeperCallback(_controller.tetuConverter());
      for (uint i = 0; i < len; i = i.uncheckedInc()) {
        keeperCallback.requireRepay(amountBorrowAsset_[i], amountCollateralAsset_[i], poolAdapters_[i]);
      }
    }

    uint period = blocksPerDayAutoUpdatePeriodSec;
    if (period != 0 && _controller.isBlocksPerDayAutoUpdateRequired(period)) {
      _controller.updateBlocksPerDay(period);
    }

    emit OnFixHealth(nextIndexToCheck0_, poolAdapters_, amountBorrowAsset_, amountCollateralAsset_);
  }

  //endregion ----------------------------------------------------- Executor to fix unhealthy pool adapters
}
