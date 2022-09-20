//// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;
//
//import "../../../integrations/hundred-finance/IHfCToken.sol";
//import "../../../integrations/hundred-finance/IHfInterestRateModel.sol";
//
///// @notice DForce utils: estimate reward tokens, predict borrow rate in advance
//library HfForceAprLib {
//
//  ///////////////////////////////////////////////////////
//  //                  Estimate APR
//  ///////////////////////////////////////////////////////
//
//  /// @notice Calculate APR, take into account all borrow rate, supply rate, borrow and supply tokens.
//  /// @return borrowApr18 Estimated borrow APR for the period, borrow tokens.
//  /// @return supplyAprBT18 Current supply APR for the period (in terms of borrow tokens)
//  /// @return rewardsAmountBT18 Estimated total amount of rewards at the end of the period (in terms of borrow tokens)
//  function getRawAprInfo18(
//    DForceCore memory core,
//    uint collateralAmount_,
//    uint countBlocks_,
//    uint amountToBorrow_
//  ) internal view returns (
//    uint borrowApr18,
//    uint supplyAprBT18
//  ) {
//    uint priceBorrow = getPrice(core.priceOracle, address(core.cTokenBorrow));
//
//    // it seems like there is no method getSupplyRate in the current interest models
//    // the call of getSupplyRate is just crashed, so we cannot estimate next supply rate.
//    // For simplicity just return current supplyRate
//    // Recalculate the amount from [collateral tokens] to [borrow tokens]
//    supplyAprBT18 = getSupplyApr18(
//      getEstimatedSupplyRate(core.cTokenCollateral, collateralAmount_),
//      countBlocks_,
//      core.cTokenCollateral.decimals(),
//      getPrice(core.priceOracle, address(core.cTokenCollateral)),
//      priceBorrow,
//      collateralAmount_
//    );
//
//    // estimate borrow rate value after the borrow and calculate result APR
//    borrowApr18 = getBorrowApr18(
//      getEstimatedBorrowRate(
//        core.borrowInterestRateModel,
//        core.cTokenBorrow,
//        amountToBorrow_
//      ),
//      core.cTokenBorrow.totalBorrows(),
//      countBlocks_,
//      core.cTokenBorrow.decimals()
//    );
//  }
//
//  /// @notice Calculate supply APR in terms of borrow tokens with decimals 18
//  function getSupplyApr18(
//    uint supplyRatePerBlock,
//    uint countBlocks,
//    uint8 ciceCollateral,
//    uint collateralDecimals,
//    uint priceBorrow,
//    uint suppliedAmount
//  ) internal pure returns (uint) {
//    return AppUtils.toMantissa(
//      rmul(supplyRatePerBlock * countBlocks, suppliedAmount) * priceCollateral / priceBorrow,
//      collateralDecimals,
//      18
//    );
//  }
//
//  /// @notice Calculate borrow APR in terms of borrow tokens with decimals 18
//  /// @dev see LendingContractsV2, Base.sol, _updateInterest
//  function getBorrowApr18(
//    uint borrowRatePerBlock,
//    uint borrowedAmount,
//    uint countBlocks,
//    uint8 borrowDecimals
//  ) internal pure returns (uint) {
//    // simpleInterestFactor = borrowRate * blockDelta
//    // interestAccumulated = simpleInterestFactor * totalBorrows
//    // newTotalBorrows = interestAccumulated + totalBorrows
//    uint simpleInterestFactor = borrowRatePerBlock * countBlocks;
//
//    return  AppUtils.toMantissa(
//      rmul(simpleInterestFactor, borrowedAmount),
//      borrowDecimals,
//      18
//    );
//  }
//
//  ///////////////////////////////////////////////////////
//  //         Estimate borrow rate
//  ///////////////////////////////////////////////////////
//
//  /// @notice Estimate value of variable borrow rate after borrowing {amountToBorrow_}
//  ///         Rewards are not taken into account
//  function getEstimatedBorrowRate(
//    IHfInterestRateModel interestRateModel_,
//    IHfCToken cTokenBorrow_,
//    uint amountToBorrow_
//  ) internal view returns (uint) {
//    return interestRateModel_.getBorrowRate(
//      cTokenBorrow_.getCash() - amountToBorrow_,
//      cTokenBorrow_.totalBorrows() + amountToBorrow_,
//      cTokenBorrow_.totalReserves()
//    );
//  }
//
//  /// @notice Estimate value of variable borrow rate after borrowing {amountToBorrow_}
//  ///         Rewards are not taken into account
//  function getEstimatedBorrowRatePure(
//    IHfInterestRateModel interestRateModel_,
//    IHfCToken cTokenBorrow_,
//    uint amountToBorrow_
//  ) internal view returns (uint) {
//    return interestRateModel_.getBorrowRate(
//      cTokenBorrow_.getCash() - amountToBorrow_,
//      cTokenBorrow_.totalBorrows() + amountToBorrow_,
//      cTokenBorrow_.totalReserves()
//    );
//  }
//
//  ///////////////////////////////////////////////////////
//  //         Estimate supply rate
//  ///////////////////////////////////////////////////////
//
//  function getEstimatedSupplyRate(
//    IHfCToken cTokenCollateral_,
//    uint amountToSupply_
//  ) internal view returns(uint) {
//    return getEstimatedSupplyRatePure(
//      cTokenCollateral_.totalSupply(),
//      amountToSupply_,
//      cTokenCollateral_.getCash(),
//      cTokenCollateral_.totalBorrows(),
//      cTokenCollateral_.totalReserves(),
//      IDForceInterestRateModel(cTokenCollateral_.interestRateModel()),
//      cTokenCollateral_.reserveRatio(),
//      cTokenCollateral_.exchangeRateStored()
//    );
//  }
//
//  /// @dev repeats LendingContractsV2, iToken.sol, supplyRatePerBlock() impl
//  function getEstimatedSupplyRatePure(
//    uint totalSupply_,
//    uint amountToSupply_,
//    uint cash_,
//    uint totalBorrows_,
//    uint totalReserves_,
//    IHfInterestRateModel interestRateModel_,
//    uint reserveRatio_,
//    uint currentExchangeRate_
//  ) internal view returns(uint) {
//    uint totalSupply = totalSupply_ + amountToSupply_ * 10**18 / currentExchangeRate_;
//
//    uint exchangeRateInternal = getEstimatedExchangeRate(
//      totalSupply,
//      cash_ + amountToSupply_, // cash is increased exactly on amountToSupply_, no approximation here
//      totalBorrows_,
//      totalReserves_
//    );
//
//    uint underlyingScaled = totalSupply * exchangeRateInternal;
//    if (underlyingScaled == 0) return 0;
//
//    uint borrowRatePerBlock = interestRateModel_.getBorrowRate(
//      cash_ + amountToSupply_,
//      totalBorrows_,
//      totalReserves_
//    );
//
//    return tmul(
//      borrowRatePerBlock,
//      1e18 - reserveRatio_,
//      rdiv(totalBorrows_ * 1e18, underlyingScaled)
//    );
//  }
//
//  function getEstimatedExchangeRate(
//    uint totalSupply_,
//    uint cash_,
//    uint totalBorrows_,
//    uint totalReserves_
//  ) internal pure returns (uint) {
//    return totalSupply_ == 0
//    ? 0
//    : rdiv(cash_ + totalBorrows_ - totalReserves_, totalSupply_);
//  }
//}
