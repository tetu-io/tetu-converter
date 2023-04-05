// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "./DForceAprLib.sol";
import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../openzeppelin/IERC20Metadata.sol";
import "../../libs/AppDataTypes.sol";
import "../../libs/AppErrors.sol";
import "../../libs/AppUtils.sol";
import "../../libs/EntryKinds.sol";
import "../../interfaces/IPlatformAdapter.sol";
import "../../interfaces/IConverterController.sol";
import "../../interfaces/IPoolAdapterInitializerWithAP.sol";
import "../../interfaces/ITokenAddressProvider.sol";
import "../../integrations/dforce/IDForcePriceOracle.sol";
import "../../integrations/dforce/IDForceInterestRateModel.sol";
import "../../integrations/dforce/IDForceController.sol";
import "../../integrations/dforce/IDForceCToken.sol";

/// @notice Adapter to read current pools info from DForce-protocol, see https://developers.dforce.network/
contract DForcePlatformAdapter is IPlatformAdapter, ITokenAddressProvider {
  using SafeERC20 for IERC20;
  using AppUtils for uint;

  //-----------------------------------------------------
  ///   Constants
  //-----------------------------------------------------
  string public constant override PLATFORM_ADAPTER_VERSION = "1.0.1";

  //-----------------------------------------------------
  ///   Data types
  //-----------------------------------------------------

  /// @notice Local vars inside getConversionPlan - to avoid stack too deep
  struct LocalsGetConversionPlan {
    IDForceController comptroller;
    IDForcePriceOracle priceOracle;
    uint healthFactor18;
    uint entryKind;
  }

  //-----------------------------------------------------
  ///   Variables
  //-----------------------------------------------------
  IConverterController immutable public controller;
  IDForceController immutable public comptroller;
  /// @notice Template of pool adapter
  address immutable public converter;
  /// @dev Same as controller.borrowManager(); we cache it for gas optimization
  address immutable public borrowManager;

  /// @notice All enabled pairs underlying : cTokens. All assets usable for collateral/to borrow.
  /// @dev There is no underlying for WMATIC, we store iMATIC:WMATIC
  mapping(address => address) public activeAssets;

  /// @notice True if the platform is frozen and new borrowing is not possible (at this moment)
  bool public override frozen;

  //-----------------------------------------------------
  ///               Events
  //-----------------------------------------------------
  event OnPoolAdapterInitialized(
    address converter,
    address poolAdapter,
    address user,
    address collateralAsset,
    address borrowAsset
  );
  event OnRegisterCTokens(address[] cTokens);

  //-----------------------------------------------------
  ///       Constructor and initialization
  //-----------------------------------------------------
  constructor (
    address controller_,
    address borrowManager_,
    address comptroller_,
    address templatePoolAdapter_,
    address[] memory activeCTokens_
  ) {
    require(
      comptroller_ != address(0)
      && borrowManager_ != address(0)
      && templatePoolAdapter_ != address(0)
      && controller_ != address(0),
      AppErrors.ZERO_ADDRESS
    );

    comptroller = IDForceController(comptroller_);
    controller = IConverterController(controller_);
    converter = templatePoolAdapter_;
    borrowManager = borrowManager_;

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

  /// @notice Set platform to frozen/unfrozen state. In frozen state any new borrowing is forbidden.
  function setFrozen(bool frozen_) external {
    require(msg.sender == controller.governance(), AppErrors.GOVERNANCE_ONLY);
    frozen = frozen_;
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
      // Special case: there is no underlying for WMATIC, so we store iMATIC:WMATIC
      activeAssets[DForceAprLib.getUnderlying(cTokens_[i])] = cTokens_[i];
    }
  }

  //-----------------------------------------------------
  ///                  Access
  //-----------------------------------------------------

  /// @notice Ensure that the caller is governance
  function _onlyGovernance() internal view {
    require(controller.governance() == msg.sender, AppErrors.GOVERNANCE_ONLY);
  }


  //-----------------------------------------------------
  ///                     View
  //-----------------------------------------------------

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

  //-----------------------------------------------------
  ///            Get conversion plan
  //-----------------------------------------------------

  function getConversionPlan (
    AppDataTypes.InputConversionParams memory p_,
    uint16 healthFactor2_
  ) external override view returns (
    AppDataTypes.ConversionPlan memory plan
  ) {
    require(p_.collateralAsset != address(0) && p_.borrowAsset != address(0), AppErrors.ZERO_ADDRESS);
    require(p_.amountIn != 0 && p_.countBlocks != 0, AppErrors.INCORRECT_VALUE);
    require(healthFactor2_ >= controller.minHealthFactor2(), AppErrors.WRONG_HEALTH_FACTOR);

    if (! frozen && !controller.paused()) {
      LocalsGetConversionPlan memory vars;
      vars.comptroller = comptroller;
      address cTokenCollateral = activeAssets[p_.collateralAsset];
      if (cTokenCollateral != address(0)) {
        address cTokenBorrow = activeAssets[p_.borrowAsset];
        if (cTokenBorrow != address(0)) {
          (uint collateralFactor, uint supplyCapacity) = _getCollateralMarketData(vars.comptroller, cTokenCollateral);
          if (collateralFactor != 0 && supplyCapacity != 0) {
            (uint borrowFactorMantissa, uint borrowCapacity) = _getBorrowMarketData(vars.comptroller, cTokenBorrow);
            if (borrowFactorMantissa != 0 && borrowCapacity != 0) {
              //------------------------------- Calculate maxAmountToSupply and maxAmountToBorrow
              plan.maxAmountToBorrow = IDForceCToken(cTokenBorrow).getCash();
              // BorrowCapacity: -1 means there is no limit on the capacity
              //                  0 means the asset can not be borrowed any more
              if (borrowCapacity != type(uint).max) { // == uint(-1)
                // we shouldn't exceed borrowCapacity limit, see Controller.beforeBorrow
                uint totalBorrow = IDForceCToken(cTokenBorrow).totalBorrows();
                if (totalBorrow > borrowCapacity) {
                  plan.maxAmountToBorrow = 0;
                } else {
                  if (totalBorrow + plan.maxAmountToBorrow > borrowCapacity) {
                    plan.maxAmountToBorrow = borrowCapacity - totalBorrow;
                  }
                }
              }

              if (supplyCapacity == type(uint).max) { // == uint(-1)
                plan.maxAmountToSupply = type(uint).max;
              } else {
                // we shouldn't exceed supplyCapacity limit, see Controller.beforeMint
                uint totalSupply = IDForceCToken(cTokenCollateral).totalSupply()
                  * IDForceCToken(cTokenCollateral).exchangeRateStored()
                  / 1e18;
                plan.maxAmountToSupply = totalSupply >= supplyCapacity
                  ? 0
                  : supplyCapacity - totalSupply;
              }

              if (plan.maxAmountToSupply != 0 && plan.maxAmountToBorrow != 0) {
                //-------------------------------- LTV and liquidation threshold
                plan.converter = converter;
                plan.liquidationThreshold18 = collateralFactor;
                plan.ltv18 = collateralFactor * borrowFactorMantissa / 10**18;

                //-------------------------------- Prices and health factor
                vars.priceOracle = IDForcePriceOracle(vars.comptroller.priceOracle());

                AppDataTypes.PricesAndDecimals memory pd;
                pd.rc10powDec = 10**IERC20Metadata(p_.collateralAsset).decimals();
                pd.rb10powDec = 10**IERC20Metadata(p_.borrowAsset).decimals();
                pd.priceCollateral = DForceAprLib.getPrice(vars.priceOracle, cTokenCollateral) * pd.rc10powDec;
                pd.priceBorrow = DForceAprLib.getPrice(vars.priceOracle, cTokenBorrow) * pd.rb10powDec;

                // calculate amount that can be borrowed and amount that should be provided as the collateral

                // Protocol has min allowed health factor at the borrow moment: liquidationThreshold18/LTV, i.e. 0.85/0.8=1.06...
                // Target health factor can be smaller but it's not possible to make a borrow with such low health factor
                // see explanation of health factor value in IConverterController.sol
                vars.healthFactor18 = plan.liquidationThreshold18 * 1e18 / plan.ltv18;
                if (vars.healthFactor18 < uint(healthFactor2_) * 10**(18 - 2)) {
                  vars.healthFactor18 = uint(healthFactor2_) * 10**(18 - 2);
                }

                //------------------------------- Calculate collateralAmount and amountToBorrow
                vars.entryKind = EntryKinds.getEntryKind(p_.entryData);
                if (vars.entryKind == EntryKinds.ENTRY_KIND_EXACT_COLLATERAL_IN_FOR_MAX_BORROW_OUT_0) {
                  plan.collateralAmount = p_.amountIn;
                  plan.amountToBorrow = EntryKinds.exactCollateralInForMaxBorrowOut(
                    p_.amountIn,
                    vars.healthFactor18,
                    plan.liquidationThreshold18,
                    pd,
                    true // prices have decimals 36
                  );
                } else if (vars.entryKind == EntryKinds.ENTRY_KIND_EXACT_PROPORTION_1) {
                  (plan.collateralAmount, plan.amountToBorrow) = EntryKinds.exactProportion(
                    p_.amountIn,
                    vars.healthFactor18,
                    plan.liquidationThreshold18,
                    pd,
                    p_.entryData,
                    true // prices have decimals 36
                  );
                } else if (vars.entryKind == EntryKinds.ENTRY_KIND_EXACT_BORROW_OUT_FOR_MIN_COLLATERAL_IN_2) {
                  plan.amountToBorrow = p_.amountIn;
                  plan.collateralAmount = EntryKinds.exactBorrowOutForMinCollateralIn(
                    p_.amountIn,
                    vars.healthFactor18,
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
                  if (plan.collateralAmount > plan.maxAmountToSupply) {
                    plan.amountToBorrow = plan.amountToBorrow * plan.maxAmountToSupply / plan.collateralAmount;
                    plan.collateralAmount = plan.maxAmountToSupply;
                  }

                  if (plan.amountToBorrow > plan.maxAmountToBorrow) {
                    plan.collateralAmount = plan.collateralAmount * plan.maxAmountToBorrow / plan.amountToBorrow;
                    plan.amountToBorrow = plan.maxAmountToBorrow;
                  }

                //------------------------------- values for APR
                  // calculate current borrow rate and predicted APR after borrowing required amount
                  (plan.borrowCost36,
                   plan.supplyIncomeInBorrowAsset36,
                   plan.rewardsAmountInBorrowAsset36
                  ) = DForceAprLib.getRawCostAndIncomes(
                    DForceAprLib.getCore(vars.comptroller, cTokenCollateral, cTokenBorrow),
                    plan.collateralAmount,
                    p_.countBlocks,
                    plan.amountToBorrow,
                    pd,
                    vars.priceOracle
                  );

                  plan.amountCollateralInBorrowAsset36 =
                    plan.collateralAmount * (10**36 * pd.priceCollateral / pd.priceBorrow)
                    / pd.rc10powDec;
                }
              } // else either max borrow or max supply amount is zero
            } // else the borrowing is not enabled
          } // else supply is not enabled
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

  //-----------------------------------------------------
  ///                    Utils
  //-----------------------------------------------------

  /// @dev See LendingContractsV2, ConverterController.sol, calcAccountEquityWithEffect
  /// @return collateralFactorMantissa Multiplier representing the most one can borrow against their collateral in
  ///         this market. For instance, 0.9 to allow borrowing 90% of collateral value.
  /// @return supplyCapacity iToken's supply capacity, -1 means no limit
  function _getCollateralMarketData(IDForceController comptroller_, address cTokenCollateral_) internal view returns (
    uint collateralFactorMantissa,
    uint supplyCapacity
  ) {
    (uint256 collateralFactorMantissa0,,, uint256 supplyCapacity0, bool mintPaused,,) = comptroller_
      .markets(cTokenCollateral_);
    return mintPaused || supplyCapacity0 == 0
      ? (0, 0)
      : (collateralFactorMantissa0, supplyCapacity0);
  }

  /// @dev See LendingContractsV2, ConverterController.sol, calcAccountEquityWithEffect
  /// @return borrowFactorMantissa Multiplier representing the most one can borrow the asset.
  ///         For instance, 0.5 to allow borrowing this asset 50% * collateral value * collateralFactor.
  /// @return borrowCapacity iToken's borrow capacity, -1 means no limit
  function _getBorrowMarketData(IDForceController comptroller_, address cTokenBorrow_) internal view returns (
    uint borrowFactorMantissa,
    uint borrowCapacity
  ) {
    (, uint256 borrowFactorMantissa0, uint256 borrowCapacity0,,, bool redeemPaused, bool borrowPaused) = comptroller_
      .markets(cTokenBorrow_);
    return (redeemPaused || borrowPaused || borrowCapacity0 == 0)
      ? (0, 0)
      : (borrowFactorMantissa0, borrowCapacity0);
  }

  // Currently we don't need this function, it can be helpful in next versions
  //  function getRewardAmounts(
  //    address collateralCToken_,
  //    uint collateralAmount_,
  //    address borrowCToken_,
  //    uint borrowAmount_,
  //    uint countBlocks_,
  //    uint delayBlocks_
  //  ) external view returns (
  //    uint rewardAmountSupply,
  //    uint rewardAmountBorrow,
  //    uint totalRewardsBT
  //  ) {
  //    DForceAprLib.DForceCore memory core = DForceAprLib.getCore(comptroller, collateralCToken_, borrowCToken_);
  //
  //    (uint priceBorrow, bool isPriceValid) = core.priceOracle.getUnderlyingPriceAndStatus(address(core.cTokenBorrow));
  //    require(priceBorrow != 0 && isPriceValid, AppErrors.ZERO_PRICE);
  //
  //    return DForceAprLib.getRewardAmountInBorrowAsset(core,
  //      DForceAprLib.RewardsAmountInput({
  //        collateralAmount: collateralAmount_,
  //        borrowAmount: borrowAmount_,
  //        countBlocks: countBlocks_,
  //        delayBlocks: delayBlocks_,
  //        priceBorrow36: priceBorrow * 10**core.cRewardsToken.decimals()
  //      })
  //    );
  //  }

}
