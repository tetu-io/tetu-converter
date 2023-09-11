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
import "../libs/BorrowManagerLogicLib.sol";

/// @notice Contains list of lending pools. Allow to select most efficient pool for the given collateral/borrow pair
contract BorrowManager is IBorrowManager, ControllableV3 {
  using SafeERC20 for IERC20;
  using AppUtils for uint;
  using Clones for address;
  using EnumerableSet for EnumerableSet.AddressSet;
  using EnumerableSet for EnumerableSet.UintSet;
  using EnumerableMap for EnumerableMap.UintToAddressMap;

  //region ----------------------------------------------------- Constants
  string public constant BORROW_MANAGER_VERSION = "1.0.1";
  //endregion ----------------------------------------------------- Constants

  //region ----------------------------------------------------- Data types

  /// @notice Pair of two assets. Asset 1 can be converted to asset 2 and vice versa.
  /// @dev There are no restrictions for {assetLeft} and {assertRight}. Each can be smaller than the other.
  struct AssetPair {
    address assetLeft;
    address assetRight;
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
    require(rewardsFactor_ < BorrowManagerLogicLib.REWARDS_FACTOR_DENOMINATOR_18, AppErrors.INCORRECT_VALUE);
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
    require(rewardsFactor_ < BorrowManagerLogicLib.REWARDS_FACTOR_DENOMINATOR_18, AppErrors.INCORRECT_VALUE);
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
    BorrowManagerLogicLib.InputParamsAdditional memory addParams = BorrowManagerLogicLib.InputParamsAdditional({
      rewardsFactor: rewardsFactor,
      targetHealthFactor2: getTargetHealthFactor2(sourceToken_),
      controller: IConverterController(controller())
    });
    return BorrowManagerLogicLib.findConverter(
      params,
      addParams,
      _pairsList[getAssetPairKey(sourceToken_, targetToken_)]
    );
  }
  //endregion ----------------------------------------------------- Find best pool for borrowing

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
}
