// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../core/AppDataTypes.sol";

interface ISwapManager {

  function getConverter(AppDataTypes.InputConversionParams memory params) external view returns (
    address converter,
    uint maxTargetAmount,
    int aprForPeriod36
  );

}
