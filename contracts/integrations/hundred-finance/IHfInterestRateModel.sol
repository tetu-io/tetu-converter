// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

/// @notice Restored from 0x29DDb4c4f9baAe366DbD40eff79d364e004425b0 (events were removed)
interface IHfInterestRateModel {
  function baseRatePerBlock() external view returns (uint256);
  function blocksPerYear() external view returns (uint256);
  function getBorrowRate(
    uint256 cash,
    uint256 borrows,
    uint256 reserves
  ) external view returns (uint256);

  function getSupplyRate(
    uint256 cash,
    uint256 borrows,
    uint256 reserves,
    uint256 reserveFactorMantissa
  ) external view returns (uint256);

  function isInterestRateModel() external view returns (bool);
  function isOwner() external view returns (bool);
  function jumpMultiplierPerBlock() external view returns (uint256);
  function kink() external view returns (uint256);
  function multiplierPerBlock() external view returns (uint256);
  function name() external view returns (string memory);
  function owner() external view returns (address);
  function renounceOwnership() external;
  function transferOwnership(address newOwner) external;
  function updateBlocksPerYear(uint256 blocksPerYear_) external;

  function updateJumpRateModel(
    uint256 baseRatePerYear,
    uint256 multiplierPerYear,
    uint256 jumpMultiplierPerYear,
    uint256 kink_
  ) external;

  function utilizationRate(
    uint256 cash,
    uint256 borrows,
    uint256 reserves
  ) external pure returns (uint256);
}
