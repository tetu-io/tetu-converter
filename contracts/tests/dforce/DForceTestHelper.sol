// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../integrations/dforce/IDForceCToken.sol";

contract DForceTestHelper {
  function updateInterest(address tokenBorrow, address tokenCollateral) external {
    IDForceCToken(tokenBorrow).updateInterest();
    IDForceCToken(tokenCollateral).updateInterest();
  }
}
