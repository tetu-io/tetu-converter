// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

contract DebtMonitorMock {
  mapping(address => address[]) poolAdaptersByUsers;
  address public closeLiquidatedPositionLastCalledParam;

  function setPositionsForUser(address user_, address[] memory poolAdapters_) external {
    for (uint i = 0; i < poolAdapters_.length; ++i) {
      poolAdaptersByUsers[user_].push(poolAdapters_[i]);
    }
  }

  function getPositionsForUser(address user_) external view returns(
    address[] memory poolAdaptersOut
  ) {
    poolAdaptersOut = new address[](poolAdaptersByUsers[user_].length);
    for (uint i = 0; i < poolAdaptersByUsers[user_].length; ++i) {
      poolAdaptersOut[i] = poolAdaptersByUsers[user_][i];
    }
  }

  function closeLiquidatedPosition(address poolAdapter_) external {
    closeLiquidatedPositionLastCalledParam = poolAdapter_;
  }
}