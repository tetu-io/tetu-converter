// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./MoonwellLib.sol";
import "../compound/CompoundPlatformAdapterLib.sol";
import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../openzeppelin/IERC20Metadata.sol";
import "../../libs/AppDataTypes.sol";
import "../../libs/AppErrors.sol";
import "../../libs/AppUtils.sol";
import "../../libs/EntryKinds.sol";
import "../../interfaces/IConverterController.sol";
import "../../interfaces/IPlatformAdapter.sol";
import "../../interfaces/IPoolAdapterInitializerWithAP.sol";
import "../../interfaces/ITokenAddressProvider.sol";
import "../../integrations/moonwell/IMoonwellComptroller.sol";

/// @notice Adapter to read current pools info from HundredFinance-protocol, see https://docs.hundred.finance/
contract MoonwellPlatformAdapter is IPlatformAdapter, ITokenAddressProvider {
  using SafeERC20 for IERC20;
  using AppUtils for uint;

  //region ----------------------------------------------------- Constants
  string public constant override PLATFORM_ADAPTER_VERSION = "1.0.0";
  uint constant public COUNT_SECONDS_PER_YEAR = 365 days; // 31536000;
  //endregion ----------------------------------------------------- Constants

  //region ----------------------------------------------------- Variables
  CompoundPlatformAdapterLib.State internal _state;
  //endregion ----------------------------------------------------- Variables

  //region ----------------------------------------------------- Constructor and initialization
  /// @param template_ Template of the pool adapter
  constructor (address controller_, address comptroller_, address template_, address[] memory activeCTokens_) {
    CompoundLib.ProtocolFeatures memory f;
    MoonwellLib.initProtocolFeatures(f);

    CompoundPlatformAdapterLib.init(_state, f, controller_, comptroller_, template_, activeCTokens_);
  }

  /// @notice Initialize {poolAdapter_} created from {converter_} using minimal proxy pattern
  function initializePoolAdapter(
    address converter_,
    address poolAdapter_,
    address user_,
    address collateralAsset_,
    address borrowAsset_
  ) external override {
    CompoundPlatformAdapterLib.initializePoolAdapter(_state, converter_, poolAdapter_, user_, collateralAsset_, borrowAsset_);
  }

  /// @notice Set platform to frozen/unfrozen state. In frozen state any new borrowing is forbidden.
  function setFrozen(bool frozen_) external {
    CompoundPlatformAdapterLib.setFrozen(_state, frozen_);
  }

  /// @notice Register new CTokens supported by the market
  /// @dev It's possible to add CTokens only because, we can add unregister function if necessary
  function registerCTokens(address[] memory cTokens_) external {
    CompoundLib.ProtocolFeatures memory f;
    MoonwellLib.initProtocolFeatures(f);

    CompoundPlatformAdapterLib.registerCTokens(_state, f, cTokens_);
  }
  //endregion ----------------------------------------------------- Constructor and initialization

  //region ----------------------------------------------------- View
  function converters() external view override returns (address[] memory) {
    address[] memory dest = new address[](1);
    dest[0] = _state.converter;
    return dest;
  }

  function getCTokenByUnderlying(address token1_, address token2_) external view override returns (
    address cToken1,
    address cToken2
  ) {
    return CompoundPlatformAdapterLib.getCTokenByUnderlying(_state, token1_, token2_);
  }

  function platformKind() external pure returns (AppDataTypes.LendingPlatformKinds) {
    return AppDataTypes.LendingPlatformKinds.MOONWELL_6;
  }

  function frozen() external view returns (bool) {
    return _state.frozen;
  }

  function controller() external view returns (address) {
    return address(_state.controller);
  }
  function comptroller() external view returns (address) {
    return address(_state.comptroller);
  }
  function activeAssets(address cToken) external view returns (address) {
    return _state.activeAssets[cToken];
  }
  //endregion ----------------------------------------------------- View


  //region ----------------------------------------------------- Get conversion plan
  function getConversionPlan (
    AppDataTypes.InputConversionParams memory p_,
    uint16 healthFactor2_
  ) external override view returns (
    AppDataTypes.ConversionPlan memory plan
  ) {
    require(p_.collateralAsset != address(0) && p_.borrowAsset != address(0), AppErrors.ZERO_ADDRESS);
    require(p_.amountIn != 0 && p_.countBlocks != 0, AppErrors.INCORRECT_VALUE);
    require(healthFactor2_ >= _state.controller.minHealthFactor2(), AppErrors.WRONG_HEALTH_FACTOR);

    CompoundPlatformAdapterLib.ConversionPlanLocal memory v;
    if (CompoundPlatformAdapterLib.initConversionPlanLocal(_state, p_, v)) {

      // LTV and liquidation threshold
      CompoundLib.ProtocolFeatures memory f;
      MoonwellLib.initProtocolFeatures(f);

      (plan.ltv18, plan.liquidationThreshold18) = CompoundPlatformAdapterLib.getMarketsInfo(
        _state, f, v.cTokenCollateral, v.cTokenBorrow
      );
      if (plan.ltv18 != 0 && plan.liquidationThreshold18 != 0) {

        // Calculate maxAmountToSupply and maxAmountToBorrow
        plan.maxAmountToBorrow = CompoundPlatformAdapterLib.getMaxAmountToBorrow(v);
        plan.maxAmountToSupply = type(uint).max; // unlimited; fix validation below after changing this value

        if (plan.maxAmountToBorrow != 0 && plan.maxAmountToSupply != 0) {
          // Prices and health factor
          AppDataTypes.PricesAndDecimals memory pd;
          CompoundPlatformAdapterLib.initPricesAndDecimals(pd, p_.collateralAsset, p_.borrowAsset, v);
          // ltv and liquidation threshold are exactly the same in HundredFinance
          // so, there is no min health factor, we can directly use healthFactor2_ in calculations below

          // Calculate collateralAmount and amountToBorrow
          // we assume that liquidationThreshold18 == ltv18 in this protocol, so the minimum health factor is 1
          (plan.collateralAmount, plan.amountToBorrow) = CompoundPlatformAdapterLib.getAmountsForEntryKind(
            p_, plan.liquidationThreshold18, healthFactor2_, pd, true
          );

          // Validate the borrow, calculate amounts for APR
          if (plan.amountToBorrow != 0 && plan.collateralAmount != 0) {
            plan.converter = _state.converter;
            (plan.collateralAmount, plan.amountToBorrow) = CompoundPlatformAdapterLib.reduceAmountsByMax(
              plan, plan.collateralAmount, plan.amountToBorrow
            );
            (
              plan.borrowCost36, plan.supplyIncomeInBorrowAsset36, plan.amountCollateralInBorrowAsset36
            ) = CompoundPlatformAdapterLib.getValuesForApr(
              plan.collateralAmount, plan.amountToBorrow, f, v.cTokenCollateral, v.cTokenBorrow, p_.countBlocks, pd
            );

            plan.rewardsAmountInBorrowAsset36 = estimateRewardsAmountInBorrowAsset36(p_, v, plan, pd);
          }
        }
      }
    }

    if (plan.converter == address(0)) {
      AppDataTypes.ConversionPlan memory planNotFound;
      return planNotFound;
    } else {
      return plan;
    }
  }

  /// @notice Estimate amount of any rewards that can be received for the borrowing according the {plan}
  function estimateRewardsAmountInBorrowAsset36(
    AppDataTypes.InputConversionParams memory p_,
    CompoundPlatformAdapterLib.ConversionPlanLocal memory v,
    AppDataTypes.ConversionPlan memory plan,
    AppDataTypes.PricesAndDecimals memory pd
  ) public view returns (uint) {
    uint periodSec = p_.countBlocks * COUNT_SECONDS_PER_YEAR / (_state.controller.blocksPerDay() * 365);
    (uint rewardsSupply, uint rewardsBorrow) = MoonwellLib.estimateRewardAmounts(
      v.cTokenCollateral,
      v.cTokenBorrow,
      plan.collateralAmount,
      plan.amountToBorrow,
      uint32(periodSec == 0 ? 1 : periodSec),
      IMoonwellComptroller(address(v.comptroller)).rewardDistributor(),
      ITetuLiquidator(_state.controller.tetuLiquidator()),
      p_.borrowAsset
    );
    return (rewardsSupply + rewardsBorrow) * 10**36 / pd.rb10powDec;
  }
  //endregion ----------------------------------------------------- Get conversion plan

  //region ----------------------------------------------------- Utils

  /// @notice Check if the c-tokens are active and return LTV and liquidityThreshold values for the borrow
  function getMarketsInfo(address cTokenCollateral_, address cTokenBorrow_) public view returns (
    uint ltv18,
    uint liquidityThreshold18
  ) {
    CompoundLib.ProtocolFeatures memory f;
    MoonwellLib.initProtocolFeatures(f);

    return CompoundPlatformAdapterLib.getMarketsInfo(_state, f, cTokenCollateral_, cTokenBorrow_);
  }
  //endregion ----------------------------------------------------- Utils
}
