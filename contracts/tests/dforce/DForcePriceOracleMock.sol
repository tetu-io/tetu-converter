// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "hardhat/console.sol";

contract DForcePriceOracleMock {
  mapping(address => uint) public prices;

  function setUnderlyingPrice(address iToken_, uint price_) external {
    console.log("setUnderlyingPrice", iToken_, price_);
    prices[iToken_] = price_;
  }

  /**
   * @notice Get the underlying price of a iToken asset
     * @param iToken_ The iToken to get the underlying price of
     * @return The underlying asset price mantissa (scaled by 1e18).
     *  Zero means the price is unavailable.
     */
  function getUnderlyingPrice(address iToken_)
  external
  view
  returns (uint256) {
    console.log("getUnderlyingPrice", iToken_, prices[iToken_]);
    return prices[iToken_];
  }

  /**
   * @notice Get the price of a underlying asset
     * @param iToken_ The iToken to get the underlying price of
     * @return The underlying asset price mantissa (scaled by 1e18).
     *  Zero means the price is unavailable and whether the price is valid.
     */
  function getUnderlyingPriceAndStatus(address iToken_)
  external
  view
  returns (uint256, bool) {
    console.log("getUnderlyingPriceAndStatus", iToken_, prices[iToken_]);
    return (prices[iToken_], true);
  }
}
