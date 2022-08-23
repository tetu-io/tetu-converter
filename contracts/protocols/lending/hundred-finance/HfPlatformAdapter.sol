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
import "../../../integrations/hundred-finance/IHfOracle.sol";
import "../../../integrations/IERC20Extended.sol";
import "../../../integrations/hundred-finance/IHfInterestRateModel.sol";
import "../../../core/AppUtils.sol";
/// @notice Adapter to read current pools info from HundredFinance-protocol, see https://docs.hundred.finance/
contract HfPlatformAdapter is IPlatformAdapter, ITokenAddressProvider {
  using SafeERC20 for IERC20;
  using AppUtils for uint;

  address private constant WMATIC = address(0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270);
  address private constant hMATIC = address(0xEbd7f3349AbA8bB15b897e03D6c1a4Ba95B55e31);

  IController public controller;
  IHfComptroller public comptroller;
  /// @notice Implementation of IHfOracle
  address public priceOracleAddress;

  /// @notice Template of pool adapter
  address _converter;


  /// @notice All enabled pairs underlying : cTokens. All assets usable for collateral/to borrow.
  /// @dev There is no underlying for WMATIC, we store hMATIC:WMATIC
  mapping(address => address) public activeAssets;

  ///////////////////////////////////////////////////////
  ///       Constructor and initialization
  ///////////////////////////////////////////////////////
  constructor (
    address controller_,
    address comptroller_,
    address templatePoolAdapter_,
    address[] memory activeCTokens_,
    address priceOracle_
  ) {
    require(
      comptroller_ != address(0)
      && templatePoolAdapter_ != address(0)
      && controller_ != address(0)
      && priceOracle_ != address(0)
    , AppErrors.ZERO_ADDRESS);

    comptroller = IHfComptroller(comptroller_);
    controller = IController(controller_);
    priceOracleAddress = priceOracle_;

    _converter = templatePoolAdapter_;
    _setupCTokens(activeCTokens_, true);
  }

  function setupCTokens(address[] memory cTokens_, bool makeActive_) external {
    _onlyGovernance();
    _setupCTokens(cTokens_, makeActive_);
  }

  function _setupCTokens(address[] memory cTokens_, bool makeActive_) internal {
    uint lenCTokens = cTokens_.length;
    if (makeActive_) {
      for (uint i = 0; i < lenCTokens; i = i.uncheckedInc()) {
        // Special case: there is no underlying for WMATIC, so we store hMATIC:WMATIC
        address underlying = hMATIC == cTokens_[i]
          ? WMATIC
          : IHfCToken(cTokens_[i]).underlying();
        activeAssets[underlying] = cTokens_[i];
      }
    } else {
      for (uint i = 0; i < lenCTokens; i = i.uncheckedInc()) {
        delete activeAssets[cTokens_[i]];
      }
    }
  }

  ///////////////////////////////////////////////////////
  ///                    Access
  ///////////////////////////////////////////////////////

  /// @notice Ensure that the caller is governance
  function _onlyGovernance() internal view {
    require(controller.governance() == msg.sender, AppErrors.GOVERNANCE_ONLY);
  }

  ///////////////////////////////////////////////////////
  ///                     View
  ///////////////////////////////////////////////////////

  function converters() external view override returns (address[] memory) {
    address[] memory dest = new address[](1);
    dest[0] = _converter;
    return dest;
  }

  /// @notice Returns the prices of the supported assets in BASE_CURRENCY of the market. Decimals 18
  /// @dev Different markets can have different BASE_CURRENCY
  function getAssetsPrices(address[] calldata assets_) external view override returns (uint[] memory prices18) {
    IHfOracle priceOracle = IHfOracle(priceOracleAddress);

    uint lenAssets = assets_.length;
    prices18 = new uint[](lenAssets);
    for (uint i = 0; i < lenAssets; i = i.uncheckedInc()) {
      address cToken = activeAssets[assets_[i]];

      // we get a price with decimals = (36 - asset decimals)
      // let's convert it to decimals = 18
      prices18[i] = priceOracle.getUnderlyingPrice(cToken) / (10 ** (18 - IERC20Extended(assets_[i]).decimals()));
    }

    return prices18;
  }

  function getCTokenByUnderlying(address token1_, address token2_)
  external view override
  returns (address cToken1, address cToken2, address priceOracle) {
    return (activeAssets[token1_], activeAssets[token2_], priceOracleAddress);
  }

  ///////////////////////////////////////////////////////
  ///       Get conversion plan
  ///////////////////////////////////////////////////////

  function getConversionPlan (
    address collateralAsset_,
    address borrowAsset_,
    uint borrowAmountFactor18_
  ) external override view returns (
    AppDataTypes.ConversionPlan memory plan
  ) {
    address cTokenCollateral = activeAssets[collateralAsset_];
    if (cTokenCollateral != address(0)) {

      address cTokenBorrow = activeAssets[borrowAsset_];
      if (cTokenBorrow != address(0)) {
        (plan.ltv18, plan.liquidationThreshold18) = _getMarketsInfo(cTokenCollateral, cTokenBorrow);
        if (plan.ltv18 != 0 && plan.liquidationThreshold18 != 0) {
          plan.converter = _converter;

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

          // it seems that supply is not limited in HundredFinance protocol
          plan.maxAmountToSupplyCT = type(uint).max; // unlimited

          // calculate current borrow rate and the borrow rate after borrowing max allowed amount
          plan.aprPerBlock18 = IHfCToken(cTokenBorrow).borrowRatePerBlock();
          if (borrowAmountFactor18_ != 0) {
            uint brAfterBorrow = _br(
              IHfCToken(cTokenBorrow),
              plan.liquidationThreshold18 * borrowAmountFactor18_ / 1e18 // == amount to borrow
            );
            if (brAfterBorrow > plan.aprPerBlock18) {
              plan.aprPerBlock18 = brAfterBorrow;
            }
          }
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
    require(_converter == converter_, AppErrors.CONVERTER_NOT_FOUND);
    // HF-pool-adapters support IPoolAdapterInitializer
    IPoolAdapterInitializerWithAP(poolAdapter_).initialize(
      address(controller),
      address(this),
      address(comptroller),
      user_,
      collateralAsset_,
      borrowAsset_,
      converter_
    );
  }

  ///////////////////////////////////////////////////////
  ///  Calculate borrow rate after borrowing in advance
  ///////////////////////////////////////////////////////

  /// @notice Estimate value of variable borrow rate after borrowing {amountToBorrow_}
  function getBorrowRateAfterBorrow(address borrowAsset_, uint amountToBorrow_) external view override returns (uint) {
    return _br(IHfCToken(activeAssets[borrowAsset_]), amountToBorrow_);
  }

  /// @notice Estimate value of variable borrow rate after borrowing {amountToBorrow_}
  function _br(
    IHfCToken cTokenBorrow,
    uint amountToBorrow_
  ) internal view returns (uint) {
    return IHfInterestRateModel(cTokenBorrow.interestRateModel()).getBorrowRate(
      cTokenBorrow.getCash() - amountToBorrow_,
      cTokenBorrow.totalBorrows() + amountToBorrow_,
      cTokenBorrow.totalReserves()
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
    IHfComptroller comptrollerLocal = comptroller;
    (bool isListed, uint256 collateralFactorMantissa,) = comptrollerLocal.markets(cTokenBorrow_);
    if (isListed) {
      ltv18 = collateralFactorMantissa;
      (isListed, collateralFactorMantissa,) = comptrollerLocal.markets(cTokenCollateral_);
      if (isListed) {
        liquidityThreshold18 = collateralFactorMantissa;
      }
    }

    return (ltv18, liquidityThreshold18);
  }
}