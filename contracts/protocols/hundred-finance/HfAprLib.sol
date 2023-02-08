// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../openzeppelin/IERC20Metadata.sol";
import "../../core/AppErrors.sol";
import "../../core/AppUtils.sol";
import "../../core/AppDataTypes.sol";
import "../../integrations/hundred-finance/IHfCToken.sol";
import "../../integrations/hundred-finance/IHfInterestRateModel.sol";
import "../../integrations/hundred-finance/IHfComptroller.sol";
import "../../integrations/hundred-finance/IHfPriceOracle.sol";

/// @notice Hundred finance utils: predict borrow and supply rate in advance, calculate borrow and supply APR
///         Borrow APR = the amount by which the debt increases per block; the amount is in terms of borrow tokens
///         Supply APR = the amount by which the income increases per block; the amount is in terms of BORROW tokens too
library HfAprLib {
  address internal constant WMATIC = address(0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270);
  address internal constant hMATIC = address(0xEbd7f3349AbA8bB15b897e03D6c1a4Ba95B55e31);

  ///////////////////////////////////////////////////////
  //                  Data type
  ///////////////////////////////////////////////////////
  struct HfCore {
    IHfCToken cTokenCollateral;
    IHfCToken cTokenBorrow;
    address collateralAsset;
    address borrowAsset;
  }

  ///////////////////////////////////////////////////////
  //                  Addresses
  ///////////////////////////////////////////////////////

  /// @notice Get core address of DForce
  function getCore(
    address cTokenCollateral_,
    address cTokenBorrow_
  ) internal view returns (HfCore memory) {
    return HfCore({
      cTokenCollateral: IHfCToken(cTokenCollateral_),
      cTokenBorrow: IHfCToken(cTokenBorrow_),
      collateralAsset: getUnderlying(cTokenCollateral_),
      borrowAsset: getUnderlying(cTokenBorrow_)
    });
  }

  ///////////////////////////////////////////////////////
  //                  Estimate APR
  ///////////////////////////////////////////////////////

  /// @notice Calculate cost and incomes, take into account borrow rate and supply rate.
  /// @return borrowCost36 Estimated borrow cost for the period, borrow tokens, decimals 36
  /// @return supplyIncomeInBorrowAsset36 Current supply income for the period (in terms of borrow tokens), decimals 36
  function getRawCostAndIncomes(
    HfCore memory core,
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
        IHfInterestRateModel(core.cTokenCollateral.interestRateModel()),
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
        IHfInterestRateModel(core.cTokenBorrow.interestRateModel()),
        core.cTokenBorrow,
        amountToBorrow_
      ),
      amountToBorrow_,
      countBlocks_,
      pad_.rb10powDec
    );
  }

  /// @notice Calculate supply income in terms of borrow asset with decimals 36
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

  ///////////////////////////////////////////////////////
  //         Estimate borrow rate
  ///////////////////////////////////////////////////////

  /// @notice Estimate value of variable borrow rate after borrowing {amountToBorrow_}
  /// @dev repeats compound-protocol, CToken.sol, borrowRatePerBlock() impl
  function getEstimatedBorrowRate(
    IHfInterestRateModel interestRateModel_,
    IHfCToken cTokenBorrow_,
    uint amountToBorrow_
  ) internal view returns (uint) {
    return interestRateModel_.getBorrowRate(
      cTokenBorrow_.getCash() - amountToBorrow_,
      cTokenBorrow_.totalBorrows() + amountToBorrow_,
      cTokenBorrow_.totalReserves()
    );
  }

  ///////////////////////////////////////////////////////
  //         Estimate supply rate
  ///////////////////////////////////////////////////////

  /// @dev repeats compound-protocol, CToken.sol, supplyRatePerBlock() impl
  function getEstimatedSupplyRate(
    IHfInterestRateModel interestRateModel_,
    IHfCToken cToken_,
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

  ///////////////////////////////////////////////////////
  ///                 Utils to inline
  ///////////////////////////////////////////////////////
  function getPrice(IHfPriceOracle priceOracle, address token) internal view returns (uint) {
    uint price = priceOracle.getUnderlyingPrice(token);
    require(price != 0, AppErrors.ZERO_PRICE);
    return price;
  }

  function getUnderlying(address token) internal view returns (address) {
    return token == hMATIC
      ? WMATIC
      : IHfCToken(token).underlying();
  }

}
