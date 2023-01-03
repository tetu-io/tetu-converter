// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Special mock for DForceRewardsLibTest.ts
contract DForceInterestRateModelMock {
  uint private _cash1;
  uint private _borrowRate1;
  uint private _cash2;
  uint private _borrowRate2;

  constructor (
    uint cash1,
    uint borrowRate1,
    uint cash2,
    uint borrowRate2
  ) {
    _cash1 = cash1;
    _cash2 = cash2;
    _borrowRate1 = borrowRate1;
    _borrowRate2 = borrowRate2;
  }

  function getBorrowRate(
    uint256 cash,
    uint256 borrows,
    uint256 reserves
  ) external view returns (uint256) {
    borrows;
    reserves;

    if (cash == _cash1) {
      return _borrowRate1;
    } else if (cash == _cash2) {
      return _borrowRate2;
    } else revert("There is no borrow rate for provided cash value");
  }
}
