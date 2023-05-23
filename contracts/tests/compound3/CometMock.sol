// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Partial implementation of IComet required for testing
contract CometMock {
  uint internal _totalSupply;
  uint internal _totalBorrow;

  uint internal _utilization;
  uint64 internal _borrowRateOut;

  function setTotalSupply(uint totalSupply_) external {
    _totalSupply = totalSupply_;
  }

  function setTotalBorrow(uint totalBorrow_) external {
    _totalBorrow = totalBorrow_;
  }

  function setBorrowRate(uint utilization, uint64 borrowRateOut) external {
    _utilization = utilization;
    _borrowRateOut = borrowRateOut;
  }

  function totalSupply() external view returns (uint) {
    return _totalSupply;
  }

  function totalBorrow() external view returns (uint) {
    return _totalBorrow;
  }

  function getBorrowRate(uint utilization) external view returns (uint64) {
    require(utilization == _utilization, "CometMock.getBorrowRate.missed utilization");
    return _borrowRateOut;
  }
}