// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../../../integrations/hundred-finance/IHfCToken.sol";
import "../../../integrations/hundred-finance/IHfInterestRateModel.sol";
import "../../../integrations/hundred-finance/IHfComptroller.sol";
import "../../../integrations/hundred-finance/IHfOracle.sol";

/// @notice DForce utils: estimate reward tokens, predict borrow rate in advance
library HfForceAprLib {

  ///////////////////////////////////////////////////////
  //                  Data type
  ///////////////////////////////////////////////////////
  struct HfCore {
    IHfComptroller comptroller;
    IHfCToken cTokenCollateral;
    IHfCToken cTokenBorrow;
    IHfInterestRateModel borrowInterestRateModel;
    IHfInterestRateModel collateralInterestRateModel;
    IHfOracle priceOracle;
  }

  /// @notice Set of input params for borrowRewardAmounts function
  struct DBorrowRewardsInput {
    /// @notice Block where the borrow is made
    uint blockNumber;
    uint amountToBorrow;
    uint accrualBlockNumber;

    uint stateIndex;
    uint stateBlock;
    uint borrowIndex;
    uint distributionSpeed;

    uint totalCash;
    uint totalBorrows;
    uint totalReserves;
    uint reserveFactor;

    address interestRateModel;
  }

  struct RewardsAmountInput {
    uint collateralAmount;
    uint borrowAmount;
    uint countBlocks;
    uint delayBlocks;
    uint priceBorrow;
  }

  ///////////////////////////////////////////////////////
  //                  Addresses
  ///////////////////////////////////////////////////////

  /// @notice Get core address of DForce
  function getCore(
    IHfComptroller comptroller,
    address cTokenCollateral_,
    address cTokenBorrow_
  ) internal view returns (HfCore memory) {
    return HfCore({
      comptroller: comptroller,
      cTokenCollateral: IHfCToken(cTokenCollateral_),
      cTokenBorrow: IHfCToken(cTokenBorrow_),
      borrowInterestRateModel: IHfInterestRateModel(IHfCToken(cTokenBorrow_).interestRateModel()),
      collateralInterestRateModel: IHfInterestRateModel(IHfCToken(cTokenCollateral_).interestRateModel()),
      priceOracle: IHfOracle(comptroller.priceOracle())
    });
  }

  ///////////////////////////////////////////////////////
  //                  Estimate APR
  ///////////////////////////////////////////////////////

  /// @notice Calculate APR, take into account all borrow rate, supply rate, borrow and supply tokens.
  /// @return borrowApr36 Estimated borrow APR for the period, borrow tokens, decimals 36
  /// @return supplyAprBt36 Current supply APR for the period (in terms of borrow tokens), decimals 36
  /// @return rewardsAmountBt36 Estimated total amount of rewards at the end of the period (in terms of borrow tokens)
  function getRawAprInfo36(
    HfCore memory core,
    uint collateralAmount_,
    uint countBlocks_,
    uint amountToBorrow_
  ) internal view returns (
    uint borrowApr36,
    uint supplyAprBt36,
  ) {
    console.log("getRawAprInfo36");
    console.log("collateralAmount_", collateralAmount_);
    console.log("amountToBorrow_", amountToBorrow_);
    uint priceBorrow = getPrice(core.priceOracle, address(core.cTokenBorrow)) * 10**core.cTokenBorrow.decimals();

    supplyAprBt36 = getSupplyApr36(
      getEstimatedSupplyRate(core.cTokenCollateral, collateralAmount_),
      countBlocks_,
      core.cTokenCollateral.decimals(),
      getPrice(core.priceOracle, address(core.cTokenCollateral)) * 10**core.cTokenCollateral.decimals(),
      priceBorrow,
      collateralAmount_
    );
    console.log("getEstimatedSupplyRate",getEstimatedSupplyRate(core.cTokenCollateral, collateralAmount_));

    // estimate borrow rate value after the borrow and calculate result APR
    borrowApr36 = getBorrowApr36(
      getEstimatedBorrowRate(
        core.borrowInterestRateModel,
        core.cTokenBorrow,
        amountToBorrow_
      ),
      amountToBorrow_, //TODO core.cTokenBorrow.totalBorrows(),
      countBlocks_,
      core.cTokenBorrow.decimals()
    );
    console.log("supplyAprBt36", supplyAprBt36);
    console.log("borrowApr36", borrowApr36);
    console.log("getEstimatedBorrowRate", getEstimatedBorrowRate(
        core.borrowInterestRateModel,
        core.cTokenBorrow,
        amountToBorrow_
      ));
  }

  /// @notice Calculate supply APR in terms of borrow tokens with decimals 36
  function getSupplyApr36(
    uint supplyRatePerBlock,
    uint countBlocks,
    uint8 collateralDecimals,
    uint priceCollateral,
    uint priceBorrow,
    uint suppliedAmount
  ) internal pure returns (uint) {
    // original code:
    //    rmul(supplyRatePerBlock * countBlocks, suppliedAmount) * priceCollateral / priceBorrow,
    // but we need result decimals 36
    // so, we replace rmul by ordinal mul and take into account /1e18
    return AppUtils.toMantissa(
      supplyRatePerBlock * countBlocks * suppliedAmount * priceCollateral / priceBorrow,
      collateralDecimals,
      18 // not 36 because we replaced rmul by mul
    );
  }

  /// @notice Calculate borrow APR in terms of borrow tokens with decimals 36
  /// @dev see LendingContractsV2, Base.sol, _updateInterest
  function getBorrowApr36(
    uint borrowRatePerBlock,
    uint borrowedAmount,
    uint countBlocks,
    uint8 borrowDecimals
  ) internal pure returns (uint) {
    // simpleInterestFactor = borrowRate * blockDelta
    // interestAccumulated = simpleInterestFactor * totalBorrows
    // newTotalBorrows = interestAccumulated + totalBorrows
    uint simpleInterestFactor = borrowRatePerBlock * countBlocks;

    // Replace rmul(simpleInterestFactor, borrowedAmount) by ordinal mul and take into account /1e18
    return  AppUtils.toMantissa(
      simpleInterestFactor * borrowedAmount,
      borrowDecimals,
      18 // not 36 because we replaced rmul by mul
    );
  }

  ///////////////////////////////////////////////////////
  //         Estimate borrow rate
  ///////////////////////////////////////////////////////

  /// @notice Estimate value of variable borrow rate after borrowing {amountToBorrow_}
  ///         Rewards are not taken into account
  function getEstimatedBorrowRate(
    IDForceInterestRateModel interestRateModel_,
    IDForceCToken cTokenBorrow_,
    uint amountToBorrow_
  ) internal view returns (uint) {
    console.log("getEstimatedBorrowRate");
    console.log("interestRateModel_", address(interestRateModel_));
    console.log("cTokenBorrow_.getCash()", cTokenBorrow_.getCash());
    console.log("amountToBorrow_", amountToBorrow_);
    console.log("cTokenBorrow_.totalBorrows()", cTokenBorrow_.totalBorrows() );
    return interestRateModel_.getBorrowRate(
      cTokenBorrow_.getCash() - amountToBorrow_,
      cTokenBorrow_.totalBorrows() + amountToBorrow_,
      cTokenBorrow_.totalReserves()
    );
  }

  /// @notice Estimate value of variable borrow rate after borrowing {amountToBorrow_}
  ///         Rewards are not taken into account
  function getEstimatedBorrowRatePure(
    IDForceInterestRateModel interestRateModel_,
    IDForceCToken cTokenBorrow_,
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

  function getEstimatedSupplyRate(
    IDForceCToken cTokenCollateral_,
    uint amountToSupply_
  ) internal view returns(uint) {
    return getEstimatedSupplyRatePure(
      cTokenCollateral_.totalSupply(),
      amountToSupply_,
      cTokenCollateral_.getCash(),
      cTokenCollateral_.totalBorrows(),
      cTokenCollateral_.totalReserves(),
      IDForceInterestRateModel(cTokenCollateral_.interestRateModel()),
      cTokenCollateral_.reserveRatio(),
      cTokenCollateral_.exchangeRateStored()
    );
  }

  /// @dev repeats LendingContractsV2, iToken.sol, supplyRatePerBlock() impl
  function getEstimatedSupplyRatePure(
    uint totalSupply_,
    uint amountToSupply_,
    uint cash_,
    uint totalBorrows_,
    uint totalReserves_,
    IDForceInterestRateModel interestRateModel_,
    uint reserveRatio_,
    uint currentExchangeRate_
  ) internal view returns(uint) {
    uint totalSupply = totalSupply_ + amountToSupply_ * 10**18 / currentExchangeRate_;

    uint exchangeRateInternal = getEstimatedExchangeRate(
      totalSupply,
      cash_ + amountToSupply_, // cash is increased exactly on amountToSupply_, no approximation here
      totalBorrows_,
      totalReserves_
    );

    uint underlyingScaled = totalSupply * exchangeRateInternal;
    if (underlyingScaled == 0) return 0;

    uint borrowRatePerBlock = interestRateModel_.getBorrowRate(
      cash_ + amountToSupply_,
      totalBorrows_,
      totalReserves_
    );

    return tmul(
      borrowRatePerBlock,
      1e18 - reserveRatio_,
      rdiv(totalBorrows_ * 1e18, underlyingScaled)
    );
  }

  function getEstimatedExchangeRate(
    uint totalSupply_,
    uint cash_,
    uint totalBorrows_,
    uint totalReserves_
  ) internal pure returns (uint) {
    return totalSupply_ == 0
    ? 0
    : rdiv(cash_ + totalBorrows_ - totalReserves_, totalSupply_);
  }

  ///////////////////////////////////////////////////////
  ///                 Utils to inline
  ///////////////////////////////////////////////////////
  function getPrice(IDForcePriceOracle priceOracle, address token) internal view returns (uint) {
    (uint price, bool isPriceValid) = priceOracle.getUnderlyingPriceAndStatus(token);
    require(price != 0 && isPriceValid, AppErrors.ZERO_PRICE);
    return price;
  }

  ///////////////////////////////////////////////////////
  ///  Math utils, see LendingContractsV2, SafeRatioMath.sol
  ///////////////////////////////////////////////////////

  function rmul(uint x, uint y) internal pure returns (uint) {
    return x * y / 10**18;
  }

  function rdiv(uint x, uint y) internal pure returns (uint) {
    require(y != 0, AppErrors.DIVISION_BY_ZERO);
    return x * 10**18 / y;
  }

  function divup(uint x, uint y) internal pure returns (uint) {
    require(y != 0, AppErrors.DIVISION_BY_ZERO);
    return (x + y - 1) / y;
  }

  function tmul(uint256 x, uint256 y, uint256 z) internal pure returns (uint256 result) {
    result = x * y * z / 10**36;
  }
}