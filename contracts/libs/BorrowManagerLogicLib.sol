// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./AppDataTypes.sol";
import "../openzeppelin/EnumerableSet.sol";
import "../openzeppelin/EnumerableMap.sol";
import "../interfaces/IPlatformAdapter.sol";
import "../interfaces/IConverterController.sol";
import "./ConverterLogicLib.sol";
import "./AppUtils.sol";
import "./EntryKinds.sol";

/// @notice BorrowManager-contract logic-related functions
library BorrowManagerLogicLib {
  using AppUtils for uint;
  using EnumerableSet for EnumerableSet.AddressSet;

  //region ----------------------------------------------------- Constants
  /// @notice Reward APR is taken into account with given factor
  ///         Result APR = borrow-apr - supply-apr - Factor/Denominator * rewards-APR
  uint constant public REWARDS_FACTOR_DENOMINATOR_18 = 1e18;
  //endregion ----------------------------------------------------- Constants

  //region ----------------------------------------------------- Data types
  struct FindConverterLocal {
    uint len;
    IPlatformAdapter[] platformAdapters;
    uint countCandidates;
    bool needMore;
    uint totalCandidates;
  }

  struct BorrowCandidate {
    address converter;
    uint collateralAmount;
    uint amountToBorrow;
    int apr18;
  }

  struct InputParamsAdditional {
    IConverterController controller;

    /// @notice Reward APR is taken into account with given factor, decimals 18.
    uint rewardsFactor;

    /// @notice Target health factor for the {collateralAsset}
    uint16 targetHealthFactor2;
  }

  //endregion ----------------------------------------------------- Data types

  //region ----------------------------------------------------- Find best pool for borrowing
  /// @notice Find lending pool capable of providing {targetAmount} and having best normalized borrow rate
  ///         Results are ordered in ascending order of APR, so the best available converter is first one.
  /// @param pas_ All platform adapters that support required pair of assets
  /// @return convertersOut Result template-pool-adapters
  /// @return collateralAmountsOut Amounts that should be provided as a collateral
  /// @return amountsToBorrowOut Amounts that should be borrowed
  /// @return aprs18Out Annual Percentage Rates == (total cost - total income) / amount of collateral, decimals 18
  function findConverter(
    AppDataTypes.InputConversionParams memory p_,
    InputParamsAdditional memory addParams_,
    EnumerableSet.AddressSet storage pas_
  ) internal view returns (
    address[] memory convertersOut,
    uint[] memory collateralAmountsOut,
    uint[] memory amountsToBorrowOut,
    int[] memory aprs18Out
  ) {
    FindConverterLocal memory v;

    // get all platform adapters that support required pair of assets
    v.len = pas_.length();

    // copy all platform adapters to local array
    v.platformAdapters = new IPlatformAdapter[](v.len);
    for (uint i; i < v.len; i = i.uncheckedInc()) {
      v.platformAdapters[i] = IPlatformAdapter(pas_.at(i));
    }

    BorrowCandidate[] memory candidates = new BorrowCandidate[](v.len);

    // find all exist valid debts and calculate how to make new borrow with rebalancing of the exist debt
    // add BorrowCandidate to {candidates} for such debts and clear up corresponded items in {platformAdapters}
    (v.countCandidates, v.needMore) = _findExistDebtsToRebalance(v.platformAdapters, p_, addParams_, candidates);
    v.totalCandidates = (v.needMore && v.len != 0)
      // find borrow-candidates for all other platform adapters
      ? _findPoolsForNewDebt(v.platformAdapters, v.countCandidates, p_, addParams_, candidates)
      : v.countCandidates;

    return _prepareFindConverterResults(v.countCandidates, v.totalCandidates, candidates);
  }

  /// @notice Copy {data_} to output arrays
  ///         First {countDebts_} contain data for exist debts, they are copied as is
  ///         Other part of {data_} is at first ordered by apr and then the data are copied to output arrays
  /// @param countDebts_ Count items of {data_} corresponded to the exist debts
  /// @param count_ Total count of valid items in {data_}
  /// @param convertersOut Array with size equal to {count_}
  ///                      First {countDebts_} contains data for the exist debts
  ///                      All other items contains data for new positions that can be opened. These items are ordered by APR.
  function _prepareFindConverterResults(
    uint countDebts_,
    uint count_,
    BorrowCandidate[] memory data_
  ) internal pure returns (
    address[] memory convertersOut,
    uint[] memory collateralAmountsOut,
    uint[] memory amountsToBorrowOut,
    int[] memory aprs18Out
  ) {
    if (count_ != 0) {
      // shrink output arrays to {countFoundItems} items and order results in ascending order of APR
      convertersOut = new address[](count_);
      collateralAmountsOut = new uint[](count_);
      amountsToBorrowOut = new uint[](count_);
      aprs18Out = new int[](count_);

      uint countNewPos = count_ - countDebts_;
      int[] memory aprs = new int[](countNewPos);
      for (uint i; i < countNewPos; i = AppUtils.uncheckedInc(i)) {
        aprs[i] = data_[countDebts_ + i].apr18;
      }
      uint[] memory indices = AppUtils._sortAsc(countNewPos, aprs);

      for (uint i; i < count_; i = AppUtils.uncheckedInc(i)) {
        bool existDebt = i < countDebts_;
        convertersOut[i] = data_[existDebt ? i : indices[i - countDebts_]].converter;
        collateralAmountsOut[i] = data_[existDebt ? i : indices[i - countDebts_]].collateralAmount;
        amountsToBorrowOut[i] = data_[existDebt ? i : indices[i - countDebts_]].amountToBorrow;
        aprs18Out[i] = data_[existDebt ? i : indices[i - countDebts_]].apr18;
      }
    }

    return (convertersOut, collateralAmountsOut, amountsToBorrowOut, aprs18Out);
  }
  //endregion ----------------------------------------------------- Find best pool for borrowing

  //region ----------------------------------------------------- Find exist pool adapter to rebalance

  /// @notice Enumerate {platformAdapters}, try to find exist pool adapters, calculate plans for new borrow.
  ///         Each plan should make full/partial rebalance of the debt. Save results to {dest}.
  ///         Reset to zero addresses of platform adapters for all found debts in {platformAdapters}.
  /// @return count Total count of found pool adapters = count of plans saved to {dest}
  /// @return needMore True if all found pool adapters are not able to use whole provided collateral,
  ///                  so new lending platforms should be used in addition
  function _findExistDebtsToRebalance(
    IPlatformAdapter[] memory platformAdapters,
    AppDataTypes.InputConversionParams memory p_,
    InputParamsAdditional memory addParams_,
    BorrowCandidate[] memory dest
  ) internal view returns (
    uint count,
    bool needMore
  ) {
    needMore = true;
    uint len = platformAdapters.length;
    uint index;
    uint usedAmountIn;
    while (index < len) {
      address poolAdapter;
      (index, poolAdapter) = _getExistValidPoolAdapter(platformAdapters, index, p_.user, p_.collateralAsset, p_.borrowAsset, addParams_.controller);
      if (poolAdapter != address(0)) {
        BorrowCandidate memory c;
        (c, usedAmountIn) = _findPoolsForExistDebt(IPoolAdapter(poolAdapter), platformAdapters[index], p_, addParams_, usedAmountIn);
        if (c.converter != address(0)) {
          dest[count++] = c;
          platformAdapters[index] = IPlatformAdapter(address(0));
          if (usedAmountIn >= p_.amountIn) break;
        }
      }

      index++;
    }

    return (count, needMore);
  }

  /// @notice Try to find exist borrow for the given user
  /// @param platformAdapters_ All currently active platform adapters
  /// @param index0_ Start to search from the item of {platformAdapters} with the given index
  /// @param user_ The user who tries to borrow {borrowAsset_} under {collateralAsset_}
  /// @return indexPlatformAdapter Index of the platform adapter to which the {poolAdapter} belongs.
  ///                              The index indicates position of the platform adapter in {platformAdapters}.
  ///                              Return platformAdapters.len if the pool adapter wasn't found.
  /// @return poolAdapter First exist valid pool adapter found for the user-borrowAsset-collateralAsset
  ///                     "valid" means that the pool adapter is not dirty and can be use for new borrows
  function _getExistValidPoolAdapter(
    IPlatformAdapter[] memory platformAdapters_,
    uint index0_,
    address user_,
    address collateralAsset_,
    address borrowAsset_,
    IConverterController controller_
  ) internal view returns (
    uint indexPlatformAdapter,
    address poolAdapter
  ) {
    IBorrowManager borrowManager = IBorrowManager(controller_.borrowManager());
    uint lenPools = platformAdapters_.length;

    for (uint i = index0_; i < lenPools; i = i.uncheckedInc()) {
      IPlatformAdapter pa = platformAdapters_[i];
      address[] memory converters = pa.converters();
      uint lenConverters = converters.length;
      for (uint j; j < lenConverters; j = j.uncheckedInc()) {
        poolAdapter = borrowManager.getPoolAdapter(converters[j], user_, collateralAsset_, borrowAsset_);
        if (poolAdapter != address(0)) {
          ConverterLogicLib.HealthStatus status = ConverterLogicLib.getHealthStatus(
            IPoolAdapter(poolAdapter),
            controller_.minHealthFactor2()
          );
          // todo process REBALANCE_REQUIRED_2, put the pool adapter on the first place in dest

          if (status != ConverterLogicLib.HealthStatus.DIRTY_1) {
            return (i, poolAdapter); // health factor > 1
          } // we are inside a view function, so just skip dirty pool adapters
        }
      }
    }

    return (lenPools, address(0));
  }

  function _findPoolsForExistDebt(
    IPoolAdapter poolAdapter_,
    IPlatformAdapter platformAdapter_,
    AppDataTypes.InputConversionParams memory p_,
    InputParamsAdditional memory addParams_,
    uint usedAmountIn0
  ) internal view returns (
    BorrowCandidate memory dest,
    uint usedAmountInFinal
  ) {
    (uint collateralAmount, uint amountToPay, uint healthFactor18,,,) = poolAdapter_.getStatus();

    (
      int requiredBorrowAssetAmount,
      int requiredCollateralAssetAmount
    ) = ConverterLogicLib.getRebalanceAmounts(addParams_.targetHealthFactor2 * 1e16, collateralAmount, amountToPay, healthFactor18);

    // the user already has a debt with same collateral+borrow assets
    // so, we should use same pool adapter for new borrow AND rebalance exist debt in both directions if necessary
    // There is a chance, that selected platform doesn't have enough amount to borrow, the collateral will be used partially.
    // There is a case when we cannot make full rebalance of exist debt
    // (i.e. new borrow amount is too small). Partial rebalance should be made in this case.
    AppDataTypes.ConversionPlan memory plan = _getPlanWithRebalancing(
      platformAdapter_,
      p_,
      addParams_.targetHealthFactor2,
      requiredCollateralAssetAmount,
      requiredBorrowAssetAmount
    );

    // take only the pool with enough liquidity
    if (plan.converter != address(0) && plan.maxAmountToBorrow > plan.amountToBorrow) {
      return (
        BorrowCandidate({
          converter: plan.converter,
          amountToBorrow: plan.amountToBorrow,
          collateralAmount: plan.collateralAmount,
          apr18: _getApr18(plan, addParams_.rewardsFactor)
        }),
        ((EntryKinds.getEntryKind(p_.entryData) == EntryKinds.ENTRY_KIND_EXACT_BORROW_OUT_FOR_MIN_COLLATERAL_IN_2)
          ? plan.amountToBorrow
          : plan.collateralAmount
        ) + usedAmountIn0 // todo what about case entryKind = 1???
      );
    } else {
      return (dest, 0);
    }
  }

  /// @notice Get conversion plan to borrow required amount + to rebalance exist debt
  /// @param platformAdapter_ Lending platform
  /// @param p_ Params of the borrow
  /// @param targetHealthFactor2_ Target health factor of the collateral asset
  /// @param collateralAmountToFix_ Amount of collateral that is required by lending platform to rebalance exist debt.
  ///                               Positive amount means, that the debt is unhealthy and we need to add more collateral to fix it.
  ///                               Negative amount means, that the debt is too healthy (its health factor > target one)
  ///                               and so we can use exist collateral to borrow more debt.
  /// @param borrowAmountToFix_ TODO
  function _getPlanWithRebalancing(
    IPlatformAdapter platformAdapter_,
    AppDataTypes.InputConversionParams memory p_,
    uint16 targetHealthFactor2_,
    int collateralAmountToFix_,
    int borrowAmountToFix_
  ) internal view returns (
    AppDataTypes.ConversionPlan memory plan
  ) {
    AppDataTypes.InputConversionParams memory input = AppDataTypes.InputConversionParams({
      collateralAsset: p_.collateralAsset,
      borrowAsset: p_.borrowAsset,
      user: p_.user,
      entryData: p_.entryData,
      countBlocks: p_.countBlocks,
      amountIn: p_.amountIn
    });

    uint entryKind = EntryKinds.getEntryKind(p_.entryData);
    if (entryKind == EntryKinds.ENTRY_KIND_EXACT_COLLATERAL_IN_FOR_MAX_BORROW_OUT_0) {
      // amountIn is required collateral amount
      if (collateralAmountToFix_ > 0) {
        // current health factor is unhealthy
      } else {
        // current health factor is TOO healthy
      }

    } else if (entryKind == EntryKinds.ENTRY_KIND_EXACT_PROPORTION_1) {

    } else {
      require(entryKind == EntryKinds.ENTRY_KIND_EXACT_BORROW_OUT_FOR_MIN_COLLATERAL_IN_2, AppErrors.UNSUPPORTED_VALUE);
    }

    plan = platformAdapter_.getConversionPlan(input, targetHealthFactor2_);
  }
  //endregion ----------------------------------------------------- Find exist pool adapter to rebalance

  //region ----------------------------------------------------- Find new lending platforms to borrow
  /// @notice Enumerate all pools suitable for borrowing and enough liquidity.
  /// Assume, that currently the user doesn't have any debts with same collateral+borrow assets pair.
  /// So, the function just finds all available possibilities.
  ///
  /// General explanation how max-target-amount is calculated in all pool adapters:
  /// Health factor = HF [-], Collateral amount = C [USD]
  /// Source amount that can be used for the collateral = SA [SA], Borrow amount = BS [USD]
  /// Price of the source amount = PS [USD/SA] (1 [SA] = PS[USD])
  /// Price of the target amount = PT [USD/TA] (1 [TA] = PT[USD])
  /// Pool params: Collateral factor of the pool = PCF [-], Available cash in the pool = PTA [TA]
  ///
  /// C = SA * PS, BS = C / HF * PCF
  /// Max target amount capable to be borrowed: ResultTA = BS / PT [TA].
  /// We can use the pool only if ResultTA >= PTA >= required-target-amount
  /// @dev We cannot make this function public because storage-param is used
  /// @param platformAdapters_ List of available platform adapters.
  ///                         {startDestIndex} items are 0 in this list, they will be skipped.
  /// @param startDestIndex_ Index of first available position in {dest_}
  /// @param dest_ New position should be saved here starting from {startDestIndex} position
  ///              The length of array is equal to the length of platformAdapters
  /// @return totalCount Count of valid items in dest_, it must be >= startDestIndex
  function _findPoolsForNewDebt(
    IPlatformAdapter[] memory platformAdapters_,
    uint startDestIndex_,
    AppDataTypes.InputConversionParams memory p_,
    InputParamsAdditional memory addParams_,
    BorrowCandidate[] memory dest_
  ) internal view returns (
    uint totalCount
  ) {
    totalCount = startDestIndex_;

    uint len = platformAdapters_.length;

    for (uint i; i < len; i = i.uncheckedInc()) {
      AppDataTypes.ConversionPlan memory plan = platformAdapters_[i].getConversionPlan(p_, addParams_.targetHealthFactor2);

      if (plan.converter != address(0)) {
        dest_[totalCount++] = BorrowCandidate({
          apr18: _getApr18(plan, addParams_.rewardsFactor),
          amountToBorrow: plan.amountToBorrow,
          collateralAmount: plan.collateralAmount,
          converter: plan.converter
        });
      }
    }
  }
  //endregion ----------------------------------------------------- Find new lending platforms to borrow

  //region ----------------------------------------------------- Utils
  function _getApr18(AppDataTypes.ConversionPlan memory plan_, uint rewardsFactor_) public pure returns (int) {
    // combine all costs and incomes and calculate result APR. Rewards are taken with the given weight.
    // Positive value means cost, negative - income
    // APR = (cost - income) / collateralAmount, decimals 18, all amounts are given in terms of borrow asset.
    return (
      int(plan_.borrowCost36)
      - int(plan_.supplyIncomeInBorrowAsset36)
      - int(plan_.rewardsAmountInBorrowAsset36 * rewardsFactor_ / REWARDS_FACTOR_DENOMINATOR_18)
    ) * int(1e18)
      / int(plan_.amountCollateralInBorrowAsset36);
  }

  //endregion ----------------------------------------------------- Utils

}
