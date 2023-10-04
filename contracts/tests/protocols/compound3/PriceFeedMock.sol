// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Mock of IPriceFeed, implements only functions required for tests
contract PriceFeedMock {
  struct LatestRoundDataParams {
    uint80 roundId;
    int256 answer;
    uint256 startedAt;
    uint256 updatedAt;
    uint80 answeredInRound;
  }
  LatestRoundDataParams internal latestRoundDataParams;

  function setLatestRoundData(
    uint80 roundId,
    int256 answer,
    uint256 startedAt,
    uint256 updatedAt,
    uint80 answeredInRound
  ) external {
    latestRoundDataParams = LatestRoundDataParams({
      roundId: roundId,
      answer: answer,
      startedAt: startedAt,
      updatedAt: updatedAt,
      answeredInRound: answeredInRound
    });
  }

  function latestRoundData() external view returns (
    uint80 roundId,
    int256 answer,
    uint256 startedAt,
    uint256 updatedAt,
    uint80 answeredInRound
  ) {
    return (
      latestRoundDataParams.roundId,
      latestRoundDataParams.answer,
      latestRoundDataParams.startedAt,
      latestRoundDataParams.updatedAt,
      latestRoundDataParams.answeredInRound
    );
  }
}