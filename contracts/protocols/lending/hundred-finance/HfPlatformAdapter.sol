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
import "../../../interfaces/hundred-finance/IPoolAdapterInitializerHF.sol";
import "../../../interfaces/hundred-finance/IHfCTokenAddressProvider.sol";
import "hardhat/console.sol";

/// @notice Adapter to read current pools info from HundredFinance-protocol, see https://docs.hundred.finance/
contract HfPlatformAdapter is IPlatformAdapter, IHfCTokenAddressProvider {
  using SafeERC20 for IERC20;

  /// @notice Index of template pool adapter in {templatePoolAdapters} that should be used in normal borrowing mode
  uint constant public INDEX_NORMAL_MODE = 0;
  address private constant WMATIC = address(0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270);

  IController public controller;
  IHfComptroller public comptroller;
  /// @notice Implementation of IHfOracle
  address public priceOracleAddress;

  /// @notice Full list of supported template-pool-adapters
  address[] private _converters;


  /// @notice All enabled pairs underlying : cTokens. All assets usable for collateral/to borrow.
  /// @dev There is no underlying for WMATIC, so we store WMATIC:WMATIC
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
    console.log("HfPlatformAdapter this=%s", address(this));
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
        console.log("_setupCTokens ctoken=%s underline=%s", cTokens_[i], IHfCToken(cTokens_[i]).underlying());
        // Special case: there is no underlying for WMATIC, so we store WMATIC:WMATIC
        address underlying = WMATIC == cTokens_[i]
          ? WMATIC
          : IHfCToken(cTokens_[i]).underlying();
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
        plan.ltvWAD = _getLtv18(cTokenBorrow);
        if (plan.ltvWAD != 0) {
          plan.borrowRateKind = AppDataTypes.BorrowRateKind.PER_BLOCK_1;
          plan.borrowRate = IHfCToken(cTokenBorrow).borrowRatePerBlock();
          plan.converter = _converters[INDEX_NORMAL_MODE];

          //TODO: how to take into account borrow cap?
          //TODO: probably we should add borrow cap to conversion plan
          plan.maxAmountToBorrowBT = IHfCToken(cTokenBorrow).getCash();

          //it seems that supply is not limited in HundredFinance protocol
          //plan.maxAmountToSupplyCT = 0;

          plan.liquidationThreshold18 = plan.ltvWAD; //TODO is it valid?
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
    IPoolAdapterInitializerHF(poolAdapter_).initialize(
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
  function _getLtv18(address cToken) internal view returns (uint) {
    (bool isListed, uint256 collateralFactorMantissa,) = comptroller.markets(cToken);
    return isListed ? collateralFactorMantissa : 0;
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