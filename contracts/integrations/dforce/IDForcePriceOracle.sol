// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Sources: https://github.com/dforce-network/LendingContractsV2
interface IDForcePriceOracle {
  /**
   * @notice Get the underlying price of a iToken asset
     * @param _iToken The iToken to get the underlying price of
     * @return The underlying asset price mantissa (scaled by 1e18).
     *  Zero means the price is unavailable.
     */
  function getUnderlyingPrice(address _iToken)
  external
  view
  returns (uint256);

  /**
   * @notice Get the price of a underlying asset
     * @param _iToken The iToken to get the underlying price of
     * @return The underlying asset price mantissa (scaled by 1e18).
     *  Zero means the price is unavailable and whether the price is valid.
     */
  function getUnderlyingPriceAndStatus(address _iToken)
  external
  view
  returns (uint256, bool);
}
