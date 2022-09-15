// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../../integrations/aave3/Aave3DataTypes.sol";
import "../../protocols/lending/aave3/Aave3AprLib.sol";

contract Aave3AprLibFacade {
  function getVariableBorrowRateRays(
    Aave3DataTypes.ReserveData memory rb_,
    address borrowAsset_,
    uint amountToBorrow_,
    uint totalStableDebt_,
    uint totalVariableDebt_
  ) external view returns (uint) {
    return Aave3AprLib.getVariableBorrowRateRays(rb_,
      borrowAsset_,
      amountToBorrow_,
      totalStableDebt_,
      totalVariableDebt_
    );
  }

  function getLiquidityRateRays(
    Aave3DataTypes.ReserveData memory rc_,
    address collateralAsset_,
    uint amountToSupply_,
    uint totalStableDebt_,
    uint totalVariableDebt_
  ) external view returns (uint) {
    return Aave3AprLib.getLiquidityRateRays(rc_,
      collateralAsset_,
      amountToSupply_,
      totalStableDebt_,
      totalVariableDebt_
    );
  }

  function getAprForPeriodAfter(
    uint amount,
    uint reserveNormalized,
    uint liquidityIndex,
    uint rate,
    uint countBlocks,
    uint blocksPerDay,
    uint aprMultiplier
  ) external view returns (uint) {
    return AaveSharedLib.getAprForPeriodAfter(amount,
      reserveNormalized,
      liquidityIndex,
      rate,
      countBlocks,
      blocksPerDay,
      aprMultiplier
    );
  }

  function getAprForPeriodBefore(
    AaveSharedLib.State memory state,
    uint amount,
    uint predictedRate,
    uint countBlocks,
    uint blocksPerDay,
    uint operationTimestamp,
    uint aprMultiplier
  ) external view returns (uint) {
    return AaveSharedLib.getAprForPeriodBefore(state,
      amount,
      predictedRate,
      countBlocks,
      blocksPerDay,
      operationTimestamp,
      aprMultiplier
    );
  }

  function getNextLiquidityIndex(
    AaveSharedLib.State memory state,
    uint operationTimestamp
  ) external pure returns (uint) {
    return AaveSharedLib.getNextLiquidityIndex(state, operationTimestamp);
  }
}