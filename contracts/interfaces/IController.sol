// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

/// @notice Keep and provide addresses of all application contracts
interface IController {
  function governance() external view returns (address);

  ///////////////////////////////////////////////////////
  ///        Core application contracts
  ///////////////////////////////////////////////////////

  function priceOracle() external view returns (address);
  function tetuConverter() external view returns (address);
  function borrowManager() external view returns (address);
  function debtMonitor() external view returns (address);

  ///////////////////////////////////////////////////////
  ///        External contracts
  ///////////////////////////////////////////////////////

  /// @notice External instance of IBorrower to claim repay in emergency
  function borrower() external view returns (address);

}