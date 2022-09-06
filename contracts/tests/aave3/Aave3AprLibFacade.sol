// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../../integrations/aave3/Aave3DataTypes.sol";
import "../../protocols/lending/aave3/Aave3AprLib.sol";

contract Aave3AprLibFacade {
  function getAprFactor18(uint blocksPerDay_) external pure returns (uint) {
    return Aave3AprLib.getAprFactor18(blocksPerDay_);
  }

  function getVariableBorrowRateRays(
    Aave3DataTypes.ReserveData memory rb_,
    address borrowAsset_,
    uint amountToBorrow_,
    uint totalStableDebt_,
    uint totalVariableDebt_
  ) external view returns (uint) {
    return Aave3AprLib.getVariableBorrowRateRays(rb_, borrowAsset_, amountToBorrow_, totalStableDebt_, totalVariableDebt_);
  }

  function getLiquidityRateRays(
    Aave3DataTypes.ReserveData memory rc_,
    address collateralAsset_,
    uint amountToSupply_,
    uint totalStableDebt_,
    uint totalVariableDebt_
  ) external view returns (uint) {
    return Aave3AprLib.getLiquidityRateRays(rc_, collateralAsset_, amountToSupply_, totalStableDebt_, totalVariableDebt_);
  }

  function getAprForPeriodAfter(
    uint amount,
    uint currentN,
    uint currentLiquidityIndex,
    uint rate,
    uint countBlocks,
    uint blocksPerDay,
    uint price18
  ) external pure returns (int) {
    return Aave3AprLib.getAprForPeriodAfter(amount, currentN, currentLiquidityIndex, rate, countBlocks
      , blocksPerDay, price18
    );
  }

  function getAprForPeriodBefore(
    Aave3AprLib.State memory state,
    uint amount,
    uint predictedRate,
    uint countBlocks,
    uint blocksPerDay,
    uint price18,
    uint operationTimestamp
  ) external pure returns (int) {
    return Aave3AprLib.getAprForPeriodBefore(state, amount, predictedRate, countBlocks, blocksPerDay
      , price18
      , operationTimestamp
    );
  }
}