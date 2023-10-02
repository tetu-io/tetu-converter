// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../protocols/compound/CompoundAprLib.sol";

/// @notice Facade for CompoundAprLib to make external functions available for tests
contract CompoundLibFacade {
  function getCore(
    CompoundLib.ProtocolFeatures memory f_,
    address cTokenCollateral_,
    address cTokenBorrow_
  ) external view returns (CompoundAprLib.Core memory) {
    return CompoundAprLib.getCore(f_, cTokenCollateral_, cTokenBorrow_);
  }

  function getEstimatedBorrowRate(
    ICompoundInterestRateModel interestRateModel_,
    ICTokenBase cTokenBorrow_,
    uint amountToBorrow_
  ) external view returns (uint) {
    return CompoundAprLib.getEstimatedBorrowRate(interestRateModel_, cTokenBorrow_, amountToBorrow_);
  }

  function getEstimatedSupplyRate(
    ICompoundInterestRateModel interestRateModel_,
    ICTokenBase cTokenCollateral_,
    uint amountToSupply_
  ) external view returns(uint) {
    return CompoundAprLib.getEstimatedSupplyRate(interestRateModel_, cTokenCollateral_, amountToSupply_);
  }

  function getRawCostAndIncomes(
    CompoundAprLib.Core memory core,
    uint collateralAmount_,
    uint countBlocks_,
    uint amountToBorrow_,
    AppDataTypes.PricesAndDecimals memory pad_
  ) external view returns (
    uint borrowCost36,
    uint supplyIncomeInBorrowAsset36
  ) {
    return CompoundAprLib.getRawCostAndIncomes(core, collateralAmount_, countBlocks_, amountToBorrow_, pad_);
  }

  function getSupplyIncomeInBorrowAsset36(
    uint supplyRatePerBlock,
    uint countBlocks,
    uint collateral10PowDecimals,
    uint priceCollateral,
    uint priceBorrow,
    uint suppliedAmount
  ) external pure returns (uint) {
    return CompoundAprLib.getSupplyIncomeInBorrowAsset36(supplyRatePerBlock, countBlocks, collateral10PowDecimals, priceCollateral, priceBorrow, suppliedAmount);
  }

  function getBorrowCost36(
    uint borrowRatePerBlock,
    uint borrowedAmount,
    uint countBlocks,
    uint borrow10PowDecimals
  ) external pure returns (uint) {
    return CompoundAprLib.getBorrowCost36(borrowRatePerBlock, borrowedAmount, countBlocks, borrow10PowDecimals);
  }

  function getPrice(ICompoundPriceOracle priceOracle, address token) external view returns (uint) {
    return CompoundAprLib.getPrice(priceOracle, token);
  }

  function getUnderlying(CompoundLib.ProtocolFeatures memory f_, address token) public view returns (address) {
    return CompoundAprLib.getUnderlying(f_, token);
  }
}
