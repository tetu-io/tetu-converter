// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../../protocols/hundred-finance/HfAprLib.sol";
import "../../../integrations/hundred-finance/IHfInterestRateModel.sol";
import "../../../integrations/hundred-finance/IHfComptroller.sol";
import "../../../integrations/hundred-finance/IHfCToken.sol";

/// @notice Facade for HfAprLib to make external functions available for tests
contract HfAprLibFacade {
  function getCore(
    address cTokenCollateral_,
    address cTokenBorrow_
  ) external view returns (HfAprLib.HfCore memory) {
    return HfAprLib.getCore(cTokenCollateral_, cTokenBorrow_);
  }

  function getEstimatedBorrowRate(
    IHfInterestRateModel interestRateModel_,
    IHfCToken cTokenBorrow_,
    uint amountToBorrow_
  ) external view returns (uint) {
    return HfAprLib.getEstimatedBorrowRate(
      interestRateModel_,
      cTokenBorrow_,
      amountToBorrow_
    );
  }

  function getEstimatedSupplyRate(
    IHfInterestRateModel interestRateModel_,
    IHfCToken cTokenCollateral_,
    uint amountToSupply_
  ) external view returns(uint) {
    return HfAprLib.getEstimatedSupplyRate(
      interestRateModel_,
      cTokenCollateral_,
      amountToSupply_
    );
  }

  function getRawCostAndIncomes(
    HfAprLib.HfCore memory core,
    uint collateralAmount_,
    uint countBlocks_,
    uint amountToBorrow_,
    AppDataTypes.PricesAndDecimals memory pad_
  ) external view returns (
    uint borrowCost36,
    uint supplyIncomeInBorrowAsset36
  ) {
    return HfAprLib.getRawCostAndIncomes(
      core,
      collateralAmount_,
      countBlocks_,
      amountToBorrow_,
      pad_
    );
  }

  function getSupplyIncomeInBorrowAsset36(
    uint supplyRatePerBlock,
    uint countBlocks,
    uint collateral10PowDecimals,
    uint priceCollateral,
    uint priceBorrow,
    uint suppliedAmount
  ) external pure returns (uint) {
    return HfAprLib.getSupplyIncomeInBorrowAsset36(
      supplyRatePerBlock,
      countBlocks,
      collateral10PowDecimals,
      priceCollateral,
      priceBorrow,
      suppliedAmount
    );
  }

  function getBorrowCost36(
    uint borrowRatePerBlock,
    uint borrowedAmount,
    uint countBlocks,
    uint borrow10PowDecimals
  ) external pure returns (uint) {
    return HfAprLib.getBorrowCost36(borrowRatePerBlock, borrowedAmount, countBlocks, borrow10PowDecimals);
  }

  function getPrice(IHfPriceOracle priceOracle, address token) external view returns (uint) {
    return HfAprLib.getPrice(priceOracle, token);
  }

  function getUnderlying(address token) public view returns (address) {
    return HfAprLib.getUnderlying(token);
  }
}
