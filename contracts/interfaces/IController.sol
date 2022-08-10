// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

/// @notice Keep and provide addresses of all application contracts
interface IController {
  /// @notice min allowed health factor with decimals 2
  function MIN_HEALTH_FACTOR2() external view returns (uint16);
  function governance() external view returns (address);

  function blocksPerDay() external view returns (uint);
  function setBlocksPerDay(uint value_) external;

  ///////////////////////////////////////////////////////
  ///        Core application contracts
  ///////////////////////////////////////////////////////

  function tetuConverter() external view returns (address);
  function borrowManager() external view returns (address);
  function debtMonitor() external view returns (address);

  ///////////////////////////////////////////////////////
  ///        External contracts
  ///////////////////////////////////////////////////////

  /// @notice External instance of IBorrower to claim repay in emergency
  function borrower() external view returns (address);

}