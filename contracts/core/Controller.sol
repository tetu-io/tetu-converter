// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../interfaces/IController.sol";
import "./AppErrors.sol";
import "../openzeppelin/Initializable.sol";

/// @notice Keep and provide addresses of all application contracts
contract Controller is IController, Initializable {
  uint16 constant MIN_ALLOWED_MIN_HEALTH_FACTOR = 100;

  //todo docs
  // We cannot use immutable variables, because each contract should get address of the controller in the constructor
  address public override tetuConverter;
  address public override borrowManager;
  address public override debtMonitor;
  address public override keeper;
  address public override tetuLiquidator;
  address public override swapManager;

  /// @notice Curent governance. It can be changed by offer/accept scheme
  address public override governance;
  /// @notice New governance suggested by exist governance
  address public offeredGovernance;

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

  uint private _blocksPerDay;

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
  }

  ///////////////////////////////////////////////////////
  ///             Set up health factors
  ///  min/max thresholds and a target value for reconversion
  ///////////////////////////////////////////////////////

  // todo docs
  function setMinHealthFactor2(uint16 value_) external override {
    require(value_ > MIN_ALLOWED_MIN_HEALTH_FACTOR, AppErrors.WRONG_HEALTH_FACTOR);
    require(value_ < targetHealthFactor2, AppErrors.WRONG_HEALTH_FACTOR_CONFIG);
    _onlyGovernance();
    minHealthFactor2 = value_;
    // todo event
  }

  // todo docs
  function setTargetHealthFactor2(uint16 value_) external override {
    require(value_ > minHealthFactor2, AppErrors.WRONG_HEALTH_FACTOR_CONFIG);
    require(value_ < maxHealthFactor2, AppErrors.WRONG_HEALTH_FACTOR_CONFIG);
    _onlyGovernance();
    targetHealthFactor2 = value_;
    // todo event
  }

  // todo docs
  function setMaxHealthFactor2(uint16 value_) external override {
    require(value_ > targetHealthFactor2, AppErrors.WRONG_HEALTH_FACTOR_CONFIG);
    _onlyGovernance();
    maxHealthFactor2 = value_;
    // todo event
  }

  ///////////////////////////////////////////////////////
  ///               Governance
  ///////////////////////////////////////////////////////

  /// @notice Suggest to change governance
  function offerGovernanceChange(address newGovernance_) external {
    _onlyGovernance();
    require(newGovernance_ != address(0), AppErrors.ZERO_ADDRESS);

    offeredGovernance = newGovernance_;
    // todo event
  }

  /// @notice Old governance has suggested to change governance.
  ///         Newly suggested governance must accept the change to actually change the governance.
  function acceptGovernanceChange() external {
    require(offeredGovernance == msg.sender, AppErrors.GOVERNANCE_ONLY);

    governance = offeredGovernance;
    // todo event
  }
}
