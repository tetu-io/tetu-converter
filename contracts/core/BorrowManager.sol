// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../libs/AppDataTypes.sol";
import "../libs/AppErrors.sol";
import "../libs/AppUtils.sol";
import "../openzeppelin/Clones.sol";
import "../openzeppelin/IERC20.sol";
import "../openzeppelin/SafeERC20.sol";
import "../openzeppelin/EnumerableSet.sol";
import "../openzeppelin/EnumerableMap.sol";
import "../openzeppelin/IERC20Metadata.sol";
import "../interfaces/IPlatformAdapter.sol";
import "../interfaces/IBorrowManager.sol";
import "../interfaces/IPriceOracle.sol";
import "../interfaces/IDebtMonitor.sol";
import "../interfaces/ITetuConverter.sol";
import "../integrations/market/ICErc20.sol";
import "../proxy/ControllableV3.sol";
import "../interfaces/IPoolAdapter.sol";
import "../libs/ConverterLogicLib.sol";
import "../libs/EntryKinds.sol";

/// @notice Contains list of lending pools. Allow to select most efficient pool for the given collateral/borrow pair
contract BorrowManager is IBorrowManager, ControllableV3 {
  using SafeERC20 for IERC20;
  using AppUtils for uint;
  using Clones for address;
  using EnumerableSet for EnumerableSet.AddressSet;
  using EnumerableSet for EnumerableSet.UintSet;
  using EnumerableMap for EnumerableMap.UintToAddressMap;

  //region ----------------------------------------------------- Constants
  string public constant BORROW_MANAGER_VERSION = "1.0.0";
  /// @notice Reward APR is taken into account with given factor
  ///         Result APR = borrow-apr - supply-apr - Factor/Denominator * rewards-APR
  uint constant public REWARDS_FACTOR_DENOMINATOR_18 = 1e18;
  //endregion ----------------------------------------------------- Constants

  //region ----------------------------------------------------- Data types

  /// @notice Pair of two assets. Asset 1 can be converted to asset 2 and vice versa.
  /// @dev There are no restrictions for {assetLeft} and {assertRight}. Each can be smaller than the other.
  struct AssetPair {
    address assetLeft;
    address assetRight;
  }

  struct BorrowCandidate {
    address converter;
    uint collateralAmount;
    uint amountToBorrow;
    int apr18;
  }

  struct FindConverterLocal {
    uint len;
    IPlatformAdapter[] platformAdapters;
    uint countCandidates;
    bool needMore;
    uint totalCandidates;
  }
  //endregion ----------------------------------------------------- Data types

  //region ----------------------------------------------------- Variables. Don't change names or ordering!

  /// @notice Reward APR is taken into account with given factor
  /// @dev decimals 18. The value is divided on {REWARDS_FACTOR_DENOMINATOR_18}
  uint public rewardsFactor;

  /// @notice all registered platform adapters
  EnumerableSet.AddressSet private _platformAdapters;

  /// @notice all asset pairs registered for the platform adapter
  /// @dev PlatformAdapter : [key of asset pair]
  mapping(address => EnumerableSet.UintSet) private _platformAdapterPairs;

  /// @notice all platform adapters for which the asset pair is registered
  /// @dev Key of pair asset => [list of platform adapters]
  mapping(uint => EnumerableSet.AddressSet) private _pairsList;

  /// @notice Key of pair asset => Asset pair
  mapping(uint => AssetPair) private _assetPairs;

  /// @notice Default health factors (HF) for assets. Default HF is used if user hasn't provided HF value, decimals 2
  /// @dev asset => Health factor (== collateral / minimum collateral. It should be greater then MIN_HEALTH_FACTOR)
  mapping(address => uint16) public targetHealthFactorsForAssets;

  /// @notice Converter : platform adapter
  mapping(address => address) public converterToPlatformAdapter;

  /// @notice List of pool adapters ready to borrow, i.e. with not-dirty state.
  ///         Any pool adapter with state DIRTY is removed from this list as soon as its dirty-state is detected.
  /// @dev user => PoolAdapterKey(== keccak256(converter, collateral, borrowToken)) => address of the pool adapter
  mapping (address => EnumerableMap.UintToAddressMap) private _poolAdapters;

  /// @notice Pool adapter => (1 + index of the pool adapter in {listPoolAdapters})
  /// @dev This list contains info for all ever created pool adapters (both for not-dirty and dirty ones).
  mapping (address => uint) public poolAdaptersRegistered;

  /// @notice List of addresses of all ever created pool adapters (both for not-dirty and dirty ones).
  /// @dev Allow to get full list of the pool adapter and then filter it by any criteria (asset, user, state, etc)
  address[] public listPoolAdapters;
  //endregion ----------------------------------------------------- Variables. Don't change names or ordering!

  //region ----------------------------------------------------- Events
  event OnSetTargetHealthFactors(address[] assets, uint16[] healthFactors2);
  event OnSetRewardsFactor(uint rewardsFactor);
  event OnAddAssetPairs(address platformAdapter, address[] leftAssets, address[] rightAssets);
  event OnRemoveAssetPairs(address platformAdapter, address[] leftAssets, address[] rightAssets);
  event OnUnregisterPlatformAdapter(address platformAdapter);
  event OnRegisterPoolAdapter(address poolAdapter, address converter, address user, address collateralAsset, address borrowAsset);
  event OnMarkPoolAdapterAsDirty(address poolAdapter);
  //endregion ----------------------------------------------------- Events

  //region ----------------------------------------------------- Initialization

  function init(address controller_, uint rewardsFactor_) external initializer {
    __Controllable_init(controller_);

    // we assume rewards amount should be downgraded in calcs coz liquidation gaps
    require(rewardsFactor_ < REWARDS_FACTOR_DENOMINATOR_18, AppErrors.INCORRECT_VALUE);
    rewardsFactor = rewardsFactor_;
  }
  //endregion ----------------------------------------------------- Initialization

  //region ----------------------------------------------------- Access rights

  /// @notice Ensure that msg.sender is registered pool adapter
  function _onlyTetuConverter() internal view {
    require(
      msg.sender == IConverterController(controller()).tetuConverter(),
      AppErrors.TETU_CONVERTER_ONLY
    );
  }

  /// @notice Ensure that msg.sender is registered pool adapter
  function _onlyGovernance() internal view {
    require(msg.sender == IConverterController(controller()).governance(), AppErrors.GOVERNANCE_ONLY);
  }
  //endregion ----------------------------------------------------- Access rights

  //region ----------------------------------------------------- Configuration

  /// @notice Set target health factors for the assets.
  ///         If target health factor is not assigned to the asset, target-health-factor from controller is used.
  /// @param healthFactors2_ Health factor must be greater then 1, decimals 2
  function setTargetHealthFactors(address[] calldata assets_, uint16[] calldata healthFactors2_) external override {
    _onlyGovernance();
    uint countItems = assets_.length;
    require(countItems == healthFactors2_.length, AppErrors.WRONG_LENGTHS);

    for (uint i = 0; i < countItems; i = i.uncheckedInc()) {
      require(
        healthFactors2_[i] == 0 || healthFactors2_[i] >= IConverterController(controller()).minHealthFactor2(),
        AppErrors.WRONG_HEALTH_FACTOR
      );
      targetHealthFactorsForAssets[assets_[i]] = healthFactors2_[i];
    }

    emit OnSetTargetHealthFactors(assets_, healthFactors2_);
  }

  /// @notice Reward APR is taken into account with given factor
  ///         Result APR = borrow-apr - supply-apr - [REWARD-FACTOR]/Denominator * rewards-APR
  function setRewardsFactor(uint rewardsFactor_) external override {
    _onlyGovernance();
    require(rewardsFactor_ < REWARDS_FACTOR_DENOMINATOR_18, AppErrors.INCORRECT_VALUE);
    rewardsFactor = rewardsFactor_;

    emit OnSetRewardsFactor(rewardsFactor_);
  }

  /// @notice Register new lending platform with available pairs of assets
  ///         OR add new pairs of assets to the exist lending platform
  /// @param platformAdapter_ Implementation of IPlatformAdapter attached to the specified pool
  /// @param leftAssets_  Supported pairs of assets. The pairs are set using two arrays: left and right
  /// @param rightAssets_  Supported pairs of assets. The pairs are set using two arrays: left and right
  function addAssetPairs(
    address platformAdapter_,
    address[] calldata leftAssets_,
    address[] calldata rightAssets_
  ) external override {
    _onlyGovernance();

    uint lenAssets = rightAssets_.length;
    require(leftAssets_.length == lenAssets, AppErrors.WRONG_LENGTHS);

    // register new platform adapter if necessary
    _platformAdapters.add(platformAdapter_);

    // register all available template pool adapters
    address[] memory paConverters = IPlatformAdapter(platformAdapter_).converters();
    uint lenConverters = paConverters.length;
    for (uint i = 0; i < lenConverters; i = i.uncheckedInc()) {
      // the relation "platform adapter - converter" is invariant
      address platformAdapterForConverter = converterToPlatformAdapter[paConverters[i]];
      if (platformAdapter_ != platformAdapterForConverter) {
        require(platformAdapterForConverter == address(0), AppErrors.ONLY_SINGLE_PLATFORM_ADAPTER_CAN_USE_CONVERTER);
        converterToPlatformAdapter[paConverters[i]] = platformAdapter_;
      }
    }

    // register all provided asset pairs
    for (uint i = 0; i < lenAssets; i = i.uncheckedInc()) {
      uint assetPairKey = getAssetPairKey(leftAssets_[i], rightAssets_[i]);
      if (_assetPairs[assetPairKey].assetLeft == address(0)) {
        _assetPairs[assetPairKey] = AssetPair({
          assetLeft: leftAssets_[i],
          assetRight: rightAssets_[i]
        });
      }
      _pairsList[assetPairKey].add(platformAdapter_);
      _platformAdapterPairs[platformAdapter_].add(assetPairKey);
    }

    emit OnAddAssetPairs(platformAdapter_, leftAssets_, rightAssets_);
  }

  /// @notice Remove available pairs of asset from the platform adapter.
  ///         The platform adapter will be unregistered after removing last supported pair of assets
  function removeAssetPairs(
    address platformAdapter_,
    address[] calldata leftAssets_,
    address[] calldata rightAssets_
  ) external override {
    _onlyGovernance();

    uint lenAssets = rightAssets_.length;
    require(leftAssets_.length == lenAssets, AppErrors.WRONG_LENGTHS);
    require(_platformAdapters.contains(platformAdapter_), AppErrors.PLATFORM_ADAPTER_NOT_FOUND);
    IDebtMonitor debtMonitor = IDebtMonitor(IConverterController(controller()).debtMonitor());

    // unregister the asset pairs
    for (uint i; i < lenAssets; i = i.uncheckedInc()) {
      uint assetPairKey = getAssetPairKey(leftAssets_[i], rightAssets_[i]);
      _pairsList[assetPairKey].remove(platformAdapter_);
      _platformAdapterPairs[platformAdapter_].remove(assetPairKey);
    }

    // if platform adapter doesn't have any asset pairs, we unregister it
    if (_platformAdapterPairs[platformAdapter_].length() == 0) {
      // unregister all template pool adapters
      address[] memory paConverters = IPlatformAdapter(platformAdapter_).converters();
      uint lenConverters = paConverters.length;
      for (uint i; i < lenConverters; i = i.uncheckedInc()) {
        // If there is active pool adapter for the platform adapter, we cannot unregister the platform adapter
        require(!debtMonitor.isConverterInUse(paConverters[i]), AppErrors.PLATFORM_ADAPTER_IS_IN_USE);
        converterToPlatformAdapter[paConverters[i]] = address(0);
      }

      // unregister platform adapter
      _platformAdapters.remove(platformAdapter_);
      emit OnUnregisterPlatformAdapter(platformAdapter_);
    }

    emit OnRemoveAssetPairs(platformAdapter_, leftAssets_, rightAssets_);
  }
  //endregion ----------------------------------------------------- Configuration

  //region ----------------------------------------------------- Find best pool for borrowing

  /// @inheritdoc IBorrowManager
  function findConverter(
    bytes memory entryData_,
    address user_,
    address sourceToken_,
    address targetToken_,
    uint amountIn_,
    uint periodInBlocks_
  ) external view override returns (
    address[] memory convertersOut,
    uint[] memory collateralAmountsOut,
    uint[] memory amountsToBorrowOut,
    int[] memory aprs18Out
  ) {
    AppDataTypes.InputConversionParams memory params = AppDataTypes.InputConversionParams({
    collateralAsset: sourceToken_,
    borrowAsset: targetToken_,
    amountIn: amountIn_,
    countBlocks: periodInBlocks_,
    entryData: entryData_,
    user: user_
    });
    return _findConverter(params);
  }

  /// @notice Find lending pool capable of providing {targetAmount} and having best normalized borrow rate
  ///         Results are ordered in ascending order of APR, so the best available converter is first one.
  /// @return convertersOut Result template-pool-adapters
  /// @return collateralAmountsOut Amounts that should be provided as a collateral
  /// @return amountsToBorrowOut Amounts that should be borrowed
  /// @return aprs18Out Annual Percentage Rates == (total cost - total income) / amount of collateral, decimals 18
  function _findConverter(AppDataTypes.InputConversionParams memory p_) internal view returns (
    address[] memory convertersOut,
    uint[] memory collateralAmountsOut,
    uint[] memory amountsToBorrowOut,
    int[] memory aprs18Out
  ) {
    FindConverterLocal memory v;

    // get all platform adapters that support required pair of assets
    EnumerableSet.AddressSet storage pas = _pairsList[getAssetPairKey(p_.collateralAsset, p_.borrowAsset)];
    v.len = pas.length();
    v.platformAdapters = new IPlatformAdapter[](v.len);
    for (uint i; i < v.len; i = i.uncheckedInc()) {
      v.platformAdapters[i] = IPlatformAdapter(pas.at(i));
    }

    BorrowCandidate[] memory candidates = new BorrowCandidate[](v.len);

    // find all exist valid debts and calculate how to make new borrow with rebalancing of the exist debt
    // add BorrowCandidate to {candidates} for such debts and clear up corresponded items in {platformAdapters}
    (v.countCandidates, v.needMore) = findExistDebtsToRebalance(v.platformAdapters, p_, candidates);
    v.totalCandidates = (v.needMore && v.len != 0)
      // find borrow-candidates for all other platform adapters
      ? _findPoolsForNewDebt(
        v.platformAdapters,
        v.countCandidates,
        p_,
        getTargetHealthFactor2(p_.collateralAsset),
        candidates
      )
      : v.countCandidates;

    return prepareFindConverterResults(v.countCandidates, v.totalCandidates, candidates);
  }

  /// @notice Copy {data_} to output arrays
  ///         First {countDebts_} contain data for exist debts, they are copied as is
  ///         Other part of {data_} is at first ordered by apr and then the data are copied to output arrays
  /// @param countDebts_ Count items of {data_} corresponded to the exist debts
  /// @param count_ Total count of valid items in {data_}
  /// @param convertersOut Array with size equal to {count_}
  ///                      First {countDebts_} contains data for the exist debts
  ///                      All other items contains data for new positions that can be opened. These items are ordered by APR.
  function prepareFindConverterResults(uint countDebts_, uint count_, BorrowCandidate[] memory data_) internal view returns (
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
      for (uint i = 0; i < countNewPos; i = AppUtils.uncheckedInc(i)) {
        aprs[i] = data_[countDebts_ + i].apr18;
      }
      uint[] memory indices = AppUtils._sortAsc(countNewPos, aprs);

      for (uint i = 0; i < count_; i = AppUtils.uncheckedInc(i)) {
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
  function findExistDebtsToRebalance(
    IPlatformAdapter[] memory platformAdapters,
    AppDataTypes.InputConversionParams memory p_,
    BorrowCandidate[] memory dest
  ) internal view returns (
    uint count,
    bool needMore
  ) {
    needMore = true;
    uint len = platformAdapters.length;
    uint index;
    uint usedAmountIn;
    uint16 targetHealthFactor2 = getTargetHealthFactor2(p_.collateralAsset);
    while (index < len) {
      address poolAdapter;
      (index, poolAdapter) = getExistValidPoolAdapter(platformAdapters, index, p_.user, p_.collateralAsset, p_.borrowAsset);
      if (poolAdapter != address(0)) {
        BorrowCandidate memory c;
        (c, usedAmountIn) = _findPoolsForExistDebt(
          IPoolAdapter(poolAdapter),
          platformAdapters[index],
          p_,
          targetHealthFactor2,
          usedAmountIn
        );
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
  function getExistValidPoolAdapter(
    IPlatformAdapter[] memory platformAdapters_,
    uint index0_,
    address user_,
    address collateralAsset_,
    address borrowAsset_
  ) internal view returns (
    uint indexPlatformAdapter,
    address poolAdapter
  ) {
    IConverterController _controller = IConverterController(controller());
    uint lenPools = platformAdapters_.length;

    for (uint i = index0_; i < lenPools; i = i.uncheckedInc()) {
      IPlatformAdapter pa = platformAdapters_[i];
      address[] memory converters = pa.converters();
      uint lenConverters = converters.length;
      for (uint j; j < lenConverters; j = j.uncheckedInc()) {
        poolAdapter = _getPoolAdapter(converters[j], user_, collateralAsset_, borrowAsset_);
        if (poolAdapter != address(0)) {
          ConverterLogicLib.HealthStatus status = ConverterLogicLib.getHealthStatus(
            IPoolAdapter(poolAdapter),
            _controller.minHealthFactor2()
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
    uint16 targetHealthFactor2_,
    uint usedAmountIn0
  ) internal view returns (
    BorrowCandidate memory dest,
    uint usedAmountInFinal
  ) {
    (uint collateralAmount, uint amountToPay, uint healthFactor18,,,) = poolAdapter_.getStatus();

    (
      int requiredBorrowAssetAmount,
      int requiredCollateralAssetAmount
    ) = ConverterLogicLib.getRebalanceAmounts(targetHealthFactor2_ * 1e16, collateralAmount, amountToPay, healthFactor18);


    // the user already has a debt with same collateral+borrow assets
    // so, we should use same pool adapter for new borrow AND rebalance exist debt in both directions if necessary
    // There is a chance, that selected platform doesn't have enough amount to borrow, the collateral will be used partially.
    // There is a case when we cannot make full rebalance of exist debt
    // (i.e. new borrow amount is too small). Partial rebalance should be made in this case.
    AppDataTypes.ConversionPlan memory plan = getPlanWithRebalancing(
      platformAdapter_,
      p_,
      targetHealthFactor2_,
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
          apr18: _getApr18(plan, rewardsFactor) // todo cache rewardsFactor
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

  function getPlanWithRebalancing(
    IPlatformAdapter platformAdapter_,
    AppDataTypes.InputConversionParams memory p_,
    uint16 targetHealthFactor2_,
    int requiredCollateralAssetAmount,
    int requiredBorrowAssetAmount
  ) internal view returns (
    AppDataTypes.ConversionPlan memory plan
  ) {
    AppDataTypes.InputConversionParams memory input = AppDataTypes.InputConversionParams({
      collateralAsset: p_.collateralAsset,
      borrowAsset: p_.borrowAsset,
      user: p_.user,
      entryData: p_.entryData,
      countBlocks: p_.countBlocks,
      amountIn: p_.amountIn // todo
    });
    plan = platformAdapter_.getConversionPlan(p_, targetHealthFactor2_);
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
    uint16 healthFactor2_,
    BorrowCandidate[] memory dest_
  ) internal view returns (
    uint totalCount
  ) {
    totalCount = startDestIndex_;

    uint len = platformAdapters_.length;
    uint _rewardsFactor = rewardsFactor; // todo move to params

    for (uint i; i < len; i = i.uncheckedInc()) {
      AppDataTypes.ConversionPlan memory plan = platformAdapters_[i].getConversionPlan(p_, healthFactor2_);

      if (plan.converter != address(0)) {
        dest_[totalCount++] = BorrowCandidate({
          apr18: _getApr18(plan, _rewardsFactor),
          amountToBorrow: plan.amountToBorrow,
          collateralAmount: plan.collateralAmount,
          converter: plan.converter
        });
      }
    }
  }
  //endregion ----------------------------------------------------- Find new lending platforms to borrow

  //region ----------------------------------------------------- Minimal proxy creation

  /// @notice Register a pool adapter for (pool, user, collateral) if the adapter wasn't created before
  /// @param user_ Address of the caller contract who requires access to the pool adapter
  /// @return Address of registered pool adapter
  function registerPoolAdapter(
    address converter_,
    address user_,
    address collateralAsset_,
    address borrowAsset_
  ) external override returns (address) {
    _onlyTetuConverter();

    uint poolAdapterKey = getPoolAdapterKey(converter_, collateralAsset_, borrowAsset_);
    (bool found, address dest) = _poolAdapters[user_].tryGet(poolAdapterKey);
    if (! found) {
      // pool adapter is not yet registered
      // create a new instance of the pool adapter using minimal proxy pattern, initialize newly created contract
      dest = converter_.clone();
      IPlatformAdapter(getPlatformAdapter(converter_)).initializePoolAdapter(
        converter_,
        dest,
        user_,
        collateralAsset_,
        borrowAsset_
      );

      // register newly created pool adapter in the list of the pool adapters
      _poolAdapters[user_].set(poolAdapterKey, dest);
      uint index = listPoolAdapters.length;
      poolAdaptersRegistered[dest] = index + 1;
      listPoolAdapters.push(dest);

      emit OnRegisterPoolAdapter(dest, converter_, user_, collateralAsset_, borrowAsset_);
    }

    return dest;
  }

  /// @notice Notify borrow manager that the pool adapter with the given params is "dirty".
  ///         The pool adapter should be excluded from the list of ready-to-borrow pool adapters.
  /// @dev "Dirty" means that a liquidation happens inside. The borrow position should be closed during health checking.
  function markPoolAdapterAsDirty(address converter_, address user_, address collateral_, address borrowToken_) external override {
    IConverterController _controller = IConverterController(controller()); // gas saving
    require(
      msg.sender == _controller.tetuConverter() || msg.sender == _controller.debtMonitor(),
      AppErrors.ACCESS_DENIED
    );
    uint key = getPoolAdapterKey(converter_, collateral_, borrowToken_);

    (bool found, address poolAdapter) = _poolAdapters[user_].tryGet(key);
    require(found, AppErrors.POOL_ADAPTER_NOT_FOUND);

    // Dirty pool adapter is removed from _poolAdapters, so it will never be used for new borrows
    _poolAdapters[user_].remove(key);

    emit OnMarkPoolAdapterAsDirty(poolAdapter);
  }
  //endregion ----------------------------------------------------- Minimal proxy creation

  //region ----------------------------------------------------- Getters - pool adapters

  /// @dev Returns true for NORMAL pool adapters and for active DIRTY pool adapters (=== borrow position is opened).
  function isPoolAdapter(address poolAdapter_) external view override returns (bool) {
    return poolAdaptersRegistered[poolAdapter_] != 0;
  }

  /// @notice Get pool adapter or 0 if the pool adapter is not registered
  function getPoolAdapter(
    address converter_,
    address user_,
    address collateral_,
    address borrowToken_
  ) external view override returns (address) {
    return _getPoolAdapter(converter_, user_, collateral_, borrowToken_);
  }

  /// @notice Get pool adapter or 0 if the pool adapter is not registered
  function _getPoolAdapter(
    address converter_,
    address user_,
    address collateral_,
    address borrowToken_
  ) internal view returns (address) {
    (bool found, address dest) = _poolAdapters[user_].tryGet(getPoolAdapterKey(converter_, collateral_, borrowToken_));
    return found ? dest : address(0);
  }
  //endregion ----------------------------------------------------- Getters - pool adapters

  //region ----------------------------------------------------- Getters - platform adapters

  /// @notice Get platformAdapter to which the converter belongs
  function getPlatformAdapter(address converter_) public view override returns (address) {
    address platformAdapter = converterToPlatformAdapter[converter_];
    require(platformAdapter != address(0), AppErrors.PLATFORM_ADAPTER_NOT_FOUND);
    return platformAdapter;
  }
  //endregion ----------------------------------------------------- Getters - platform adapters

  //region ----------------------------------------------------- Getters - health factor

  /// @notice Return target health factor with decimals 2 for the asset
  ///         If there is no custom value for asset, target health factor from the controller should be used
  function getTargetHealthFactor2(address asset_) public view override returns (uint16) {
    uint16 dest = targetHealthFactorsForAssets[asset_];
    return dest == 0
      ? IConverterController(controller()).targetHealthFactor2()
      : dest;
  }
  //endregion ----------------------------------------------------- Getters - health factor

  //region ----------------------------------------------------- keccak256 keys

  function getPoolAdapterKey(address converter_,
    address collateral_,
    address borrowToken_
  ) public pure returns (uint){
    return uint(keccak256(abi.encodePacked(converter_, collateral_, borrowToken_)));
  }

  function getAssetPairKey(address assetLeft_, address assetRight_) public pure returns (uint) {
    return assetLeft_ < assetRight_
      ? uint(keccak256(abi.encodePacked(assetLeft_, assetRight_)))
      : uint(keccak256(abi.encodePacked(assetRight_, assetLeft_)));
  }
  //endregion ----------------------------------------------------- keccak256 keys

  //region ----------------------------------------------------- Access to arrays

  function platformAdaptersLength() public view override returns (uint) {
    return _platformAdapters.length();
  }

  function platformAdaptersAt(uint index) public view override returns (address) {
    return _platformAdapters.at(index);
  }

  function pairsListLength(address token1, address token2) public view returns (uint) {
    return _pairsList[getAssetPairKey(token1, token2)].length();
  }

  function pairsListAt(address token1, address token2, uint index) public view returns (address) {
    return _pairsList[getAssetPairKey(token1, token2)].at(index);
  }

  function platformAdapterPairsLength(address platformAdapter_) public view returns (uint) {
    return _platformAdapterPairs[platformAdapter_].length();
  }

  function platformAdapterPairsAt(address platformAdapter_, uint index) public view returns (AssetPair memory) {
    return _assetPairs[_platformAdapterPairs[platformAdapter_].at(index)];
  }

  function listPoolAdaptersLength() public view returns (uint) {
    return listPoolAdapters.length;
  }
  //endregion ----------------------------------------------------- Access to arrays

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
