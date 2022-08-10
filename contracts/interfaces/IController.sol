// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

/// @notice Keep and provide addresses of all application contracts
interface IController {
  function governance() external view returns (address);

  /// @notice min allowed health factor with decimals 2
  function getMinHealthFactor2() external view returns (uint16);
  function setMinHealthFactor2(uint16 value_) external;

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