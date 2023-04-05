// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../libs/AppErrors.sol";
import "../openzeppelin/Initializable.sol";
import "../interfaces/IConverterController.sol";

/// @notice Keep and provide addresses of all application contracts
contract ConverterController is IConverterController, Initializable {

  //-----------------------------------------------------
  //        Constants and immutable vars
  //-----------------------------------------------------
  uint16 constant MIN_ALLOWED_MIN_HEALTH_FACTOR = 100;
  uint constant DEBT_GAP_DENOMINATOR = 100_000;

  /// @notice Allow to swap assets
  address public immutable override tetuLiquidator;
  /// @notice Price oracle, required by SwapManager
  address public immutable override priceOracle;

  //-----------------------------------------------------
  //               Variables
  //   We cannot use immutable variables for the below contracts,
  //   because each contract requires address of the controller as a parameter of the constructor
  //-----------------------------------------------------

  /// @notice Main application contract, strategy works only with it
  address public override tetuConverter;

  /// @notice Contains list of lending pools. Allow to select most efficient pool for the given collateral/borrow pair
  address public override borrowManager;

  /// @notice Contains list of opened borrows, check healths of the borrows
  address public override debtMonitor;

  /// @notice A keeper to control health of the borrows
  address public override keeper;

  /// @notice Wrapper around tetu-liquidator
  address public override swapManager;

  /// @notice Current governance. It can be changed by offer/accept scheme
  address public override governance;
  /// @notice New governance suggested by exist governance
  address public pendingGovernance;

  /// @notice Min allowed health factor = collateral / min allowed collateral, decimals 2
  ///         If a health factor is below given value, we need to repay a part of borrow back
  /// @dev Health factor < 1 produces liquidation immediately
  uint16 public override minHealthFactor2;

  /// @notice target health factor with decimals 2
  /// @dev If the health factor is below/above min/max threshold, we need to make repay
  ///      or additional borrow and restore the health factor to the given target value
  uint16 public override targetHealthFactor2;

  /// @notice max allowed health factor with decimals 2
  /// @dev If a health factor is above given value, we CAN make additional borrow
  ///      using exist collateral
  uint16 public override maxHealthFactor2;

  /// @notice Count of blocks per day, updatable
  uint public override blocksPerDay;

  /// @notice When blocksPerDay was updated last time
  ///         0 - auto-update is disabled
  uint public lastBlockNumber;
  uint public lastBlockTimestamp;

  /// @notice 0 - new borrows are allowed, 1 - any new borrows are forbidden
  bool private _paused;

  /// @notice users who are allowed to make borrow using the TetuConverter
  mapping (address => bool) public whitelist;

  /// @inheritdoc IConverterController
  uint public override debtGap;

  //-----------------------------------------------------
  //               Events
  //-----------------------------------------------------
  event OnSetBlocksPerDay(uint blocksPerDay, bool enableAutoUpdate);
  event OnAutoUpdateBlocksPerDay(uint blocksPerDay);
  event OnSetMinHealthFactor2(uint16 value);
  event OnSetTargetHealthFactor2(uint16 value);
  event OnSetMaxHealthFactor2(uint16 value);
  event OnSetGovernance(address newGovernance);
  event OnAcceptGovernance(address pendingGovernance);
  event OnSetDebtGap(uint debtGap);

  //-----------------------------------------------------
  //        Constructor and Initialization
  //-----------------------------------------------------

  /// @dev Constructor is used to assign immutable addresses only (these contracts don't depend on controller).
  ///      All other addresses are initialized in initialize()
  ///      because the corresponded contracts require controller's address in their constructors.
  constructor(address tetuLiquidator_, address priceOracle_) {
    require(
      tetuLiquidator_ != address(0)
      && priceOracle_ != address(0),
      AppErrors.ZERO_ADDRESS
    );

    tetuLiquidator = tetuLiquidator_;
    priceOracle = priceOracle_;
  }

  function initialize(
    address governance_,
    uint blocksPerDay_,
    uint16 minHealthFactor_,
    uint16 targetHealthFactor_,
    uint16 maxHealthFactor_,
    address tetuConverter_,
    address borrowManager_,
    address debtMonitor_,
    address keeper_,
    address swapManager_,
    uint debtGap_
  ) external initializer {
    require(blocksPerDay_ != 0, AppErrors.INCORRECT_VALUE);
    require(minHealthFactor_ >= MIN_ALLOWED_MIN_HEALTH_FACTOR, AppErrors.WRONG_HEALTH_FACTOR);
    require(minHealthFactor_ < targetHealthFactor_, AppErrors.WRONG_HEALTH_FACTOR_CONFIG);
    require(targetHealthFactor_ < maxHealthFactor_, AppErrors.WRONG_HEALTH_FACTOR_CONFIG);
    require(
      governance_ != address(0)
      && tetuConverter_ != address(0)
      && borrowManager_ != address(0)
      && debtMonitor_ != address(0)
      && keeper_ != address(0)
      && swapManager_ != address(0),
      AppErrors.ZERO_ADDRESS
    );
    governance = governance_;
    tetuConverter = tetuConverter_;
    borrowManager = borrowManager_;
    debtMonitor = debtMonitor_;
    keeper = keeper_;
    swapManager = swapManager_;

    blocksPerDay = blocksPerDay_;
    // by default auto-update of blocksPerDay is disabled
    // it's necessary to call setBlocksPerDay to enable it

    minHealthFactor2 = minHealthFactor_;
    maxHealthFactor2 = maxHealthFactor_;
    targetHealthFactor2 = targetHealthFactor_;

    debtGap = debtGap_;
  }

  function _onlyGovernance() internal view {
    require (msg.sender == governance, AppErrors.GOVERNANCE_ONLY);
  }

  //-----------------------------------------------------
  //               Blocks per day
  //-----------------------------------------------------

  /// @notice Manually set value of blocksPerDay and enable/disable its auto-update
  ///         If the update is enabled, the first update will happen in BLOCKS_PER_DAY_AUTO_UPDATE_PERIOD_SECS seconds
  function setBlocksPerDay(uint blocksPerDay_, bool enableAutoUpdate_) external override {
    require(blocksPerDay_ != 0, AppErrors.INCORRECT_VALUE);
    _onlyGovernance();
    blocksPerDay = blocksPerDay_;
    if (enableAutoUpdate_) {
      lastBlockNumber = block.number;
      lastBlockTimestamp = block.timestamp;
    } else {
      lastBlockNumber = 0;
      lastBlockTimestamp = 0;
    }
    emit OnSetBlocksPerDay(blocksPerDay_, enableAutoUpdate_);
  }

  /// @notice Check if blocksPerDay should be updated. The keeper should do it periodically
  function isBlocksPerDayAutoUpdateRequired(uint periodInSeconds_) external view override returns (bool) {
    return lastBlockNumber != 0 && block.timestamp - lastBlockTimestamp > periodInSeconds_;
  }

  /// @notice Calculate new value of blocksPerDay as COUNT PASSED BLOCKS / COUNT PASSED DAYS (since prev auto-update)
  function updateBlocksPerDay(uint periodInSeconds_) external override {
    require(msg.sender == keeper, AppErrors.KEEPER_ONLY);
    require(lastBlockNumber != 0,
      // && lastBlockNumber != block.number       // this check is unnecessary
      AppErrors.INCORRECT_OPERATION               // setBlocksPerDay is called by governance
    );                                            // but updateBlocksPerDay is called by keeper
                                                  // so, they cannot be called in the same block
    require(
      periodInSeconds_ != 0
      && lastBlockTimestamp + periodInSeconds_ <= block.timestamp,
      AppErrors.INCORRECT_VALUE
    );
    // blocks-per-day = count passed blocks / count passed days
    // count passed days = count passed seconds / count seconds per day
    blocksPerDay = (block.number - lastBlockNumber) * (24 * 60 * 60) / (block.timestamp - lastBlockTimestamp);

    lastBlockNumber = block.number;
    lastBlockTimestamp = block.timestamp;

    emit OnAutoUpdateBlocksPerDay(blocksPerDay);
  }

  //-----------------------------------------------------
  //             Set up health factors
  //  min/max thresholds and a target value for reconversion
  //-----------------------------------------------------

  /// @notice min allowed health factor with decimals 2
  function setMinHealthFactor2(uint16 value_) external override {
    require(value_ >= MIN_ALLOWED_MIN_HEALTH_FACTOR, AppErrors.WRONG_HEALTH_FACTOR);
    require(value_ < targetHealthFactor2, AppErrors.WRONG_HEALTH_FACTOR_CONFIG);
    _onlyGovernance();
    minHealthFactor2 = value_;
    emit OnSetMinHealthFactor2(value_);
  }

  /// @notice target health factor with decimals 2
  /// @dev If the health factor is below/above min/max threshold, we need to make repay
  ///      or additional borrow and restore the health factor to the given target value
  function setTargetHealthFactor2(uint16 value_) external override {
    require(value_ > minHealthFactor2, AppErrors.WRONG_HEALTH_FACTOR_CONFIG);
    require(value_ < maxHealthFactor2, AppErrors.WRONG_HEALTH_FACTOR_CONFIG);
    _onlyGovernance();
    targetHealthFactor2 = value_;
    emit OnSetTargetHealthFactor2(value_);
  }

  /// @notice max allowed health factor with decimals 2
  function setMaxHealthFactor2(uint16 value_) external override {
    require(value_ > targetHealthFactor2, AppErrors.WRONG_HEALTH_FACTOR_CONFIG);
    _onlyGovernance();
    maxHealthFactor2 = value_;
    emit OnSetMaxHealthFactor2(value_);
  }

  //-----------------------------------------------------
  //               Governance
  //-----------------------------------------------------

  /// @notice Suggest to change governance
  function setGovernance(address newGovernance_) external {
    _onlyGovernance();
    require(newGovernance_ != address(0), AppErrors.ZERO_ADDRESS);

    pendingGovernance = newGovernance_;
    emit OnSetGovernance(newGovernance_);
  }

  /// @notice Old governance has suggested to change governance.
  ///         Newly suggested governance must accept the change to actually change the governance.
  function acceptGovernance() external {
    require(pendingGovernance == msg.sender, AppErrors.NOT_PENDING_GOVERNANCE);

    governance = pendingGovernance;
    emit OnAcceptGovernance(pendingGovernance);
  }

  //-----------------------------------------------------
  //               Paused
  //-----------------------------------------------------
  function paused() external view override returns (bool) {
    return _paused;
  }
  function setPaused(bool paused_) external {
    _onlyGovernance();
    _paused = paused_;
  }

  //-----------------------------------------------------
  //               Whitelist
  //-----------------------------------------------------
  function isWhitelisted(address user_) external view override returns (bool) {
    return whitelist[user_];
  }
  function setWhitelistValues(address[] memory users_, bool isWhite) external {
    _onlyGovernance();
    uint len = users_.length;
    for (uint i; i < len; ++i) {
      whitelist[users_[i]] = isWhite;
    }
  }

  //-----------------------------------------------------
  //               Debt gap
  //-----------------------------------------------------

  /// @notice Set up debt gap value
  /// @dev If pool adapter's getStatus returns debtGapRequired = true
  ///      user should reppay debt-amount * (debtGap_ + 100_000) / 100_000
  /// @param debtGap_ Debt gap value, any value >= 0 is suitable
  function setDebtGap(uint debtGap_) external {
    _onlyGovernance();
    debtGap = debtGap_;
  }
}
