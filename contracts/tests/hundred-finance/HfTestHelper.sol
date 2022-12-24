// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../../integrations/hundred-finance/IHfCToken.sol";

contract HfTestHelper {
  function accrueInterest(address tokenBorrow, address tokenCollateral) external {
    IHfCToken(tokenBorrow).accrueInterest();
    IHfCToken(tokenCollateral).accrueInterest();
  }
}