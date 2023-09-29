// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../openzeppelin/Initializable.sol";
import "../../openzeppelin/IERC20Metadata.sol";
import "../../interfaces/IConverterController.sol";
import "../../integrations/compound/ICompoundComptrollerBase.sol";
import "../../integrations/compound/ICTokenBase.sol";
import "../../interfaces/IController.sol";
import "../../integrations/compound/INativeToken.sol";
import "../../integrations/compound/ICTokenNative.sol";
import "../../integrations/compound/ICompoundPriceOracle.sol";
import "../../libs/AppDataTypes.sol";
import "./CompoundLib.sol";
import "../../integrations/compound/ICompoundComptrollerBaseV1.sol";
import "../../integrations/compound/ICompoundComptrollerBaseV2.sol";
import "../../libs/AppErrors.sol";
import "../../interfaces/IPoolAdapterInitializerWithAP.sol";
import "./CompoundAprLib.sol";
import "../../libs/EntryKinds.sol";

library CompoundPlatformAdapterLib {
  using SafeERC20 for IERC20;

  //region ----------------------------------------------------- Data types
  struct State {
    IConverterController controller;
    ICompoundComptrollerBase comptroller;
    /// @notice Template of pool adapter
    address converter;

    /// @notice All enabled pairs underlying : cTokens. All assets usable for collateral/to borrow.
    /// @dev There is no underlying for native token, we store cToken-for-native-token:native-token
    mapping(address => address) activeAssets;

    /// @notice True if the platform is frozen and new borrowing is not possible (at this moment)
    bool frozen;
  }

  /// @notice Local vars inside getConversionPlan - to avoid stack too deep
  struct LocalsGetConversionPlan {
    ICompoundComptrollerBase comptroller;
    ICompoundPriceOracle priceOracle;
    address cTokenCollateral;
    address cTokenBorrow;
    uint entryKind;
  }
  //endregion ----------------------------------------------------- Data types

  //region ----------------------------------------------------- Events
  event OnPoolAdapterInitialized(
    address converter,
    address poolAdapter,
    address user,
    address collateralAsset,
    address borrowAsset
  );
  event OnRegisterCTokens(address[] cTokens);
  //endregion ----------------------------------------------------- Events

  //region ----------------------------------------------------- Initialization and setup
  function init (
    State storage state,
    CompoundLib.ProtocolFeatures memory f_,
    address controller_,
    address comptroller_,
    address templatePoolAdapter_,
    address[] memory activeCTokens_
  ) internal {
    require(
      comptroller_ != address(0)
      && templatePoolAdapter_ != address(0)
      && controller_ != address(0),
      AppErrors.ZERO_ADDRESS
    );

    state.comptroller = ICompoundComptrollerBase(comptroller_);
    state.controller = IConverterController(controller_);
    state.converter = templatePoolAdapter_;

    _registerCTokens(state, f_, activeCTokens_);
  }

  /// @notice Initialize {poolAdapter_} created from {converter_} using minimal proxy pattern
  function initializePoolAdapter(
    State storage state,
    address converter_,
    address poolAdapter_,
    address user_,
    address collateralAsset_,
    address borrowAsset_
  ) internal {
    require(msg.sender == state.controller.borrowManager(), AppErrors.BORROW_MANAGER_ONLY);
    require(state.converter == converter_, AppErrors.CONVERTER_NOT_FOUND);

    // assume here that the pool adapter supports IPoolAdapterInitializer
    IPoolAdapterInitializerWithAP(poolAdapter_).initialize(
      address(state.controller),
      address(this),
      address(state.comptroller),
      user_,
      collateralAsset_,
      borrowAsset_,
      converter_
    );
    emit OnPoolAdapterInitialized(converter_, poolAdapter_, user_, collateralAsset_, borrowAsset_);
  }

  /// @notice Set platform to frozen/unfrozen state. In frozen state any new borrowing is forbidden.
  function setFrozen(State storage state, bool frozen_) internal {
    state.frozen = frozen_;
    // todo emit
  }

  /// @notice Register new CTokens supported by the market
  /// @dev It's possible to add CTokens only because, we can add unregister function if necessary
  function registerCTokens(
    State storage state,
    CompoundLib.ProtocolFeatures memory f_,
    address[] memory cTokens_
  ) internal {
    _registerCTokens(state, f_, cTokens_);
    emit OnRegisterCTokens(cTokens_);
  }

  function _registerCTokens(
    State storage state,
    CompoundLib.ProtocolFeatures memory f_,
    address[] memory cTokens_
  ) internal {
    uint lenCTokens = cTokens_.length;
    for (uint i = 0; i < lenCTokens; i = AppUtils.uncheckedInc(i)) {
      // Special case: there is no underlying for WMATIC, so we store hMATIC:WMATIC
      state.activeAssets[CompoundAprLib.getUnderlying(f_, cTokens_[i])] = cTokens_[i];
    }
  }
  //endregion ----------------------------------------------------- Initialization and setup

  //region ----------------------------------------------------- View
  function getCTokenByUnderlying(State storage state, address token1_, address token2_) internal view returns (
    address cToken1,
    address cToken2
  ) {
    return (state.activeAssets[token1_], state.activeAssets[token2_]);
  }
  //endregion ----------------------------------------------------- View


  //region ----------------------------------------------------- Get conversion plan
  function getConversionPlan (
    State storage state,
    CompoundLib.ProtocolFeatures memory f_,
    AppDataTypes.InputConversionParams memory p_,
    uint16 healthFactor2_
  ) internal view returns (
    AppDataTypes.ConversionPlan memory plan
  ) {
    require(p_.collateralAsset != address(0) && p_.borrowAsset != address(0), AppErrors.ZERO_ADDRESS);
    require(p_.amountIn != 0 && p_.countBlocks != 0, AppErrors.INCORRECT_VALUE);
    require(healthFactor2_ >= state.controller.minHealthFactor2(), AppErrors.WRONG_HEALTH_FACTOR);

    if (! state.frozen) {
      LocalsGetConversionPlan memory vars;
      vars.comptroller = state.comptroller;
      vars.cTokenCollateral = state.activeAssets[p_.collateralAsset];
      if (vars.cTokenCollateral != address(0)) {

        vars.cTokenBorrow = state.activeAssets[p_.borrowAsset];
        if (vars.cTokenBorrow != address(0)) {
          //-------------------------------- LTV and liquidation threshold
          (plan.ltv18, plan.liquidationThreshold18) = getMarketsInfo(state, f_, vars.cTokenCollateral, vars.cTokenBorrow);
          if (plan.ltv18 != 0 && plan.liquidationThreshold18 != 0) {
            //------------------------------- Calculate maxAmountToSupply and maxAmountToBorrow
            plan.maxAmountToBorrow = ICTokenBase(vars.cTokenBorrow).getCash();
            uint borrowCap = vars.comptroller.borrowCaps(vars.cTokenBorrow);
            if (borrowCap != 0) {
              uint totalBorrows = ICTokenBase(vars.cTokenBorrow).totalBorrows();
              if (totalBorrows > borrowCap) {
                plan.maxAmountToBorrow = 0;
              } else {
                if (totalBorrows + plan.maxAmountToBorrow > borrowCap) {
                  plan.maxAmountToBorrow = borrowCap - totalBorrows;
                }
              }
            }

            // it seems that supply is not limited in HundredFinance protocol
            plan.maxAmountToSupply = type(uint).max; // unlimited; fix validation below after changing this value

            if (/* plan.maxAmountToSupply != 0 && */ plan.maxAmountToBorrow != 0) {
              plan.converter = state.converter;

              //-------------------------------- Prices and health factor
              vars.priceOracle = ICompoundPriceOracle(vars.comptroller.oracle());

              AppDataTypes.PricesAndDecimals memory pd;
              pd.rc10powDec = 10**IERC20Metadata(p_.collateralAsset).decimals();
              pd.rb10powDec = 10**IERC20Metadata(p_.borrowAsset).decimals();
              pd.priceCollateral = CompoundAprLib.getPrice(vars.priceOracle, vars.cTokenCollateral) * pd.rc10powDec;
              pd.priceBorrow = CompoundAprLib.getPrice(vars.priceOracle, vars.cTokenBorrow) * pd.rb10powDec;
              // ltv and liquidation threshold are exactly the same in HundredFinance
              // so, there is no min health factor, we can directly use healthFactor2_ in calculations below

              //------------------------------- Calculate collateralAmount and amountToBorrow
              // we assume that liquidationThreshold18 == ltv18 in this protocol, so the minimum health factor is 1
              vars.entryKind = EntryKinds.getEntryKind(p_.entryData);
              if (vars.entryKind == EntryKinds.ENTRY_KIND_EXACT_COLLATERAL_IN_FOR_MAX_BORROW_OUT_0) {
                plan.collateralAmount = p_.amountIn;
                plan.amountToBorrow = EntryKinds.exactCollateralInForMaxBorrowOut(
                  p_.amountIn,
                  uint(healthFactor2_) * 10**16,
                  plan.liquidationThreshold18,
                  pd,
                  true // prices have decimals 36
                );
              } else if (vars.entryKind == EntryKinds.ENTRY_KIND_EXACT_PROPORTION_1) {
                (plan.collateralAmount, plan.amountToBorrow) = EntryKinds.exactProportion(
                  p_.amountIn,
                  uint(healthFactor2_) * 10**16,
                  plan.liquidationThreshold18,
                  pd,
                  p_.entryData,
                  true // prices have decimals 36
                );
              } else if (vars.entryKind == EntryKinds.ENTRY_KIND_EXACT_BORROW_OUT_FOR_MIN_COLLATERAL_IN_2) {
                plan.amountToBorrow = p_.amountIn;
                plan.collateralAmount = EntryKinds.exactBorrowOutForMinCollateralIn(
                  p_.amountIn,
                  uint(healthFactor2_) * 10**16,
                  plan.liquidationThreshold18,
                  pd,
                  true // prices have decimals 36
                );
              }

              //------------------------------- Validate the borrow
              if (plan.amountToBorrow == 0 || plan.collateralAmount == 0) {
                plan.converter = address(0);
              } else {
                // reduce collateral amount and borrow amount proportionally to fit available limits
                // we don't need to check "plan.collateralAmount > plan.maxAmountToSupply" as in DForce
                // because maxAmountToSupply is always equal to type(uint).max
                if (plan.amountToBorrow > plan.maxAmountToBorrow) {
                  plan.collateralAmount = plan.collateralAmount * plan.maxAmountToBorrow / plan.amountToBorrow;
                  plan.amountToBorrow = plan.maxAmountToBorrow;
                }

                //------------------------------- values for APR
                (plan.borrowCost36,
                  plan.supplyIncomeInBorrowAsset36
                ) = CompoundAprLib.getRawCostAndIncomes(
                  CompoundAprLib.getCore(f_, vars.cTokenCollateral, vars.cTokenBorrow),
                  plan.collateralAmount,
                  p_.countBlocks,
                  plan.amountToBorrow,
                  pd
                );

                plan.amountCollateralInBorrowAsset36 =
                  plan.collateralAmount * (10**36 * pd.priceCollateral / pd.priceBorrow)
                  / pd.rc10powDec;
              }
            } // else plan.maxAmountToBorrow = 0
          } // else ltv is zero
        } // else borrow token is not active
      } // else collateral token is not active
    }

    if (plan.converter == address(0)) {
      AppDataTypes.ConversionPlan memory planNotFound;
      return planNotFound;
    } else {
      return plan;
    }
  }
  //endregion ----------------------------------------------------- Get conversion plan

  //region ----------------------------------------------------- Calculate borrow rate after borrowing in advance

  /// @notice Estimate value of variable borrow rate after borrowing {amountToBorrow_}
  function getBorrowRateAfterBorrow(
    State storage state,
    CompoundLib.ProtocolFeatures memory f_,
    address borrowAsset_,
    uint amountToBorrow_
  ) internal view returns (uint) {
    address borrowCToken = state.activeAssets[borrowAsset_];
    return CompoundAprLib.getEstimatedBorrowRate(
      ICompoundInterestRateModel(ICTokenBase(borrowCToken).interestRateModel()),
      ICTokenBase(borrowCToken),
      amountToBorrow_
    );
  }
  //endregion ----------------------------------------------------- Calculate borrow rate after borrowing in advance

  //region ----------------------------------------------------- Utils

  /// @notice Check if the c-tokens are active and return LTV and liquidityThreshold values for the borrow
  function getMarketsInfo(
    State storage state,
    CompoundLib.ProtocolFeatures memory f_,
    address cTokenCollateral_,
    address cTokenBorrow_
  ) internal view returns (
    uint ltv18,
    uint liquidityThreshold18
  ) {
    ICompoundComptrollerBase comptroller = state.comptroller;
    if (
      !comptroller.borrowGuardianPaused(cTokenBorrow_) // borrowing is not paused
    && !comptroller.mintGuardianPaused(cTokenCollateral_) // minting is not paused
    ) {
      bool isListed;
      uint256 collateralFactorMantissa;
      if (f_.compoundStorageVersion == CompoundLib.COMPOUND_STORAGE_V1) {
        (isListed, collateralFactorMantissa) = ICompoundComptrollerBaseV1(address(comptroller)).markets(cTokenBorrow_);
      } else {
        (isListed, collateralFactorMantissa,) = ICompoundComptrollerBaseV2(address(comptroller)).markets(cTokenBorrow_);
      }

      if (isListed) {
        ltv18 = collateralFactorMantissa;
        if (f_.compoundStorageVersion == CompoundLib.COMPOUND_STORAGE_V1) {
          (isListed, collateralFactorMantissa) = ICompoundComptrollerBaseV1(address(comptroller)).markets(cTokenCollateral_);
        } else {
          (isListed, collateralFactorMantissa,) = ICompoundComptrollerBaseV2(address(comptroller)).markets(cTokenCollateral_);
        }
        if (isListed) {
          liquidityThreshold18 = collateralFactorMantissa;
        } else {
          ltv18 = 0; // not efficient, but it's error case
        }
      }
    }

    return (ltv18, liquidityThreshold18);
  }
  //endregion ----------------------------------------------------- Utils

}