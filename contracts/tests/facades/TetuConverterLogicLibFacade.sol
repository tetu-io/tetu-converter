// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../interfaces/IPoolAdapter.sol";
import "../../libs/TetuConverterLogicLib.sol";

contract TetuConverterLogicLibFacade {
  function repay(
    uint totalAmountToRepay,
    IPoolAdapter poolAdapter,
    uint totalDebtForPoolAdapter,
    address receiver,
    bool lastPoolAdapter,
    address borrowAsset_,
    address collateralAsset_,
    uint debtGap
  ) external returns (
    uint remainTotalDebt,
    uint collateralAmountOut
  ) {
    TetuConverterLogicLib.RepayInputParams memory p = TetuConverterLogicLib.RepayInputParams({
      totalAmountToRepay: totalAmountToRepay,
      totalDebtForPoolAdapter: totalDebtForPoolAdapter,
      poolAdapter: poolAdapter,
      borrowAsset: borrowAsset_,
      collateralAsset: collateralAsset_,
      receiver: receiver,
      lastPoolAdapter: lastPoolAdapter,
      debtGap: debtGap
    });
    return TetuConverterLogicLib.repay(p);
  }
}