// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../openzeppelin/Initializable.sol";
import "../interfaces/IController.sol";
import "./AppErrors.sol";

/// @notice Keep and provide addresses of all application contracts
contract Controller is IController, Initializable {

  uint16 constant MIN_ALLOWED_MIN_HEALTH_FACTOR = 100;

  address public override governance;
  address public override tetuConverter;
  address public override borrowManager;
  address public override debtMonitor;
  address public override borrower;
  address public override tetuLiquidator;
  address public override swapManager;

  /// @notice Min allowed health factor = collateral / min allowed collateral, decimals 2
  ///         If a health factor is below given value, we need to repay a part of borrow back
  /// @dev Health factor < 1 produces liquidation immediately
  uint16 public override minHealthFactor2;

  /// @notice max allowed health factor with decimals 2
  /// @dev If a health factor is above given value, we CAN make additional borrow
  ///      using exist collateral
  uint16 public override maxHealthFactor2;

  /// @notice target health factor with decimals 2
  /// @dev If the health factor is below/above min/max threshold, we need to make repay
  ///      or additional borrow and restore the health factor to the given target value
  uint16 public override targetHealthFactor2;

  uint private _blocksPerDay;

  ///////////////////////////////////////////////////////
  ///        Constructor and Initialization
  ///////////////////////////////////////////////////////

  constructor(
    uint blocksPerDay_,
    address governance_,
    uint16 minHealthFactor_,
    uint16 maxHealthFactor_,
    uint16 targetHealthFactor_
  ) {
    require(governance_ != address(0), AppErrors.ZERO_ADDRESS);
    require(blocksPerDay_ != 0, AppErrors.INCORRECT_VALUE);
    require(minHealthFactor_ > MIN_ALLOWED_MIN_HEALTH_FACTOR, AppErrors.WRONG_HEALTH_FACTOR);
    require(minHealthFactor_ < maxHealthFactor_, AppErrors.WRONG_HEALTH_FACTOR);
    require(minHealthFactor_ < targetHealthFactor_, AppErrors.WRONG_HEALTH_FACTOR);
    require(targetHealthFactor_ < maxHealthFactor_, AppErrors.WRONG_HEALTH_FACTOR);

    governance = governance_;

    _blocksPerDay = blocksPerDay_;
    minHealthFactor2 = minHealthFactor_;
  }

  function initialize(
    address tetuConverter_,
    address borrowManager_,
    address debtMonitor_,
    address borrower_,
    address tetuLiquidator_,
    address swapManager_
  ) external initializer {
    require(
      tetuConverter_ != address(0)
      && borrowManager_ != address(0)
      && debtMonitor_ != address(0)
      && borrower_ != address(0)
      && tetuLiquidator_ != address(0)
      && swapManager_ != address(0)
      , AppErrors.ZERO_ADDRESS
    );
    tetuConverter = tetuConverter_;
    borrowManager = borrowManager_;
    debtMonitor = debtMonitor_;
    borrower = borrower_;
    tetuLiquidator = tetuLiquidator_;
    swapManager = swapManager_;
  }

  function _onlyGovernance() internal view {
    require (msg.sender == governance, AppErrors.GOVERNANCE_ONLY);
  }

  ///////////////////////////////////////////////////////
  ///               Blocks per day
  ///     TODO: there is idea to detect this value
  ///     TODO: automatically on DebtMonitor side
  ///////////////////////////////////////////////////////

  function blocksPerDay() external view override returns (uint) {
    return _blocksPerDay;
  }

  function setBlocksPerDay(uint value_) external override {
    require(value_ != 0, AppErrors.INCORRECT_VALUE);
    _blocksPerDay = value_;
  }

  ///////////////////////////////////////////////////////
  ///             Set up health factors
  ///  min/max thresholds and a target value for reconversion
  ///////////////////////////////////////////////////////

  function setMinHealthFactor2(uint16 value_) external override {
    require(value_ > MIN_ALLOWED_MIN_HEALTH_FACTOR, AppErrors.WRONG_HEALTH_FACTOR);
    require(value_ < targetHealthFactor2, AppErrors.WRONG_HEALTH_FACTOR);
    minHealthFactor2 = value_;
  }

  function setMaxHealthFactor2(uint16 value_) external override {
    require(value_ > targetHealthFactor2, AppErrors.WRONG_HEALTH_FACTOR);
    maxHealthFactor2 = value_;
  }

  function setTargetHealthFactor2(uint16 value_) external override {
    require(value_ > minHealthFactor2, AppErrors.WRONG_HEALTH_FACTOR);
    require(value_ < maxHealthFactor2, AppErrors.WRONG_HEALTH_FACTOR);
    targetHealthFactor2 = value_;
  }

  ///////////////////////////////////////////////////////
  ///               Governance
  ///////////////////////////////////////////////////////

  function _ensureSenderIsGovernance() internal view {
    require (msg.sender == governance, AppErrors.GOVERNANCE_ONLY);
  }
  function setGovernance(address governance_) external {
    require(governance_ != address(0), AppErrors.ZERO_ADDRESS);
    _onlyGovernance();
    governance = governance_;
  }

  ///////////////////////////////////////////////////////
  ///             Set addresses
  ///////////////////////////////////////////////////////

  function setTetuConverter(address tetuConverter_) external {
    require(tetuConverter_ != address(0), AppErrors.ZERO_ADDRESS);
    _onlyGovernance();
    tetuConverter = tetuConverter_;
  }

  function setBorrowManager(address borrowManager_) external {
    require(borrowManager_ != address(0), AppErrors.ZERO_ADDRESS);
    _onlyGovernance();
    borrowManager = borrowManager_;
  }

  function setDebtMonitor(address debtMonitor_) external {
    require(debtMonitor_ != address(0), AppErrors.ZERO_ADDRESS);
    _onlyGovernance();
    debtMonitor = debtMonitor_;
  }

  /// @notice External instance of IBorrower to claim repay in emergency
  function setBorrower(address borrower_) external {
    require(borrower_ != address(0), AppErrors.ZERO_ADDRESS);
    _onlyGovernance();
    borrower = borrower_;
  }

  function setTetuLiquidator(address tetuLiquidator_) external {
    require(tetuLiquidator_ != address(0), AppErrors.ZERO_ADDRESS);
    _onlyGovernance();
    tetuLiquidator = tetuLiquidator_;
  }

  function setSwapManager(address swapManager_) external {
    require(swapManager_ != address(0), AppErrors.ZERO_ADDRESS);
    _onlyGovernance();
    swapManager = swapManager_;
  }
}
