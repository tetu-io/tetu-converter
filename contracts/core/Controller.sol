// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../interfaces/IController.sol";
import "./AppErrors.sol";
import "../openzeppelin/Initializable.sol";

/// @notice Keep and provide addresses of all application contracts
contract Controller is IController, Initializable {
  uint16 constant MIN_ALLOWED_MIN_HEALTH_FACTOR = 100;

  // We cannot use immutable variables, because each contract should get address of the controller in the constructor

  /// @notice Main application contract, strategy works only with it
  address public override tetuConverter;

  /// @notice Contains list of lending pools. Allow to select most efficient pool for the given collateral/borrow pair
  address public override borrowManager;

  /// @notice Contains list of opened borrows, check healths of the borrows
  address public override debtMonitor;

  /// @notice A keeper to control health of the borrows
  address public override keeper;

  /// @notice Allow to swap assets
  address public override tetuLiquidator;

  /// @notice Wrapper around tetu-liquidator
  address public override swapManager;

  /// @notice Curent governance. It can be changed by offer/accept scheme
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
  uint private _blocksPerDay;

  ///////////////////////////////////////////////////////
  ///               Events
  ///////////////////////////////////////////////////////
  event OnSetBlocksPerDay(uint blocksPerDay);
  event OnSetMinHealthFactor2(uint16 value);
  event OnSetTargetHealthFactor2(uint16 value);
  event OnSetMaxHealthFactor2(uint16 value);
  event OnSetGovernance(address newGovernance);
  event OnAcceptGovernance(address pendingGovernance);

  ///////////////////////////////////////////////////////
  ///        Constructor and Initialization
  ///////////////////////////////////////////////////////

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
    address tetuLiquidator_,
    address swapManager_
  ) external initializer {
    require(blocksPerDay_ != 0, AppErrors.INCORRECT_VALUE);
    require(minHealthFactor_ > MIN_ALLOWED_MIN_HEALTH_FACTOR, AppErrors.WRONG_HEALTH_FACTOR);
    require(minHealthFactor_ < targetHealthFactor_, AppErrors.WRONG_HEALTH_FACTOR_CONFIG);
    require(targetHealthFactor_ < maxHealthFactor_, AppErrors.WRONG_HEALTH_FACTOR_CONFIG);
    require(
      governance_ != address(0)
      && tetuConverter_ != address(0)
      && borrowManager_ != address(0)
      && debtMonitor_ != address(0)
      && keeper_ != address(0)
      && tetuLiquidator_ != address(0)
      && swapManager_ != address(0),
      AppErrors.ZERO_ADDRESS
    );
    governance = governance_;
    tetuConverter = tetuConverter_;
    borrowManager = borrowManager_;
    debtMonitor = debtMonitor_;
    keeper = keeper_;
    tetuLiquidator = tetuLiquidator_;
    swapManager = swapManager_;

    _blocksPerDay = blocksPerDay_;
    minHealthFactor2 = minHealthFactor_;
    maxHealthFactor2 = maxHealthFactor_;
    targetHealthFactor2 = targetHealthFactor_;
  }

  function _onlyGovernance() internal view {
    require (msg.sender == governance, AppErrors.GOVERNANCE_ONLY);
  }

  ///////////////////////////////////////////////////////
  ///               Blocks per day
  ///     TODO: there is idea to detect this value
  ///     TODO: automatically on DebtMonitor side - good idea
  ///////////////////////////////////////////////////////

  function blocksPerDay() external view override returns (uint) {
    return _blocksPerDay;
  }

  function setBlocksPerDay(uint value_) external override {
    require(value_ != 0, AppErrors.INCORRECT_VALUE);
    _onlyGovernance();
    _blocksPerDay = value_;
    emit OnSetBlocksPerDay(value_);
  }

  ///////////////////////////////////////////////////////
  ///             Set up health factors
  ///  min/max thresholds and a target value for reconversion
  ///////////////////////////////////////////////////////

  /// @notice min allowed health factor with decimals 2
  function setMinHealthFactor2(uint16 value_) external override {
    require(value_ > MIN_ALLOWED_MIN_HEALTH_FACTOR, AppErrors.WRONG_HEALTH_FACTOR);
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

  ///////////////////////////////////////////////////////
  ///               Governance
  ///////////////////////////////////////////////////////

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
}
