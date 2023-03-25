// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../protocols/aaveShared/AaveSharedLib.sol";

contract AaveSharedLibFacade {
  function getReserveForDustDebt(uint targetDecimals, uint price, uint8 priceDecimals) external pure returns (uint) {
    return AaveSharedLib.getReserveForDustDebt(targetDecimals, price, priceDecimals);
  }

}