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
import "./AppErrors.sol";

/// @notice Contains list of lending pools. Allow to select most efficient pool for the given collateral/borrow pair
contract BorrowManager is BorrowManagerBase {
  using SafeERC20 for IERC20;

  uint constant public SECONDS_PER_YEAR = 31536000;
  uint constant public BLOCKS_PER_YEAR = 6570 * 365;

  ///////////////////////////////////////////////////////
  ///                Structs and enums
  ///////////////////////////////////////////////////////

  /// @dev Additional input params for _findPool; 18 means that decimals 18 is used
  struct BorrowInput {
    uint8 targetDecimals;
    uint sourceAmount18;
    uint priceTarget18;
    uint priceSource18;
  }

  ///////////////////////////////////////////////////////
  ///                    Members
  ///////////////////////////////////////////////////////

  /// @notice all registered platform adapters
  address[] public platformAdapters;
  mapping(address => bool) platformAdaptersRegistered;

  /// @notice SourceToken => TargetToken => [list of platform adapters]
  /// @dev SourceToken is always less then TargetToken
  mapping(address => mapping (address => address[])) public pairsList;
  /// @notice Check if triple (source token, target token, platform adapter) is already registered in {assets}
  mapping(address => mapping (address => mapping (address => bool))) public pairsListRegistered;

  /// @notice Converter : platform adapter
  mapping(address => address) converters;

  /// @notice Default health factors (HF) for assets. Default HF is used if user hasn't provided HF value, decimals 2
  /// @dev Health factor = collateral / minimum collateral. It should be greater then MIN_HEALTH_FACTOR
  mapping(address => uint16) public defaultHealthFactors2;

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
    if (!platformAdaptersRegistered[platformAdapter_]) {
      platformAdapters.push(platformAdapter_);
      platformAdaptersRegistered[platformAdapter_] = true;
    }

    address[] memory paConverters = IPlatformAdapter(platformAdapter_).converters();
    uint lenConverters = paConverters.length;
    for (uint i = 0; i < lenConverters; ++i) {
      converters[paConverters[i]] = platformAdapter_;
    }

    // enumerate all assets and register all possible pairs
    // TODO: some pairs are not valid. Probably platformAdapter should provide list of available pairs?
    // TODO: how to re-register the pool (i.e. if new asset was added to the internal pool)
    uint lenAssets = assets_.length;
    for (uint i = 0; i < lenAssets; i = _uncheckedInc(i)) {
      for (uint j = i + 1; j < lenAssets; j = _uncheckedInc(j)) {
        bool inputFirst = assets_[i] < assets_[j];
        address tokenIn = inputFirst ? assets_[i] : assets_[j];
        address tokenOut = inputFirst ? assets_[j] : assets_[i];

        if (!pairsListRegistered[tokenIn][tokenOut][platformAdapter_]) {
          pairsList[tokenIn][tokenOut].push(platformAdapter_);
          pairsListRegistered[tokenIn][tokenOut][platformAdapter_] = true;
        }
      }
    }
  }

  /// @notice Set default health factor for {asset}. Default value is used only if user hasn't provided custom value
  /// @param value2 Health factor with decimals 2; must be greater or equal to MIN_HEALTH_FACTOR (for 1.5 use 150)
  function setHealthFactor(address asset, uint16 value2) external override {
    require(value2 > controller.MIN_HEALTH_FACTOR2(), AppErrors.WRONG_HEALTH_FACTOR);
    defaultHealthFactors2[asset] = value2;
  }

  ///////////////////////////////////////////////////////
  ///           Find best pool for borrowing
  ///////////////////////////////////////////////////////
  function findConverter(AppDataTypes.InputConversionParams memory p_) external view override returns (
    address converter,
    uint maxTargetAmount,
    uint borrowRatePerBlock18
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
    address[] memory pas = pairsList
      [p_.sourceToken < p_.targetToken ? p_.sourceToken : p_.targetToken]
      [p_.sourceToken < p_.targetToken ? p_.targetToken : p_.sourceToken];

    if (p_.healthFactor2 == 0) {
      p_.healthFactor2 = defaultHealthFactors2[p_.targetToken];
    }
    require(p_.healthFactor2 >= controller.MIN_HEALTH_FACTOR2(), AppErrors.WRONG_HEALTH_FACTOR);

    if (pas.length != 0) {
      (converter, maxTargetAmount, borrowRatePerBlock18) = _findPool(
        pas
        , p_
        , BorrowInput({
          sourceAmount18: _toMantissa(p_.sourceAmount, uint8(IERC20Extended(p_.sourceToken).decimals()), 18),
          targetDecimals: IERC20Extended(p_.targetToken).decimals(),
          priceTarget18: IPriceOracle(controller.priceOracle()).getAssetPrice(p_.targetToken),
          priceSource18: IPriceOracle(controller.priceOracle()).getAssetPrice(p_.sourceToken)
        })
      );
    }

    return (converter, maxTargetAmount, borrowRatePerBlock18);
  }

  /// @notice Enumerate all pools and select a pool suitable for borrowing with min borrow rate and enough underline
  function _findPool(
    address[] memory platformAdapters_,
    AppDataTypes.InputConversionParams memory p_,
    BorrowInput memory pp_
  ) internal view returns (
    address converter,
    uint maxTargetAmount,
    uint interest18
  ) {
    require(pp_.priceSource18 != 0, AppErrors.ZERO_PRICE);

    uint lenPools = platformAdapters_.length;
    for (uint i = 0; i < lenPools; i = _uncheckedInc(i)) {
      AppDataTypes.ConversionPlan memory plan = IPlatformAdapter(platformAdapters_[i]).getConversionPlan(
        p_.sourceToken,
        p_.targetToken
      );

      // check if we are able to supply required collateral
      if (plan.maxAmountToSupplyCT == 0 || plan.maxAmountToSupplyCT > p_.sourceAmount) {
        // convert borrow rate to interest
        uint apy = plan.borrowRateKind == AppDataTypes.BorrowRateKind.PER_BLOCK_1
          ? _getApy(plan.borrowRate, p_.periodInBlocks)
          : _getApy(plan.borrowRate, p_.periodInBlocks * SECONDS_PER_YEAR / BLOCKS_PER_YEAR);

        if (converter == address(0) || apy > interest18) {
          // how much target asset we are able to get for the provided collateral with given health factor
          // TargetTA = BS / PT [TA], C = SA * PS, CM = C / HF, BS = CM * PCF
          uint resultTa18 = plan.collateralFactorWAD
            * pp_.sourceAmount18 * pp_.priceSource18
            / (pp_.priceTarget18 * p_.healthFactor2 * 10**(18-2));

          // the pool should have enough liquidity
          if (_toMantissa(plan.maxAmountToBorrowBT, pp_.targetDecimals, 18) >= resultTa18) {
            // take the pool with lowest borrow rate
            converter = plan.converter;
            maxTargetAmount = _toMantissa(resultTa18, 18, pp_.targetDecimals);
            interest18 = apy;
          }
        }
      }
    }

    return (converter, maxTargetAmount, interest18);
  }

  /// @notice Calculate APY = (1 + r / n)^n - 1, where r - period rate, n = number of compounding periods
  function _getApy(uint rate18_, uint period_) internal pure returns (uint) {
    return 10**18 * ((1 + rate18_ / 10**18 / period_)** period_ - 1);
  }

  ///////////////////////////////////////////////////////
  ///                  Getters
  ///////////////////////////////////////////////////////

  function getPlatformAdapter(address converter_) external view override returns (address) {
    address platformAdapter = converters[converter_];
    require(platformAdapter != address(0), AppErrors.PLATFORM_ADAPTER_NOT_FOUND);
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