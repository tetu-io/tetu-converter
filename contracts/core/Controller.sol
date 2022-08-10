// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../openzeppelin/Initializable.sol";
import "../interfaces/IController.sol";
import "./AppErrors.sol";

/// @notice Keep and provide addresses of all application contracts
contract Controller is IController, Initializable {
  bytes32 public immutable governanceKey;
  bytes32 public immutable priceOracleKey;
  bytes32 public immutable tetuConverterKey;
  bytes32 public immutable borrowManagerKey;
  bytes32 public immutable debtMonitorKey;

  bytes32 public immutable borrowerKey;

  /// @notice Min allowed health factor = collateral / min allowed collateral, decimals 2
  /// @dev Health factor < 1 produces liquidation immediately
  uint16 constant public override MIN_HEALTH_FACTOR2 = 150; //=1.5; TODO value?

  /// @notice map: keccak256(abi.encodePacked(XXX)) => XXX
  mapping(bytes32 => address) private addressStorage;

  uint private _blocksPerDay;

  ///////////////////////////////////////////////////////
  ///        Constructor and Initialization
  ///////////////////////////////////////////////////////

  constructor() {
    governanceKey = keccak256(abi.encodePacked("governance"));
    priceOracleKey = keccak256(abi.encodePacked("priceOracle"));
    tetuConverterKey = keccak256(abi.encodePacked("tetuConverter"));
    borrowManagerKey = keccak256(abi.encodePacked("borrowManager"));
    debtMonitorKey = keccak256(abi.encodePacked("debtMonitor"));
    borrowerKey = keccak256(abi.encodePacked("borrower"));
  }

  function initialize(bytes32[] memory keys_, address[] calldata values_) external initializer {
    _assignBatch(keys_, values_);
  }

  ///////////////////////////////////////////////////////
  ///               Setters
  ///////////////////////////////////////////////////////

  /// TODO: it's very convenient to implement and test such function... what's better approach?
  function assignBatch(bytes32[] memory keys_, address[] calldata values_) external {
    _ensureSenderIsGovernance();
    _assignBatch(keys_, values_);
  }

  function _assignBatch(bytes32[] memory keys_, address[] calldata values_) internal {
    uint len = keys_.length;
    require(len == values_.length, AppErrors.WRONG_LENGTHS);

    for (uint i = 0; i < len; ++i) {
      require(values_[i] != address(0), AppErrors.ZERO_ADDRESS);
      addressStorage[keys_[i]] = values_[i];
    }
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
    require(value_ != 0, AppErrors.ZERO_VALUE);
    _blocksPerDay = value_;
  }

  ///////////////////////////////////////////////////////
  ///               Governance
  ///////////////////////////////////////////////////////
  function governance() external view override returns (address) {
    return _governance();
  }
  function _governance() internal view returns (address) {
    return addressStorage[governanceKey];
  }
  function _ensureSenderIsGovernance() internal view {
    require (msg.sender == _governance(), AppErrors.GOVERNANCE_ONLY);
  }

  ///////////////////////////////////////////////////////
  ///               Getters
  ///////////////////////////////////////////////////////
  function priceOracle() external view override returns (address) {
    return addressStorage[priceOracleKey];
  }
  function tetuConverter() external view override returns (address) {
    return addressStorage[tetuConverterKey];
  }
  function borrowManager() external view override returns (address) {
    return addressStorage[borrowManagerKey];
  }
  function debtMonitor() external view override returns (address) {
    return addressStorage[debtMonitorKey];
  }
  /// @notice External instance of IBorrower to claim repay in emergency
  function borrower() external view override returns (address) {
    return addressStorage[borrowerKey];
  }

  ///////////////////////////////////////////////////////
  ///               Helper utils
  ///////////////////////////////////////////////////////

  function _uncheckedInc(uint i) internal pure returns (uint) {
    unchecked {
      return i + 1;
    }
  }

}
