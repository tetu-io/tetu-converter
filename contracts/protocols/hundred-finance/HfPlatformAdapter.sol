// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../../interfaces/IPlatformAdapter.sol";
import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../interfaces/IController.sol";
import "../../core/AppDataTypes.sol";
import "../../core/AppErrors.sol";
import "../../integrations/hundred-finance/IHfComptroller.sol";
import "../../integrations/hundred-finance/IHfCToken.sol";
import "../../interfaces/IPoolAdapterInitializerWithAP.sol";
import "../../interfaces/ITokenAddressProvider.sol";
import "../../integrations/hundred-finance/IHfPriceOracle.sol";
import "../../openzeppelin/IERC20Metadata.sol";
import "../../integrations/hundred-finance/IHfInterestRateModel.sol";
import "../../core/AppUtils.sol";
import "./HfAprLib.sol";
import "hardhat/console.sol";

/// @notice Adapter to read current pools info from HundredFinance-protocol, see https://docs.hundred.finance/
contract HfPlatformAdapter is IPlatformAdapter, ITokenAddressProvider {
  using SafeERC20 for IERC20;
  using AppUtils for uint;

  ///////////////////////////////////////////////////////
  ///   Data types
  ///////////////////////////////////////////////////////

  /// @notice Local vars inside _getConversionPlan - to avoid stack too deep
  struct LocalsGetConversionPlan {
    IHfPriceOracle priceOracle;
    uint8 collateralAssetDecimals;
    uint8 borrowAssetDecimals;
    uint priceCollateral36;
    uint priceBorrow36;
  }

  ///////////////////////////////////////////////////////
  ///   Variables
  ///////////////////////////////////////////////////////
  IController immutable public controller;
  IHfComptroller immutable public comptroller;
  /// @notice Template of pool adapter
  address immutable public converter;

  /// @notice All enabled pairs underlying : cTokens. All assets usable for collateral/to borrow.
  /// @dev There is no underlying for WMATIC, we store hMATIC:WMATIC
  mapping(address => address) public activeAssets;

  ///////////////////////////////////////////////////////
  ///               Events
  ///////////////////////////////////////////////////////
  event OnPoolAdapterInitialized(
    address converter,
    address poolAdapter,
    address user,
    address collateralAsset,
    address borrowAsset
  );
  event OnRegisterCTokens(address[] cTokens);

  ///////////////////////////////////////////////////////
  ///       Constructor and initialization
  ///////////////////////////////////////////////////////

  constructor (
    address controller_,
    address comptroller_,
    address templatePoolAdapter_,
    address[] memory activeCTokens_
  ) {
    require(
      comptroller_ != address(0)
      && templatePoolAdapter_ != address(0)
      && controller_ != address(0),
      AppErrors.ZERO_ADDRESS
    );

    comptroller = IHfComptroller(comptroller_);
    controller = IController(controller_);
    converter = templatePoolAdapter_;

    _registerCTokens(activeCTokens_);
  }

  /// @notice Initialize {poolAdapter_} created from {converter_} using minimal proxy pattern
  function initializePoolAdapter(
    address converter_,
    address poolAdapter_,
    address user_,
    address collateralAsset_,
    address borrowAsset_
  ) external override {
    require(msg.sender == controller.borrowManager(), AppErrors.BORROW_MANAGER_ONLY);
    require(converter == converter_, AppErrors.CONVERTER_NOT_FOUND);

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
    emit OnPoolAdapterInitialized(converter_, poolAdapter_, user_, collateralAsset_, borrowAsset_);
  }

  /// @notice Register new CTokens supported by the market
  /// @dev It's possible to add CTokens only because, we can add unregister function if necessary
  function registerCTokens(address[] memory cTokens_) external {
    _onlyGovernance();
    _registerCTokens(cTokens_);
    emit OnRegisterCTokens(cTokens_);
  }

  function _registerCTokens(address[] memory cTokens_) internal {
    uint lenCTokens = cTokens_.length;
    for (uint i = 0; i < lenCTokens; i = i.uncheckedInc()) {
      // Special case: there is no underlying for WMATIC, so we store hMATIC:WMATIC
      activeAssets[HfAprLib.getUnderlying(cTokens_[i])] = cTokens_[i];
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
    dest[0] = converter;
    return dest;
  }

  function getCTokenByUnderlying(address token1_, address token2_)
  external view override
  returns (address cToken1, address cToken2) {
    return (activeAssets[token1_], activeAssets[token2_]);
  }

  ///////////////////////////////////////////////////////
  ///       Get conversion plan
  ///////////////////////////////////////////////////////

  function getConversionPlan (
    address collateralAsset_,
    uint collateralAmount_,
    address borrowAsset_,
    uint16 healthFactor2_,
    uint countBlocks_
  ) external override view returns (
    AppDataTypes.ConversionPlan memory plan
  ) {
    console.log("getConversionPlan.collateralAsset_", collateralAsset_);
    console.log("getConversionPlan.collateralAmount_", collateralAmount_);
    console.log("getConversionPlan.borrowAsset_", borrowAsset_);
    console.log("getConversionPlan.healthFactor2_", healthFactor2_);
    console.log("getConversionPlan.countBlocks_", countBlocks_);

    require(collateralAsset_ != address(0) && borrowAsset_ != address(0), AppErrors.ZERO_ADDRESS);
    require(collateralAmount_ != 0 && countBlocks_ != 0, AppErrors.INCORRECT_VALUE);
    require(healthFactor2_ >= IController(controller).minHealthFactor2(), AppErrors.WRONG_HEALTH_FACTOR);

    address cTokenCollateral = activeAssets[collateralAsset_];
    if (cTokenCollateral != address(0)) {

      address cTokenBorrow = activeAssets[borrowAsset_];
      if (cTokenBorrow != address(0)) {
        (plan.ltv18, plan.liquidationThreshold18) = getMarketsInfo(cTokenCollateral, cTokenBorrow);
        if (plan.ltv18 != 0 && plan.liquidationThreshold18 != 0) {
          plan.converter = converter;

          plan.maxAmountToBorrow = IHfCToken(cTokenBorrow).getCash();
          uint borrowCap = comptroller.borrowCaps(cTokenBorrow);
          if (borrowCap != 0) {
            uint totalBorrows = IHfCToken(cTokenBorrow).totalBorrows();
            if (totalBorrows > borrowCap) {
              plan.maxAmountToBorrow = 0;
            } else {
              if (totalBorrows + plan.maxAmountToBorrow > borrowCap) {
                plan.maxAmountToBorrow = borrowCap - totalBorrows;
              }
            }
          }

          // it seems that supply is not limited in HundredFinance protocol
          plan.maxAmountToSupply = type(uint).max; // unlimited

          LocalsGetConversionPlan memory vars;
          vars.collateralAssetDecimals = IERC20Metadata(collateralAsset_).decimals();
          vars.borrowAssetDecimals = IERC20Metadata(borrowAsset_).decimals();
          vars.priceOracle = IHfPriceOracle(comptroller.oracle());
          vars.priceCollateral36 = HfAprLib.getPrice(vars.priceOracle, cTokenCollateral)
            * 10**vars.collateralAssetDecimals;
          vars.priceBorrow36 = HfAprLib.getPrice(vars.priceOracle, cTokenBorrow)
            * 10**vars.borrowAssetDecimals;

          // calculate amount that can be borrowed
          // split calculation on several parts to avoid stack too deep
          plan.amountToBorrow = 100 * collateralAmount_ / uint(healthFactor2_);
          plan.amountToBorrow = AppUtils.toMantissa(
            plan.amountToBorrow * plan.liquidationThreshold18
              / 1e18
              * (vars.priceCollateral36 * 1e18 / vars.priceBorrow36)
              / 1e18,
            vars.collateralAssetDecimals,
            vars.borrowAssetDecimals
          );
          if (plan.amountToBorrow > plan.maxAmountToBorrow) {
            plan.amountToBorrow = plan.maxAmountToBorrow;
          }

          // calculate current borrow rate and predicted APR after borrowing required amount
          (plan.borrowCost36,
           plan.supplyIncomeInBorrowAsset36
          ) = HfAprLib.getRawCostAndIncomes(
            HfAprLib.getCore(comptroller, cTokenCollateral, cTokenBorrow),
            collateralAmount_,
            countBlocks_,
            plan.amountToBorrow,
            vars.priceCollateral36,
            vars.priceBorrow36
          );

          plan.amountCollateralInBorrowAsset36 =
            collateralAmount_ * (10**36 * vars.priceCollateral36 / vars.priceBorrow36)
            / 10**vars.collateralAssetDecimals;
        }
      }
    }

    return plan;
  }

  ///////////////////////////////////////////////////////
  ///  Calculate borrow rate after borrowing in advance
  ///////////////////////////////////////////////////////

  /// @notice Estimate value of variable borrow rate after borrowing {amountToBorrow_}
  function getBorrowRateAfterBorrow(address borrowAsset_, uint amountToBorrow_) external view override returns (uint) {
    address borrowCToken = activeAssets[borrowAsset_];
    return HfAprLib.getEstimatedBorrowRate(
      IHfInterestRateModel(IHfCToken(borrowCToken).interestRateModel()),
      IHfCToken(borrowCToken),
      amountToBorrow_
    );
  }

  ///////////////////////////////////////////////////////
  ///                    Utils
  ///////////////////////////////////////////////////////

  /// @notice Check if the c-tokens are active and return LTV and liquidityThreshold values for the borrow
  function getMarketsInfo(address cTokenCollateral_, address cTokenBorrow_) public view returns (
    uint ltv18,
    uint liquidityThreshold18
  ) {
    console.log("getMarketsInfo");
    IHfComptroller comptrollerLocal = comptroller;
    if (
      !comptroller.borrowGuardianPaused(cTokenBorrow_) // borrowing is not paused
      && !comptroller.mintGuardianPaused(cTokenCollateral_) // minting is not paused
    ) {
      console.log("getMarketsInfo.1");
      (bool isListed, uint256 collateralFactorMantissa,) = comptrollerLocal.markets(cTokenBorrow_);
      if (isListed) {
        ltv18 = collateralFactorMantissa;
        console.log("getMarketsInfo.2");
        (isListed, collateralFactorMantissa,) = comptrollerLocal.markets(cTokenCollateral_);
        if (isListed) {
          liquidityThreshold18 = collateralFactorMantissa;
        } else {
          ltv18 = 0; // not efficient, but it's error case
        }
      }
    }

    return (ltv18, liquidityThreshold18);
  }
}
