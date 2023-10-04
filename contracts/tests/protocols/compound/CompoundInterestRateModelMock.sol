// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

contract  CompoundInterestRateModelMock {
  mapping (bytes32 => uint) internal _expectedValues;

  function setExpectedBorrowRate(uint256 cash, uint256 borrows, uint256 reserves, uint value) external {
    bytes32 key = keccak256(abi.encodePacked(cash, borrows, reserves));
    _expectedValues[key] = value;
  }

  function setExpectedSupplyRate(uint256 cash, uint256 borrows, uint256 reserves,uint256 reserveFactorMantissa,  uint value) external {
    bytes32 key = keccak256(abi.encodePacked(cash, borrows, reserves, reserveFactorMantissa));
    _expectedValues[key] = value;
  }

  /// @notice Calculates the current borrow interest rate per block
  /// @param cash The total amount of cash the market has
  /// @param borrows The total amount of borrows the market has outstanding
  /// @param reserves The total amount of reserves the market has
  /// @return The borrow rate per block (as a percentage, and scaled by 1e18)
  function getBorrowRate(uint256 cash, uint256 borrows, uint256 reserves) external view returns (uint256) {
    bytes32 key = keccak256(abi.encodePacked(cash, borrows, reserves));
    return _expectedValues[key];
  }

  /// @notice Calculates the current supply interest rate per block
  /// @param cash The total amount of cash the market has
  /// @param borrows The total amount of borrows the market has outstanding
  /// @param reserves The total amount of reserves the market has
  /// @param reserveFactorMantissa The current reserve factor the market has
  /// @return The supply rate per block (as a percentage, and scaled by 1e18)
  function getSupplyRate(uint256 cash, uint256 borrows, uint256 reserves, uint256 reserveFactorMantissa) external view returns (uint256) {
    bytes32 key = keccak256(abi.encodePacked(cash, borrows, reserves, reserveFactorMantissa));
    return _expectedValues[key];
  }
}
