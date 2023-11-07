// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../interfaces/IConverterController.sol";
import "../../interfaces/IAccountant.sol";

/// @notice Utils shared by all AAVE protocols
library Aave3Lib {

/// @notice Register borrow/repay action in the Accountant
/// @param prices [Price of the collateral, price of the borrow asset]
  function _notifyAccountantBorrow(
    IAccountant accountant,
    uint[2] memory prices,
    uint collateralAmount,
    uint borrowedAmount,
    uint totalCollateralBase,
    uint totalDebtBase,
    uint8 decimalsCollateral,
    uint8 decimalsBorrow
  ) internal {
    accountant.onBorrow(
      collateralAmount,
      borrowedAmount,
      totalCollateralBase * (10 ** decimalsCollateral) / prices[0],
      totalDebtBase  * (10 ** decimalsBorrow) / prices[1]
    );
  }

  function _notifyAccountantRepay(
    IAccountant accountant,
    uint[2] memory prices,
    uint withdrawnCollateral,
    uint paidAmount,
    uint totalCollateralBase,
    uint totalDebtBase,
    uint8 decimalsCollateral,
    uint8 decimalsBorrow
  ) internal returns (
    int gain,
    int losses
  ){
    IAccountant accountant = IAccountant(controller_.accountant());

    return accountant.onRepay(
      withdrawnCollateral,
      paidAmount,
      totalCollateralBase * (10 ** decimalsCollateral) / prices[0],
      totalDebtBase  * (10 ** decimalsBorrow) / prices[1]
    );
  }
}