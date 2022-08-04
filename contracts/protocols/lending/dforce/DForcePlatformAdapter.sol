// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../../../interfaces/IPlatformAdapter.sol";
import "../../../openzeppelin/SafeERC20.sol";
import "../../../openzeppelin/IERC20.sol";
import "../../../interfaces/IController.sol";
import "../../../core/AppDataTypes.sol";
import "../../../core/AppErrors.sol";
import "../../../integrations/dforce/IDForceController.sol";
import "../../../integrations/dforce/IDForceCToken.sol";
import "../../../interfaces/IPoolAdapterInitializerWithAP.sol";
import "../../../interfaces/ITokenAddressProvider.sol";
import "hardhat/console.sol";
import "../../../integrations/dforce/IDForcePriceOracle.sol";
import "../../../integrations/IERC20Extended.sol";

/// @notice Adapter to read current pools info from DForce-protocol, see https://developers.dforce.network/
contract DForcePlatformAdapter is IPlatformAdapter, ITokenAddressProvider {
  using SafeERC20 for IERC20;

  /// @notice Index of template pool adapter in {templatePoolAdapters} that should be used in normal borrowing mode
  uint constant public INDEX_NORMAL_MODE = 0;
  address private constant WMATIC = address(0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270);
  address private constant iMATIC = address(0x6A3fE5342a4Bd09efcd44AC5B9387475A0678c74);

  IController public controller;
  IDForceController public comptroller;
  /// @notice Implementation of IDForcePriceOracle
  address public priceOracleAddress;

  /// @notice Full list of supported template-pool-adapters
  address[] private _converters;


  /// @notice All enabled pairs underlying : cTokens. All assets usable for collateral/to borrow.
  /// @dev There is no underlying for WMATIC, we store iMATIC:WMATIC
  mapping(address => address) public activeAssets;

  ///////////////////////////////////////////////////////
  ///       Constructor and initialization
  ///////////////////////////////////////////////////////
  constructor (
    address controller_,
    address comptroller_,
    address templateAdapterNormal_,
    address[] memory activeCTokens_,
    address priceOracle_
  ) {
    require(
      comptroller_ != address(0)
      && templateAdapterNormal_ != address(0)
      && controller_ != address(0)
      && priceOracle_ != address(0)
    , AppErrors.ZERO_ADDRESS);

    comptroller = IDForceController(comptroller_);
    controller = IController(controller_);
    priceOracleAddress = priceOracle_;

    _converters.push(templateAdapterNormal_); // Index INDEX_NORMAL_MODE: ordinal conversion mode
    console.log("DForcePlatformAdapter this=%s priceOracleAddress=%s", address(this), priceOracleAddress);
    _setupCTokens(activeCTokens_, true);
  }

  function setupCTokens(address[] memory cTokens_, bool makeActive_) external {
    _setupCTokens(cTokens_, makeActive_);
  }

  function _setupCTokens(address[] memory cTokens_, bool makeActive_) internal {
    console.log("_setupCTokens");
    uint lenCTokens = cTokens_.length;
    if (makeActive_) {
      for (uint i = 0; i < lenCTokens; i = _uncheckedInc(i)) {
        // Special case: there is no underlying for WMATIC, so we store hMATIC:WMATIC
        address underlying = iMATIC == cTokens_[i]
          ? WMATIC
          : IDForceCToken(cTokens_[i]).underlying();
        console.log("_setupCTokens ctoken=%s underline=%s", cTokens_[i], underlying);
        activeAssets[underlying] = cTokens_[i];
      }
    } else {
      for (uint i = 0; i < lenCTokens; i = _uncheckedInc(i)) {
        delete activeAssets[cTokens_[i]];
      }
    }

  }

  ///////////////////////////////////////////////////////
  ///       View
  ///////////////////////////////////////////////////////

  function converters() external view override returns (address[] memory) {
    return _converters;
  }

  /// @notice Returns the prices of the supported assets in BASE_CURRENCY of the market. Decimals 18
  /// @dev Different markets can have different BASE_CURRENCY
  function getAssetsPrices(address[] calldata assets_) external view override returns (uint[] memory prices18) {
    IDForcePriceOracle priceOracle = IDForcePriceOracle(priceOracleAddress);

    uint lenAssets = assets_.length;
    prices18 = new uint[](lenAssets);
    for (uint i = 0; i < lenAssets; i = _uncheckedInc(i)) {
      console.log("asset=%s", assets_[i]);
      address cToken = activeAssets[assets_[i]];

      // we get a price with decimals = (36 - asset decimals)
      // let's convert it to decimals = 18
      prices18[i] = priceOracle.getUnderlyingPrice(cToken) / (10 ** (18 - IERC20Extended(assets_[i]).decimals()));
      console.log("underline decimals=%d", IERC20Extended(assets_[i]).decimals());
      console.log("price1=%d", priceOracle.getUnderlyingPrice(cToken));
      console.log("price2=%d", priceOracle.getUnderlyingPrice(cToken) / (10 ** (18 - IERC20Extended(assets_[i]).decimals())));
      console.log("price3=%d", priceOracle.getUnderlyingPrice(cToken) * (10 ** 18) / (10 ** (36 - IERC20Extended(assets_[i]).decimals())) );

      console.log("underline=%s ctoken=%s price=%d", assets_[i], cToken, prices18[i] );
    }

    return prices18;
  }

  function getCTokenByUnderlying(address token1, address token2)
  external view override
  returns (address cToken1, address cToken2, address priceOracle) {
    return (activeAssets[token1], activeAssets[token2], priceOracleAddress);
  }

  ///////////////////////////////////////////////////////
  ///       Get conversion plan
  ///////////////////////////////////////////////////////

  function getConversionPlan (
    address collateralAsset_,
    address borrowAsset_
  ) external override view returns (
    AppDataTypes.ConversionPlan memory plan
  ) {
    address cTokenCollateral = activeAssets[collateralAsset_];
    if (cTokenCollateral != address(0)) {

      address cTokenBorrow = activeAssets[borrowAsset_];
      if (cTokenBorrow != address(0)) {
        (uint collateralFactorMantissa,
         uint borrowFactorMantissa,
         uint borrowCapacity,
         uint supplyCapacity
        ) = _getLtv18(cTokenBorrow);
        if (collateralFactorMantissa != 0) {
          plan.borrowRateKind = AppDataTypes.BorrowRateKind.PER_BLOCK_1;
          plan.borrowRate = IDForceCToken(cTokenBorrow).borrowRatePerBlock();
          plan.converter = _converters[INDEX_NORMAL_MODE];
          plan.liquidationThreshold18 = collateralFactorMantissa;
          plan.ltv18 = collateralFactorMantissa * borrowFactorMantissa;
          plan.maxAmountToBorrowBT = IDForceCToken(cTokenBorrow).getCash();
          console.log("maxAmountToBorrowBT=%d", plan.maxAmountToBorrowBT);
          if (borrowCapacity < plan.maxAmountToBorrowBT) {
            plan.maxAmountToBorrowBT = borrowCapacity;
            console.log("maxAmountToBorrowBT=%d", plan.maxAmountToBorrowBT);
          }
          plan.maxAmountToSupplyCT = supplyCapacity;

          console.log("borrowRate=%d", plan.borrowRate);
          console.log("ltv=%d", plan.ltv18);
          console.log("liquidationThreshold18=%d", plan.liquidationThreshold18);
        }
      }
    }

    return plan;
  }


  ///////////////////////////////////////////////////////
  ///         Initialization of pool adapters
  ///////////////////////////////////////////////////////

  /// @notice Initialize {poolAdapter_} created from {converter_} using minimal proxy pattern
  function initializePoolAdapter(
    address converter_,
    address poolAdapter_,
    address user_,
    address collateralAsset_,
    address borrowAsset_
  ) external override {
    require(_converters[0] == converter_, AppErrors.CONVERTER_NOT_FOUND);
    // HF-pool-adapters support IPoolAdapterInitializer
    IPoolAdapterInitializerWithAP(poolAdapter_).initialize(
      address(controller),
      address(this),
      address(comptroller),
      user_,
      collateralAsset_,
      borrowAsset_
    );
  }

  ///////////////////////////////////////////////////////
  ///                    Utils
  ///////////////////////////////////////////////////////

  /// @notice Check if the c-token is active and return its collateral factor (== ltv)
  /// @return collateralFactorMantissa Multiplier representing the most one can borrow against their collateral in
  ///         this market. For instance, 0.9 to allow borrowing 90% of collateral value.
  /// @return borrowFactorMantissa Multiplier representing the most one can borrow the asset.
  ///         For instance, 0.5 to allow borrowing this asset 50% * collateral value * collateralFactor.
  function _getLtv18(address cToken) internal view returns (
    uint collateralFactorMantissa,
    uint borrowFactorMantissa,
    uint borrowCapacity,
    uint supplyCapacity
  ) {
    (uint256 collateralFactorMantissa0,
     uint256 borrowFactorMantissa0,
     uint256 borrowCapacity0,
     uint256 supplyCapacity0,
     bool mintPaused,
     bool redeemPaused,
     bool borrowPaused
    ) = comptroller.markets(cToken);
    if (mintPaused || redeemPaused || borrowPaused || borrowCapacity0 == 0 || supplyCapacity0 == 0) {
      return (0, 0, 0, 0);
    } else {
      return (collateralFactorMantissa0, borrowFactorMantissa0, borrowCapacity0, supplyCapacity0);
    }
  }

  ///////////////////////////////////////////////////////
  ///               Helper utils
  ///////////////////////////////////////////////////////

  function _uncheckedInc(uint i) internal pure returns (uint) {
    unchecked {
      return i + 1;
    }
  }

}