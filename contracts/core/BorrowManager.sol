// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "./AppDataTypes.sol";
import "./AppErrors.sol";
import "../core/AppUtils.sol";
import "../interfaces/IPlatformAdapter.sol";
import "../interfaces/IBorrowManager.sol";
import "../interfaces/IPriceOracle.sol";
import "../interfaces/IController.sol";
import "../interfaces/IDebtsMonitor.sol";
import "../openzeppelin/Clones.sol";
import "../openzeppelin/IERC20.sol";
import "../openzeppelin/SafeERC20.sol";
import "../openzeppelin/EnumerableSet.sol";
import "../integrations/market/ICErc20.sol";
import "../integrations/IERC20Extended.sol";
import "hardhat/console.sol";

/// @notice Contains list of lending pools. Allow to select most efficient pool for the given collateral/borrow pair
contract BorrowManager is IBorrowManager {
  using SafeERC20 for IERC20;
  using AppUtils for uint;
  using Clones for address;
  using EnumerableSet for EnumerableSet.AddressSet;
  using EnumerableSet for EnumerableSet.UintSet;

  /// @notice Reward APR is taken into account with given factor
  ///         Result APR = borrow-apr - supply-apr - Factor/Denominator * rewards-APR
  uint constant public REWARDS_FACTOR_18 = 5e17;
  uint constant public REWARDS_FACTOR_DENOMINATOR_18 = 1e18;

  IController public immutable controller;

  ///////////////////////////////////////////////////////
  ///                Structs and enums
  ///////////////////////////////////////////////////////

  /// @dev Additional input params for _findPool; 18 means that decimals 18 is used
  struct BorrowInput {
    uint8 targetDecimals;
    /// @notice collateral, borrow (to get prices)
    address[] assets;
    uint sourceAmount;
  }

  /// @notice Pair of two assets. Asset 1 can be converted to asset 2 and vice versa.
  /// @dev There are no restrictions for {assetLeft} and {assertRight}. Each can be smaller than the other.
  struct AssetPair {
    address assetLeft;
    address assetRight;
  }

  ///////////////////////////////////////////////////////
  ///                    Members
  ///////////////////////////////////////////////////////

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

  /// @notice Converter : platform adapter
  mapping(address => address) public converterToPlatformAdapter;

  /// @notice Complete list ever created pool adapters
  /// @dev PoolAdapterKey(== keccak256(converter, user, collateral, borrowToken)) => address of the pool adapter
  mapping (uint => address) public poolAdapters;

  /// @notice Pool adapter => is registered
  mapping (address => bool) poolAdaptersRegistered;

  /// @notice Default health factors (HF) for assets. Default HF is used if user hasn't provided HF value, decimals 2
  /// @dev Health factor = collateral / minimum collateral. It should be greater then MIN_HEALTH_FACTOR
  mapping(address => uint16) public defaultHealthFactors2;


  ///////////////////////////////////////////////////////
  ///               Initialization
  ///////////////////////////////////////////////////////

  constructor (address controller_) {
    require(controller_ != address(0), AppErrors.ZERO_ADDRESS);
    controller = IController(controller_);
  }


  ///////////////////////////////////////////////////////
  ///               Configuration
  ///////////////////////////////////////////////////////

  /// @notice Set default health factor for {asset}. Default value is used only if user hasn't provided custom value
  /// @param healthFactor_ Health factor with decimals 2; must be greater or equal to MIN_HEALTH_FACTOR; for 1.5 use 150
  function setHealthFactor(address asset, uint16 healthFactor_) external override {
    require(healthFactor_ >= controller.getMinHealthFactor2(), AppErrors.WRONG_HEALTH_FACTOR);
    defaultHealthFactors2[asset] = healthFactor_;
  }

  function addAssetPairs(
    address platformAdapter_,
    address[] calldata leftAssets_,
    address[] calldata rightAssets_
  )
  external override {
    uint lenAssets = rightAssets_.length;
    require(leftAssets_.length == lenAssets, AppErrors.WRONG_LENGTHS);

    // register new platform adapter if necessary
    if (!_platformAdapters.contains(platformAdapter_)) {
      _platformAdapters.add(platformAdapter_);
    }

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
      if (!_pairsList[assetPairKey].contains(platformAdapter_)) {
        _pairsList[assetPairKey].add(platformAdapter_);
        _platformAdapterPairs[platformAdapter_].add(assetPairKey);
      }
    }
  }

  function removeAssetPairs(
    address platformAdapter_,
    address[] calldata leftAssets_,
    address[] calldata rightAssets_
  ) external override {
    uint lenAssets = rightAssets_.length;
    require(leftAssets_.length == lenAssets, AppErrors.WRONG_LENGTHS);
    require(_platformAdapters.contains(platformAdapter_), AppErrors.PLATFORM_ADAPTER_NOT_FOUND);

    // unregister the asset pairs
    for (uint i = 0; i < lenAssets; i = i.uncheckedInc()) {
      uint assetPairKey = getAssetPairKey(leftAssets_[i], rightAssets_[i]);
      if (_pairsList[assetPairKey].contains(platformAdapter_)) {
        _pairsList[assetPairKey].remove(platformAdapter_);
        _platformAdapterPairs[platformAdapter_].remove(assetPairKey);
      }
    }

    // if platform adapter doesn't have any asset pairs, we unregister it
    if (_platformAdapterPairs[platformAdapter_].length() == 0) {
      // unregister all template pool adapters
      address[] memory paConverters = IPlatformAdapter(platformAdapter_).converters();
      uint lenConverters = paConverters.length;
      for (uint i = 0; i < lenConverters; i = i.uncheckedInc()) {
        // If there is active pool adapter for the platform adapter, we cannot unregister the platform adapter
        require(!_debtMonitor().isConverterInUse(paConverters[i]), AppErrors.PLATFORM_ADAPTER_IS_IN_USE);
        converterToPlatformAdapter[paConverters[i]] = address(0);
      }

      // unregister platform adapter
      _platformAdapters.remove(platformAdapter_);
    }
  }

  ///////////////////////////////////////////////////////
  ///           Find best pool for borrowing
  /// Input params:
  /// Health factor = HF [-], Collateral amount = C [USD]
  /// Source amount that can be used for the collateral = SA [SA], Borrow amount = BS [USD]
  /// Price of the source amount = PS [USD/SA] (1 [SA] = PS[USD])
  /// Price of the target amount = PT [USD/TA] (1 [TA] = PT[USD])
  /// Pool params: Collateral factor of the pool = PCF [-], Available cash in the pool = PTA [TA]
  ///
  /// C = SA * PS, CM = C / HF, BS = CM * PCF
  /// Max target amount capable to be borrowed: ResultTA = BS / PT [TA].
  /// We can use the pool only if ResultTA >= PTA >= TA
  ///////////////////////////////////////////////////////

  function findConverter(AppDataTypes.InputConversionParams memory p_) external view override returns (
    address converter,
    uint maxTargetAmount,
    int aprForPeriod36
  ) {
    // get all available pools
    EnumerableSet.AddressSet storage pas = _pairsList[getAssetPairKey(p_.sourceToken, p_.targetToken )];

    if (p_.healthFactor2 == 0) {
      p_.healthFactor2 = defaultHealthFactors2[p_.targetToken];
    }

    if (p_.healthFactor2 == 0) {
      p_.healthFactor2 = controller.getMinHealthFactor2();
    } else {
      require(p_.healthFactor2 >= controller.getMinHealthFactor2(), AppErrors.WRONG_HEALTH_FACTOR);
    }

    address[] memory assets = new address[](2);
    assets[0] = p_.sourceToken;
    assets[1] = p_.targetToken;

    if (pas.length() != 0) {
      (converter, maxTargetAmount, aprForPeriod36) = _findPool(
        pas,
        p_,
        BorrowInput({
          sourceAmount: p_.sourceAmount,
          targetDecimals: IERC20Extended(p_.targetToken).decimals(),
          assets: assets
        })
      );
    }

    return (converter, maxTargetAmount, aprForPeriod36);
  }

  /// @notice Enumerate all pools and select a pool suitable for borrowing with min borrow rate and enough underlying
  function _findPool(
    EnumerableSet.AddressSet storage platformAdapters_,
    AppDataTypes.InputConversionParams memory p_,
    BorrowInput memory pp_
  ) internal view returns (
    address converter,
    uint maxTargetAmount,
    int apr36
  ) {
    uint lenPools = platformAdapters_.length();

    // borrow-to-amount = borrowAmountFactor18 * (priceCollateral18/priceBorrow18) * liquidationThreshold18 / 1e18
    // Platform-adapters use borrowAmountFactor18 to calculate result borrow-to-amount
    uint borrowAmountFactor18 = 1e18
      * pp_.sourceAmount.toMantissa(uint8(IERC20Extended(pp_.assets[0]).decimals()), 18)
      / (uint(p_.healthFactor2) * 10**(18-2));

    for (uint i = 0; i < lenPools; i = i.uncheckedInc()) {
      AppDataTypes.ConversionPlan memory plan = IPlatformAdapter(platformAdapters_.at(i)).getConversionPlan(
        p_.sourceToken,
        pp_.sourceAmount,
        p_.targetToken,
        borrowAmountFactor18,
        p_.periodInBlocks
      );

      // combine three found APRs to single one
      int planApr36 = int(plan.borrowApr36)
        - int(plan.supplyAprBt36)
        - int(plan.rewardsAmountBt36 / p_.periodInBlocks);

      if (plan.converter != address(0)) {
        // check if we are able to supply required collateral
        if (plan.maxAmountToSupply > p_.sourceAmount) {
          if (converter == address(0) || planApr36 < apr36) {
            // take the pool with lowest APR and with enough liquidity
            if (plan.maxAmountToBorrow >= plan.amountToBorrow) {
              converter = plan.converter;
              maxTargetAmount = plan.amountToBorrow;
              apr36 = planApr36;
            }
          }
        }
      }
    }

    return (converter, maxTargetAmount, apr36);
  }

  ///////////////////////////////////////////////////////
  ///         Minimal proxy creation
  ///////////////////////////////////////////////////////

  /// @notice Register a pool adapter for (pool, user, collateral) if the adapter wasn't created before
  function registerPoolAdapter(
    address converter_,
    address user_,
    address collateral_,
    address borrowToken_
  ) external override returns (address) {
    uint poolAdapterKey = getPoolAdapterKey(converter_, user_, collateral_, borrowToken_);
    address dest = poolAdapters[poolAdapterKey];
    if (dest == address(0) ) {
      // create an instance of the pool adapter using minimal proxy pattern, initialize newly created contract
      dest = converter_.clone();
      IPlatformAdapter(_getPlatformAdapter(converter_)).initializePoolAdapter(
        converter_,
        dest,
        user_,
        collateral_,
        borrowToken_
      );

      // register newly created pool adapter in the list of the pool adapters forever
      poolAdapters[poolAdapterKey] = dest;
      poolAdaptersRegistered[dest] = true;
    }

    return dest;
  }

  ///////////////////////////////////////////////////////
  ///                  Getters
  ///////////////////////////////////////////////////////

  function getPlatformAdapter(address converter_) external view override returns (address) {
    return _getPlatformAdapter(converter_);
  }

  function isPoolAdapter(address poolAdapter_) external view override returns (bool) {
    return poolAdaptersRegistered[poolAdapter_];
  }

  /// @notice Get pool adapter or 0 if the pool adapter is not registered
  function getPoolAdapter(
    address converter_,
    address user_,
    address collateral_,
    address borrowToken_
  ) external view override returns (address) {
    return poolAdapters[getPoolAdapterKey(converter_, user_, collateral_, borrowToken_)];
  }

  function _getPlatformAdapter(address converter_) internal view returns(address) {
    address platformAdapter = converterToPlatformAdapter[converter_];
    require(platformAdapter != address(0), AppErrors.PLATFORM_ADAPTER_NOT_FOUND);
    return platformAdapter;
  }

  ///////////////////////////////////////////////////////
  ///                 keccak256 keys
  ///////////////////////////////////////////////////////

  function getPoolAdapterKey(address converter_,
    address user_,
    address collateral_,
    address borrowToken_
  ) public pure returns (uint){
    return uint(keccak256(abi.encodePacked(converter_, user_, collateral_, borrowToken_)));
  }

  function getAssetPairKey(address assetLeft_, address assetRight_) public pure returns (uint) {
    return assetLeft_ < assetRight_
      ? uint(keccak256(abi.encodePacked(assetLeft_, assetRight_)))
      : uint(keccak256(abi.encodePacked(assetRight_, assetLeft_)));
  }

  ///////////////////////////////////////////////////////
  ///                 Access to arrays
  ///////////////////////////////////////////////////////

  function platformAdaptersLength() public view returns (uint) {
    return _platformAdapters.length();
  }

  function platformAdaptersAt(uint index) public view returns (address) {
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


  ///////////////////////////////////////////////////////
  ///       Inline functions
  ///////////////////////////////////////////////////////
  function _debtMonitor() internal view returns (IDebtMonitor) {
    return IDebtMonitor(controller.debtMonitor());
  }
}