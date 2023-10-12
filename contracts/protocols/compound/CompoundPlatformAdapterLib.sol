// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./CompoundLib.sol";
import "./CompoundAprLib.sol";
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
import "../../integrations/compound/ICompoundComptrollerBaseV1.sol";
import "../../integrations/compound/ICompoundComptrollerBaseV2.sol";
import "../../libs/AppErrors.sol";
import "../../interfaces/IPoolAdapterInitializerWithAP.sol";
import "../../libs/EntryKinds.sol";
import "hardhat/console.sol";

library CompoundPlatformAdapterLib {
  using SafeERC20 for IERC20;

  //region ----------------------------------------------------- Data types
  struct State {
    IConverterController controller;
    ICompoundComptrollerBase comptroller;
    /// @notice Template of pool adapter
    address converter;

    /// @notice All enabled pairs underlying : cTokens. All assets usable for collateral/to borrow.
    /// @dev There is no underlying for native token, we store native-token:cToken-for-native-token
    mapping(address => address) activeAssets;

    /// @notice True if the platform is frozen and new borrowing is not possible (at this moment)
    bool frozen;
  }

  /// @notice Local vars inside getConversionPlan - to avoid stack too deep
  struct ConversionPlanLocal {
    ICompoundComptrollerBase comptroller;
    address cTokenCollateral;
    address cTokenBorrow;
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

  //region ----------------------------------------------------- Access
  /// @notice Ensure that the caller is governance
  function _onlyGovernance(State storage state) internal view {
    require(state.controller.governance() == msg.sender, AppErrors.GOVERNANCE_ONLY);
  }
  //endregion ----------------------------------------------------- Access

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
    IConverterController _controller = state.controller;

    require(msg.sender == _controller.borrowManager(), AppErrors.BORROW_MANAGER_ONLY);
    require(state.converter == converter_, AppErrors.CONVERTER_NOT_FOUND);

    // assume here that the pool adapter supports IPoolAdapterInitializer
    IPoolAdapterInitializerWithAP(poolAdapter_).initialize(
      address(_controller),
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
    _onlyGovernance(state);
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
    _onlyGovernance(state);
    _registerCTokens(state, f_, cTokens_);
    emit OnRegisterCTokens(cTokens_);
  }

  function _registerCTokens(
    State storage state,
    CompoundLib.ProtocolFeatures memory f_,
    address[] memory cTokens_
  ) internal {
    console.log("_registerCTokens");
    console.log("_registerCTokens,cTokenNative", f_.cTokenNative);
    console.log("_registerCTokens,nativeToken", f_.nativeToken);
    uint len = cTokens_.length;
    for (uint i; i < len; i = AppUtils.uncheckedInc(i)) {
      console.log("_registerCTokens,i", i);
      console.log("_registerCTokens,cTokens_[i]", cTokens_[i]);
      // Special case: there is no underlying for native token, so we store nativeToken:cTokenForNativeToken
      state.activeAssets[CompoundLib.getUnderlying(f_, cTokens_[i])] = cTokens_[i];
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
  /// @notice Reduce collateral amount and borrow amount proportionally to fit available limits
  function reduceAmountsByMax(
    AppDataTypes.ConversionPlan memory plan,
    uint collateralAmount_,
    uint amountToBorrow_
  ) internal pure returns (
    uint collateralAmount,
    uint amountToBorrow
  ) {
    if (amountToBorrow_ > plan.maxAmountToBorrow) {
      collateralAmount_= collateralAmount_ * plan.maxAmountToBorrow / amountToBorrow_;
      amountToBorrow_ = plan.maxAmountToBorrow;
    }
    if (collateralAmount_ > plan.maxAmountToSupply) {
      amountToBorrow_ = amountToBorrow_ * plan.maxAmountToSupply / collateralAmount_;
      collateralAmount_ = plan.maxAmountToSupply;
    }
    return (collateralAmount_, amountToBorrow_);
  }

  /// @notice Calculate amounts required to calculate APR. Don't calculate rewards amount (assume there are no rewards)
  /// @return borrowCost36 Cost for the period calculated using borrow rate in terms of borrow tokens, decimals 36
  /// @return supplyIncomeInBorrowAsset36 Potential supply increment after borrow period, recalculated to borrow asset, decimals 36
  /// @return amountCollateralInBorrowAsset36 Amount of collateral recalculated to borrow asset, decimals 36
  function getValuesForApr(
    uint collateralAmount,
    uint amountToBorrow,
    CompoundLib.ProtocolFeatures memory f_,
    address cTokenCollateral,
    address cTokenBorrow,
    uint countBlocks,
    AppDataTypes.PricesAndDecimals memory pd_
  ) internal view returns (
    uint borrowCost36,
    uint supplyIncomeInBorrowAsset36,
    uint amountCollateralInBorrowAsset36
  ) {
    (borrowCost36, supplyIncomeInBorrowAsset36) = CompoundAprLib.getRawCostAndIncomes(
      CompoundAprLib.getCore(f_, cTokenCollateral, cTokenBorrow),
      collateralAmount,
      countBlocks,
      amountToBorrow,
      pd_
    );

    amountCollateralInBorrowAsset36 =
      collateralAmount * (10**36 * pd_.priceCollateral / pd_.priceBorrow)
      / pd_.rc10powDec;
  }

  function getMaxAmountToBorrow(ConversionPlanLocal memory v) internal view returns (uint maxAmountToBorrow) {
    maxAmountToBorrow = ICTokenBase(v.cTokenBorrow).getCash();
    uint borrowCap = v.comptroller.borrowCaps(v.cTokenBorrow);
    if (borrowCap != 0) {
      uint totalBorrows = ICTokenBase(v.cTokenBorrow).totalBorrows();
      if (totalBorrows > borrowCap) {
        maxAmountToBorrow = 0;
      } else {
        if (totalBorrows + maxAmountToBorrow > borrowCap) {
          maxAmountToBorrow = borrowCap - totalBorrows;
        }
      }
    }
  }

  /// @notice Check {p_} values, ensure that selected assets are active and prepare {dest}
  /// @return True if all params are valid and {dest} is successfully prepared
  function initConversionPlanLocal(
    State storage state,
    AppDataTypes.InputConversionParams memory p_,
    ConversionPlanLocal memory dest
  ) internal view returns (bool) {
    if (! state.frozen) {
      dest.cTokenCollateral = state.activeAssets[p_.collateralAsset];
      if (dest.cTokenCollateral != address(0)) {
        dest.cTokenBorrow = state.activeAssets[p_.borrowAsset];
        if (dest.cTokenBorrow != address(0)) {
          dest.comptroller = state.comptroller;
          return true;
        }
      }
    }

    return false;
  }

  /// @notice Get prices and decimals of collateral and borrow assets, store them to {dest}
  function initPricesAndDecimals(
    AppDataTypes.PricesAndDecimals memory dest,
    address collateralAsset,
    address borrowAsset,
    ConversionPlanLocal memory vars
  ) internal view {
    ICompoundPriceOracle priceOracle = ICompoundPriceOracle(vars.comptroller.oracle());

    dest.rc10powDec = 10**IERC20Metadata(collateralAsset).decimals();
    dest.rb10powDec = 10**IERC20Metadata(borrowAsset).decimals();
    dest.priceCollateral = CompoundLib.getPrice(priceOracle, vars.cTokenCollateral) * dest.rc10powDec;
    dest.priceBorrow = CompoundLib.getPrice(priceOracle, vars.cTokenBorrow) * dest.rb10powDec;
  }

  /// @notice Calculate {collateralAmount} and {amountToBorrow} by {amountIn} according to the given entry kind
  /// @param priceDecimals36 Prices have decimals 36
  function getAmountsForEntryKind(
    AppDataTypes.InputConversionParams memory p_,
    uint liquidationThreshold18,
    uint16 healthFactor2_,
    AppDataTypes.PricesAndDecimals memory pd,
    bool priceDecimals36
  ) internal pure returns (
    uint collateralAmount,
    uint amountToBorrow
  ) {
    uint hf = uint(healthFactor2_) * 10**16;
    uint entryKind = EntryKinds.getEntryKind(p_.entryData);
    if (entryKind == EntryKinds.ENTRY_KIND_EXACT_COLLATERAL_IN_FOR_MAX_BORROW_OUT_0) {
      collateralAmount = p_.amountIn;
      amountToBorrow = EntryKinds.exactCollateralInForMaxBorrowOut(p_.amountIn, hf, liquidationThreshold18, pd, priceDecimals36);
    } else if (entryKind == EntryKinds.ENTRY_KIND_EXACT_PROPORTION_1) {
      (collateralAmount,
        amountToBorrow) = EntryKinds.exactProportion(p_.amountIn, hf, liquidationThreshold18, pd, p_.entryData, priceDecimals36);
    } else if (entryKind == EntryKinds.ENTRY_KIND_EXACT_BORROW_OUT_FOR_MIN_COLLATERAL_IN_2) {
      amountToBorrow = p_.amountIn;
      collateralAmount = EntryKinds.exactBorrowOutForMinCollateralIn(p_.amountIn, hf, liquidationThreshold18, pd, priceDecimals36);
    }

    return (collateralAmount, amountToBorrow);
  }
  //endregion ----------------------------------------------------- Get conversion plan

  //region ----------------------------------------------------- Calculate borrow rate after borrowing in advance

  /// @notice Estimate value of variable borrow rate after borrowing {amountToBorrow_}
  function getBorrowRateAfterBorrow(
    State storage state,
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