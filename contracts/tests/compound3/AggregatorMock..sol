// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

contract AggregatorMock {
  uint80 roundId;
  int256 answer;
  uint80 ansIn;

  constructor(uint80 roundId_, int256 answer_, uint80 ansIn_) {
    roundId = roundId_;
    answer = answer_;
    ansIn = ansIn_;
  }

  function latestRoundData() public view returns (
    uint80 roundId_,
    int256 answer_,
    uint256 startedAt_,
    uint256 updatedAt_,
    uint80 answeredInRound_
  ) {
    return (
    roundId,
    answer,
    block.timestamp,
    block.timestamp - 100,
    ansIn
    );
  }

  function setAnswer(int256 answer_) external {
    answer = answer_;
  }
}