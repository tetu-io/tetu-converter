// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../openzeppelin/Initializable.sol";
import "../interfaces/IController.sol";
import "./AppErrors.sol";

/// @notice Keep and provide addresses of all application contracts
contract Controller is IController {

  uint16 constant MIN_ALLOWED_MIN_HEALTH_FACTOR = 100;

  address public override governance;
  address public override tetuConverter;
  address public override borrowManager;
  address public override debtMonitor;
  address public override borrower;
  address public override tetuLiquidator;
  address public override swapManager;

  /// @notice Min allowed health factor = collateral / min allowed collateral, decimals 2
  /// @dev Health factor < 1 produces liquidation immediately
  uint16 private _minHealthFactor2;

  uint private _blocksPerDay;

  ///////////////////////////////////////////////////////
  ///        Constructor and Initialization
  ///////////////////////////////////////////////////////

  constructor(
    uint blocksPerDay_,
    uint16 minHealthFactor_,
    address governance_
  ) {
    require(governance_ != address(0), AppErrors.ZERO_ADDRESS);
    require(minHealthFactor_ > MIN_ALLOWED_MIN_HEALTH_FACTOR, AppErrors.WRONG_HEALTH_FACTOR);
    require(blocksPerDay_ != 0, AppErrors.INCORRECT_VALUE);

    governance = governance_;

    _blocksPerDay = blocksPerDay_;
    _minHealthFactor2 = minHealthFactor_;
  }

  function initialize(
    address tetuConverter_,
    address borrowManager_,
    address debtMonitor_,
    address borrower_,
    address tetuLiquidator_,
    address swapManager_
  ) external {
    require(
      tetuConverter_ != address(0)
      && borrowManager_ != address(0)
      && debtMonitor_ != address(0)
      && borrower_ != address(0)
      && tetuLiquidator_ != address(0)
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

  function getMinHealthFactor2() external view override returns (uint16) {
    return _minHealthFactor2;
  }

  function setMinHealthFactor2(uint16 value_) external override {
    require(value_ > MIN_ALLOWED_MIN_HEALTH_FACTOR, AppErrors.WRONG_HEALTH_FACTOR);
    _minHealthFactor2 = value_;
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
