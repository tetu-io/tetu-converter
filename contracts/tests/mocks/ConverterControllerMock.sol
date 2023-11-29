// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

/// @notice Implement configurable function of ConverterController required in tests
contract ConverterControllerMock {

  //region Borrow manager
  address public borrowManager;
  function setupBorrowManager(address borrowManager_) external {
    borrowManager = borrowManager_;
  }
  //endregion Borrow manager

  //region minHealthFactor2
  uint16 public minHealthFactor2;
  function setupMinHealthFactor2(uint16 minHealthFactor2_) external {
    minHealthFactor2 = minHealthFactor2_;
  }
  //endregion minHealthFactor2

  //region governance
  address public governance;
  function setGovernance(address governance_) external {
    governance = governance_;
  }
  //endregion governance

}
