// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../../integrations/aaveTwo/IAaveTwoPool.sol";
import "../../protocols/lending/aaveTwo/AaveTwoAprLib.sol";


contract AaveTwoAprLibFacade {
  function getAprFactor18(uint blocksPerDay_) external pure returns (uint) {
    return AaveTwoAprLib.getAprFactor18(blocksPerDay_);
  }

  function getBorrowApr18(
    DataTypes.ReserveData memory rb_,
    address borrowAsset_,
    uint amountToBorrow_,
    uint totalStableDebt_,
    uint totalVariableDebt_
  ) external view returns (uint) {
    return AaveTwoAprLib.getBorrowApr18(rb_, borrowAsset_, amountToBorrow_, totalStableDebt_, totalVariableDebt_);
  }

  function getSupplyApr18(
    DataTypes.ReserveData memory rc_,
    address collateralAsset_,
    uint amountToSupply_,
    address borrowAsset_,
    uint totalStableDebt_,
    uint totalVariableDebt_,
    address priceOracle_
  ) external view returns (uint) {
    return AaveTwoAprLib.getSupplyApr18(rc_, collateralAsset_, amountToSupply_, borrowAsset_, totalStableDebt_
    , totalVariableDebt_, priceOracle_
    );
  }
}