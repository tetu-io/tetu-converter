// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "./AppDataTypes.sol";
import "../interfaces/IPlatformAdapter.sol";
import "../integrations/market/ICErc20.sol";
import "../integrations/IERC20Extended.sol";
import "../interfaces/IBorrowManager.sol";
import "../interfaces/IPriceOracle.sol";
import "hardhat/console.sol";
import "../openzeppelin/IERC20.sol";
import "../openzeppelin/SafeERC20.sol";
import "../base/BorrowManagerBase.sol";
import "../interfaces/IPlatformAdapter2.sol";

/// @notice Contains list of lending pools. Allow to select most efficient pool for the given collateral/borrow pair
contract BorrowManager is BorrowManagerBase {
  using SafeERC20 for IERC20;

  ///////////////////////////////////////////////////////
  ///                Structs and enums
  ///////////////////////////////////////////////////////

  /// @dev All input params for _findPool; 18 means that decimals 18 is used
  struct BorrowInput {
    address sourceToken;
    address targetToken;
    uint96 healthFactorWAD;
    uint8 targetDecimals;
    uint sourceAmountWAD;
    uint priceTargetWAD;
    uint priceSourceWAD;
  }

  ///////////////////////////////////////////////////////
  ///                    Members
  ///////////////////////////////////////////////////////

  /// @notice Template pool adapter : platform adapter
  mapping(address => address) platformAdapters;

  /// @notice SourceToken => TargetToken => [list of platform adapters]
  /// @dev SourceToken is always less then TargetToken
  mapping(address => mapping (address => address[])) public pairsList;

  /// @notice Check if triple (source token, target token, pf-adapter) is already registered in {assets}
  mapping(address => mapping (address => mapping (address => bool))) public pairsListRegistered;

  /// @notice Default health factors (HF) for assets. Default HF is used if user hasn't provided HF value, decimals 18
  /// @dev Health factor = collateral / minimum collateral. It should be greater then MIN_HEALTH_FACTOR
  mapping(address => uint) public defaultHealthFactorsWAD;

  ///////////////////////////////////////////////////////
  ///               Initialization
  ///////////////////////////////////////////////////////

  constructor(address controller_)
    BorrowManagerBase(controller_)
  {

  }

  ///////////////////////////////////////////////////////
  ///               Configuration
  ///////////////////////////////////////////////////////

  function addPool(address platformAdapter_, address[] calldata assets_)
  external override {
    address[] memory converters = IPlatformAdapter2(platformAdapter_).converters();
    uint lenConverters = converters.length;
    for (uint i = 0; i < lenConverters; ++i) {
      platformAdapters[converters[i]] = platformAdapter_;
    }

    uint lenAssets = assets_.length;
    for (uint i = 0; i < lenAssets; i = _uncheckedInc(i)) {
      for (uint j = i + 1; j < lenAssets; j = _uncheckedInc(j)) {
        bool inputFirst = assets_[i] < assets_[j];
        address tokenIn = inputFirst ? assets_[i] : assets_[j];
        address tokenOut = inputFirst ? assets_[j] : assets_[i];

        require(!pairsListRegistered[tokenIn][tokenOut][platformAdapter_], "Pair is already registered");

        pairsList[tokenIn][tokenOut].push(platformAdapter_);
        pairsListRegistered[tokenIn][tokenOut][platformAdapter_] = true;
      }
    }
  }

  /// @notice Set default health factor for {asset}. Default value is used only if user hasn't provided custom value
  /// @param value3 Health factor with decimals 3; must be greater or equal to MIN_HEALTH_FACTOR (for 1.5 use 1500)
  function setHealthFactor(address asset, uint16 value3) external override {
    uint hfWAD = value3 * 10**16; //convert decimals 2 to decimals 18
    require(hfWAD > controller.MIN_HEALTH_FACTOR_WAD(), "HF must be > MIN_HF");
    defaultHealthFactorsWAD[asset] = hfWAD;
  }

  ///////////////////////////////////////////////////////
  ///           Find best pool for borrowing
  ///////////////////////////////////////////////////////
  function findPool(AppDataTypes.ExecuteFindPoolParams memory p_) external view override returns (
    address outTemplatePoolAdapter,
    uint outBorrowRate,
    uint outMaxTargetAmount
  ) {
    // Input params:
    // Health factor = HF [-], Collateral amount = C [USD]
    // Source amount that can be used for the collateral = SA [SA}, Borrow amount = BS [USD]
    // Price of the source amount = PS [USD/SA] (1 [SA] = PS[USD])
    // Price of the target amount = PT [USD/TA] (1[TA] = PT[USD]), Available cash in the pool = PTA[TA]
    // Pool params: Collateral factor of the pool = PCF [-], Free cash in the pool = PTA [TA]
    //
    // C = SA * PS, CM = C / HF, BS = CM * PCF
    // Max target amount capable to be borrowed: ResultTA = BS / PT [TA].
    // We can use the pool only if ResultTA >= PTA >= TA

    // get all available pools from poolsForAssets[smaller-address][higher-address]
    address[] memory platformAdapters = pairsList
      [p_.sourceToken < p_.targetToken ? p_.sourceToken : p_.targetToken]
      [p_.sourceToken < p_.targetToken ? p_.targetToken : p_.sourceToken];

    //TODO: check if the source token can be used as collateral
    if (platformAdapters.length != 0) {
      (outTemplatePoolAdapter, outBorrowRate, outMaxTargetAmount) = _findPool(platformAdapters
        , BorrowInput({
          targetToken: p_.targetToken,
          sourceAmount18: _toMantissa(p_.sourceAmount, uint8(IERC20Extended(p_.sourceToken).decimals()), 18),
          healthFactor18: p_.healthFactorOptional == 0
            ? defaultHealthFactorsWAD[p_.targetToken]
            : p_.healthFactorOptional,
          targetDecimals: IERC20Extended(p_.targetToken).decimals(),
          priceTarget18: IPriceOracle(controller.priceOracle()).getAssetPrice(p_.targetToken),
          priceSource18: IPriceOracle(controller.priceOracle()).getAssetPrice(p_.sourceToken)
        })
      );
    }

    return (outTemplatePoolAdapter, outBorrowRate, outMaxTargetAmount);
  }

  /// @notice Enumerate all pools and select a pool suitable for borrowing with min borrow rate and enough underline
  function _findPool(address[] memory platformAdapters_, BorrowInput memory pp) internal view returns (
    address outTemplatePoolAdapter,
    uint outBorrowRate,
    uint outMaxTargetAmount
  ) {
    require(pp.healthFactorWAD > controller.MIN_HEALTH_FACTOR_WAD(), "wrong health factor");
    require(pp.priceSourceWAD != 0, "source price is 0");

    uint lenPools = platformAdapters_.length;
    for (uint i = 0; i < lenPools; i = _uncheckedInc(i)) {
      IPlatformAdapter2 platformAdapter = IPlatformAdapter2(platformAdapters_[i]);

      AppDataTypes.ConversionPlan memory plan = platformAdapter.getPoolInfo(pp.sourceToken, pp.targetToken);
      uint rate18 = plan.borrowRate;

      if (outTemplatePoolAdapter == address(0) || rate18 < outBorrowRate) {
        // how much target asset we are able to get for the provided collateral with given health factor
        // TargetTA = BS / PT [TA], C = SA * PS, CM = C / HF, BS = CM * PCF
        uint resultTa18 = plan.collateralFactorWAD
          * pp.sourceAmountWAD * pp.priceSourceWAD
          / (pp.priceTargetWAD * pp.healthFactorWAD);

        // the pool should have enough liquidity
        if (_toMantissa(plan.maxAmountToBorrowBT, pp.targetDecimals, 18) >= resultTa18) {
          // take the pool with lowest borrow rate
          outTemplatePoolAdapter = plan.poolAdapterTemplate;
          outBorrowRate = rate18;
          outMaxTargetAmount = _toMantissa(resultTa18, 18, pp.targetDecimals);
        }
      }
    }

    return (outTemplatePoolAdapter, outBorrowRate, outMaxTargetAmount);
  }


  ///////////////////////////////////////////////////////
  ///                  Getters
  ///////////////////////////////////////////////////////

  function getPlatformAdapter(address templatePoolAdapter_) external view override returns (address) {
    address platformAdapter = platformAdapters[templatePoolAdapter_];
    require(platformAdapter != address(0), "wrong template pool adapter");
    return platformAdapter;
  }

  ///////////////////////////////////////////////////////
  ///               Helper utils
  ///////////////////////////////////////////////////////

  function _uncheckedInc(uint i) internal pure returns (uint) {
    unchecked {
      return i + 1;
    }
  }

  /// @notice Convert {amount} with [sourceDecimals} to new amount with {targetDecimals}
  function _toMantissa(uint amount, uint8 sourceDecimals, uint8 targetDecimals) internal pure returns (uint) {
    return sourceDecimals == targetDecimals
      ? amount
      : amount * (10 ** targetDecimals) / (10 ** sourceDecimals);
  }

  function pairsListLength(address token1, address token2) public view returns (uint) {
    return pairsList[token1][token2].length;
  }

}