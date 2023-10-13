// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

contract DebtMonitorMock {
  mapping(address => address[]) internal poolAdaptersByUsers;
  address public closeLiquidatedPositionLastCalledParam;
  mapping(address => bool) internal _openedPositions;
  mapping(address => bool) internal _closedPositions;

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

  function _isOpenedPosition(address user) external view returns (bool) {
    return _openedPositions[user];
  }
  function onOpenPosition() external {
    _openedPositions[msg.sender] = true;
  }

  function _isClosedPosition(address user) external view returns (bool) {
    return _closedPositions[user];
  }
  function onClosePosition() external {
    _closedPositions[msg.sender] = true;
  }
}
