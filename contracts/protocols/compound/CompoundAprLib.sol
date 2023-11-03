// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../openzeppelin/IERC20Metadata.sol";
import "../../libs/AppErrors.sol";
import "../../libs/AppUtils.sol";
import "../../libs/AppDataTypes.sol";
import "../../integrations/compound/ICTokenBase.sol";
import "../../integrations/compound/ICompoundInterestRateModel.sol";
import "../../integrations/compound/ICompoundPriceOracle.sol";
import "./CompoundLib.sol";

/// @notice Compound utils: predict borrow and supply rate in advance, calculate borrow and supply APR
///         Borrow APR = the amount by which the debt increases per block; the amount is in terms of borrow tokens
///         Supply APR = the amount by which the income increases per block; the amount is in terms of BORROW tokens too
library CompoundAprLib {

  //region ----------------------------------------------------- Data type
  struct Core {
    ICTokenBase cTokenCollateral;
    ICTokenBase cTokenBorrow;
    address collateralAsset;
    address borrowAsset;
  }
  //endregion ----------------------------------------------------- Data type

  //region ----------------------------------------------------- Addresses

  /// @notice Get core address of DForce
  function getCore(
    CompoundLib.ProtocolFeatures memory f_,
    address cTokenCollateral_,
    address cTokenBorrow_
  ) internal view returns (Core memory) {
    return Core({
      cTokenCollateral: ICTokenBase(cTokenCollateral_),
      cTokenBorrow: ICTokenBase(cTokenBorrow_),
      collateralAsset: CompoundLib.getUnderlying(f_, cTokenCollateral_),
      borrowAsset: CompoundLib.getUnderlying(f_, cTokenBorrow_)
    });
  }
  //endregion ----------------------------------------------------- Addresses

  //region ----------------------------------------------------- Estimate APR (rates per block)

  /// @notice Calculate cost and incomes, take into account borrow rate and supply rate.
  /// @return borrowCost36 Estimated borrow cost for the period, borrow tokens, decimals 36
  /// @return supplyIncomeInBorrowAsset36 Current supply income for the period (in terms of borrow tokens), decimals 36
  function getRawCostAndIncomes(
    Core memory core,
    uint collateralAmount_,
    uint countBlocks_,
    uint amountToBorrow_,
    AppDataTypes.PricesAndDecimals memory pad_
  ) internal view returns (
    uint borrowCost36,
    uint supplyIncomeInBorrowAsset36
  ) {
    supplyIncomeInBorrowAsset36 = getSupplyIncomeInBorrowAsset36(
      getEstimatedSupplyRate(
        ICompoundInterestRateModel(core.cTokenCollateral.interestRateModel()),
        core.cTokenCollateral,
        collateralAmount_
      ),
      countBlocks_,
      pad_.rc10powDec,
      pad_.priceCollateral,
      pad_.priceBorrow,
      collateralAmount_
    );

    // estimate borrow rate value after the borrow and calculate result APR
    borrowCost36 = getBorrowCost36(
      getEstimatedBorrowRate(
        ICompoundInterestRateModel(core.cTokenBorrow.interestRateModel()),
        core.cTokenBorrow,
        amountToBorrow_
      ),
      amountToBorrow_,
      countBlocks_,
      pad_.rb10powDec
    );
  }

  /// @notice Calculate supply income in terms of borrow asset with decimals 36
  /// @param supplyRatePerBlock Decimals 18
  /// @param collateral10PowDecimals 10**collateralAssetDecimals
  function getSupplyIncomeInBorrowAsset36(
    uint supplyRatePerBlock,
    uint countBlocks,
    uint collateral10PowDecimals,
    uint priceCollateral,
    uint priceBorrow,
    uint suppliedAmount
  ) internal pure returns (uint) {
    // original code:
    //    rmul(supplyRatePerBlock * countBlocks, suppliedAmount) * priceCollateral / priceBorrow,
    // but we need result decimals 36
    // so, we replace rmul by ordinal mul and take into account /1e18
    return
      supplyRatePerBlock * countBlocks * suppliedAmount * priceCollateral / priceBorrow
      * 1e18 // not 36 because we replaced rmul by mul
      / collateral10PowDecimals;
  }

  /// @notice Calculate borrow cost in terms of borrow tokens with decimals 36
  /// @dev see LendingContractsV2, Base.sol, _updateInterest
  ///      see Compound-protocol, CToken.sol, accrueInterest
  /// @param borrowRatePerBlock Decimals 18
  /// @param borrow10PowDecimals 10**borrowAssetDecimals
  function getBorrowCost36(
    uint borrowRatePerBlock,
    uint borrowedAmount,
    uint countBlocks,
    uint borrow10PowDecimals
  ) internal pure returns (uint) {
    // simpleInterestFactor = borrowRate * blockDelta
    // interestAccumulated = simpleInterestFactor * totalBorrows
    // newTotalBorrows = interestAccumulated + totalBorrows
    uint simpleInterestFactor = borrowRatePerBlock * countBlocks;

    // Replace rmul(simpleInterestFactor, borrowedAmount) by ordinal mul and take into account /1e18
    return
      simpleInterestFactor * borrowedAmount
      * 1e18 // not 36 because we replaced rmul by mul
      / borrow10PowDecimals;
  }
  //endregion ----------------------------------------------------- Estimate APR (rates per block)

  //region ----------------------------------------------------- Estimate borrow rate

  /// @notice Estimate value of variable borrow rate after borrowing {amountToBorrow_}
  /// @dev repeats compound-protocol, CToken.sol, borrowRatePerBlock() impl
  function getEstimatedBorrowRate(
    ICompoundInterestRateModel interestRateModel_,
    ICTokenBase cTokenBorrow_,
    uint amountToBorrow_
  ) internal view returns (uint) {
    return interestRateModel_.getBorrowRate(
      cTokenBorrow_.getCash() - amountToBorrow_,
      cTokenBorrow_.totalBorrows() + amountToBorrow_,
      cTokenBorrow_.totalReserves()
    );
  }

  /// @notice Estimate value of variable borrow rate after borrowing {amountToBorrow_}
  function getBorrowRateAfterBorrow(address borrowCToken, uint amountToBorrow_) internal view returns (uint) {
    return getEstimatedBorrowRate(
      ICompoundInterestRateModel(ICTokenBase(borrowCToken).interestRateModel()),
      ICTokenBase(borrowCToken),
      amountToBorrow_
    );
  }

  //endregion ----------------------------------------------------- Estimate borrow rate

  //region ----------------------------------------------------- Estimate supply rate

  /// @dev repeats compound-protocol, CToken.sol, supplyRatePerBlock() impl
  function getEstimatedSupplyRate(
    ICompoundInterestRateModel interestRateModel_,
    ICTokenBase cToken_,
    uint amountToSupply_
  ) internal view returns(uint) {
    return interestRateModel_.getSupplyRate(

      // Cash balance of this cToken in the underlying asset
      cToken_.getCash() + amountToSupply_,
      cToken_.totalBorrows(),
      cToken_.totalReserves(),
      cToken_.reserveFactorMantissa()
    );
  }
  //endregion ----------------------------------------------------- Estimate supply rate

}
