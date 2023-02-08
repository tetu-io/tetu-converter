// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "./HfAprLib.sol";
import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../openzeppelin/IERC20Metadata.sol";
import "../../core/AppDataTypes.sol";
import "../../core/AppErrors.sol";
import "../../core/AppUtils.sol";
import "../../core/EntryKinds.sol";
import "../../interfaces/IController.sol";
import "../../interfaces/IPlatformAdapter.sol";
import "../../interfaces/IPoolAdapterInitializerWithAP.sol";
import "../../interfaces/ITokenAddressProvider.sol";
import "../../integrations/hundred-finance/IHfComptroller.sol";
import "../../integrations/hundred-finance/IHfCToken.sol";
import "../../integrations/hundred-finance/IHfPriceOracle.sol";
import "../../integrations/hundred-finance/IHfInterestRateModel.sol";

/// @notice Adapter to read current pools info from HundredFinance-protocol, see https://docs.hundred.finance/
contract HfPlatformAdapter is IPlatformAdapter, ITokenAddressProvider {
  using SafeERC20 for IERC20;
  using AppUtils for uint;

  ///////////////////////////////////////////////////////
  ///   Data types
  ///////////////////////////////////////////////////////

  /// @notice Local vars inside getConversionPlan - to avoid stack too deep
  struct LocalsGetConversionPlan {
    IHfComptroller comptroller;
    IHfPriceOracle priceOracle;
    address cTokenCollateral;
    address cTokenBorrow;
  }

  ///////////////////////////////////////////////////////
  ///   Variables
  ///////////////////////////////////////////////////////
  IController immutable public controller;
  IHfComptroller immutable public comptroller;
  /// @notice Template of pool adapter
  address immutable public converter;
  /// @dev Same as controller.borrowManager(); we cache it for gas optimization
  address immutable public borrowManager;


  /// @notice All enabled pairs underlying : cTokens. All assets usable for collateral/to borrow.
  /// @dev There is no underlying for WMATIC, we store hMATIC:WMATIC
  mapping(address => address) public activeAssets;

  /// @notice True if the platform is frozen and new borrowing is not possible (at this moment)
  bool public override frozen;

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

    comptroller = IHfComptroller(comptroller_);
    controller = IController(controller_);
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
    require(msg.sender == borrowManager, AppErrors.BORROW_MANAGER_ONLY);
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
    AppDataTypes.InputConversionParams memory p_,
    uint16 healthFactor2_
  ) external override view returns (
    AppDataTypes.ConversionPlan memory plan
  ) {
    require(p_.collateralAsset != address(0) && p_.borrowAsset != address(0), AppErrors.ZERO_ADDRESS);
    require(p_.collateralAmount != 0 && p_.countBlocks != 0, AppErrors.INCORRECT_VALUE);
    require(healthFactor2_ >= controller.minHealthFactor2(), AppErrors.WRONG_HEALTH_FACTOR);

    if (! frozen) {
      LocalsGetConversionPlan memory local;
      local.comptroller = comptroller;
      local.cTokenCollateral = activeAssets[p_.collateralAsset];
      if (local.cTokenCollateral != address(0)) {

        local.cTokenBorrow = activeAssets[p_.borrowAsset];
        if (local.cTokenBorrow != address(0)) {
          (plan.ltv18, plan.liquidationThreshold18) = getMarketsInfo(local.cTokenCollateral, local.cTokenBorrow);
          if (plan.ltv18 != 0 && plan.liquidationThreshold18 != 0) {
            plan.converter = converter;

            plan.maxAmountToBorrow = IHfCToken(local.cTokenBorrow).getCash();
            uint borrowCap = local.comptroller.borrowCaps(local.cTokenBorrow);
            if (borrowCap != 0) {
              uint totalBorrows = IHfCToken(local.cTokenBorrow).totalBorrows();
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

            local.priceOracle = IHfPriceOracle(local.comptroller.oracle());

            AppDataTypes.PricesAndDecimals memory vars;
            vars.rc10powDec = 10**IERC20Metadata(p_.collateralAsset).decimals();
            vars.rb10powDec = 10**IERC20Metadata(p_.borrowAsset).decimals();
            vars.priceCollateral = HfAprLib.getPrice(local.priceOracle, local.cTokenCollateral) * vars.rc10powDec;
            vars.priceBorrow = HfAprLib.getPrice(local.priceOracle, local.cTokenBorrow) * vars.rb10powDec;

            // calculate amount that can be borrowed
            // split calculation on several parts to avoid stack too deep

            // we assume that liquidationThreshold18 == ltv18 in this protocol, so the minimum health factor is 1
            if (p_.entryKind == EntryKinds.ENTRY_KIND_EXACT_COLLATERAL_IN_FOR_MAX_BORROW_OUT_0) {
              plan.collateralAmount = p_.collateralAmount;
              plan.amountToBorrow = EntryKinds.exactCollateralInForMaxBorrowOut(
                p_.collateralAmount,
                uint(healthFactor2_) * 10**16,
                plan.liquidationThreshold18,
                vars,
                true // prices have decimals 36
              );
            } else if (p_.entryKind == EntryKinds.ENTRY_KIND_EQUAL_COLLATERAL_AND_BORROW_OUT_1) {
              (plan.collateralAmount, plan.amountToBorrow) = EntryKinds.equalCollateralAndBorrow(
                p_.collateralAmount,
                uint(healthFactor2_) * 10**16,
                plan.liquidationThreshold18,
                vars,
                p_.entryData,
                true // prices have decimals 36
              );
            }
            if (plan.amountToBorrow > plan.maxAmountToBorrow) {
              plan.amountToBorrow = plan.maxAmountToBorrow;
            }

            // calculate current borrow rate and predicted APR after borrowing required amount
            (plan.borrowCost36,
             plan.supplyIncomeInBorrowAsset36
            ) = HfAprLib.getRawCostAndIncomes(
              HfAprLib.getCore(local.cTokenCollateral, local.cTokenBorrow),
              p_.collateralAmount,
              p_.countBlocks,
              plan.amountToBorrow,
              vars
            );

            plan.amountCollateralInBorrowAsset36 =
              p_.collateralAmount * (10**36 * vars.priceCollateral / vars.priceBorrow)
              / vars.rc10powDec;
          }
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
    IHfComptroller comptrollerLocal = comptroller;
    if (
      !comptroller.borrowGuardianPaused(cTokenBorrow_) // borrowing is not paused
      && !comptroller.mintGuardianPaused(cTokenCollateral_) // minting is not paused
    ) {
      (bool isListed, uint256 collateralFactorMantissa,) = comptrollerLocal.markets(cTokenBorrow_);
      if (isListed) {
        ltv18 = collateralFactorMantissa;
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
