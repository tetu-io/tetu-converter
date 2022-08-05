// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../../../interfaces/IPlatformAdapter.sol";
import "../../../openzeppelin/SafeERC20.sol";
import "../../../openzeppelin/IERC20.sol";
import "../../../interfaces/IController.sol";
import "../../../core/AppDataTypes.sol";
import "../../../core/AppErrors.sol";
import "../../../integrations/hundred-finance/IHfComptroller.sol";
import "../../../integrations/hundred-finance/IHfCToken.sol";
import "../../../interfaces/IPoolAdapterInitializerWithAP.sol";
import "../../../interfaces/ITokenAddressProvider.sol";
import "hardhat/console.sol";
import "../../../integrations/hundred-finance/IHfOracle.sol";
import "../../../integrations/IERC20Extended.sol";

/// @notice Adapter to read current pools info from HundredFinance-protocol, see https://docs.hundred.finance/
contract HfPlatformAdapter is IPlatformAdapter, ITokenAddressProvider {
  using SafeERC20 for IERC20;

  /// @notice Index of template pool adapter in {templatePoolAdapters} that should be used in normal borrowing mode
  uint constant public INDEX_NORMAL_MODE = 0;
  address private constant WMATIC = address(0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270);
  address private constant hMATIC = address(0xEbd7f3349AbA8bB15b897e03D6c1a4Ba95B55e31);

  IController public controller;
  IHfComptroller public comptroller;
  /// @notice Implementation of IHfOracle
  address public priceOracleAddress;

  /// @notice Full list of supported template-pool-adapters
  address[] private _converters;


  /// @notice All enabled pairs underlying : cTokens. All assets usable for collateral/to borrow.
  /// @dev There is no underlying for WMATIC, we store hMATIC:WMATIC
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

    comptroller = IHfComptroller(comptroller_);
    controller = IController(controller_);
    priceOracleAddress = priceOracle_;

    _converters.push(templateAdapterNormal_); // Index INDEX_NORMAL_MODE: ordinal conversion mode
    console.log("HfPlatformAdapter this=%s priceOracleAddress=%s", address(this), priceOracleAddress);
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
        address underlying = hMATIC == cTokens_[i]
          ? WMATIC
          : IHfCToken(cTokens_[i]).underlying();
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
    IHfOracle priceOracle = IHfOracle(priceOracleAddress);

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
        (plan.ltv18, plan.liquidationThreshold18) = _getMarketsInfo(cTokenCollateral, cTokenBorrow);
        if (plan.ltv18 != 0 && plan.liquidationThreshold18 != 0) {
          plan.borrowRateKind = AppDataTypes.BorrowRateKind.PER_BLOCK_1;
          plan.borrowRate = IHfCToken(cTokenBorrow).borrowRatePerBlock();
          plan.converter = _converters[INDEX_NORMAL_MODE];

          plan.maxAmountToBorrowBT = IHfCToken(cTokenBorrow).getCash();
          uint borrowCap = comptroller.borrowCaps(cTokenBorrow);
          if (borrowCap != 0) {
            uint totalBorrows = IHfCToken(cTokenBorrow).totalBorrows();
            if (totalBorrows > borrowCap) {
              plan.maxAmountToBorrowBT = 0;
            } else {
              if (totalBorrows + plan.maxAmountToBorrowBT > borrowCap) {
                plan.maxAmountToBorrowBT = borrowCap - totalBorrows;
              }
            }
          }

          console.log("maxAmountToBorrowBT=%d", plan.maxAmountToBorrowBT);
          console.log("borrowRate=%d", plan.borrowRate);

          //it seems that supply is not limited in HundredFinance protocol
          plan.maxAmountToSupplyCT = type(uint).max; // unlimited
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
  function _getMarketsInfo(address cTokenCollateral_, address cTokenBorrow_) internal view returns (
    uint ltv18,
    uint liquidityThreshold18
  ) {
    (bool isListed, uint256 collateralFactorMantissa,) = comptroller.markets(cTokenBorrow_);
    if (isListed) {
      ltv18 = collateralFactorMantissa;
      (isListed, collateralFactorMantissa,) = comptroller.markets(cTokenCollateral_);
      if (isListed) {
        liquidityThreshold18 = collateralFactorMantissa;
      }
    }

    return (ltv18, liquidityThreshold18);
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