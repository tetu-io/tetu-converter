// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "./HfAprLib.sol";
import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../openzeppelin/IERC20Metadata.sol";
import "../../libs/AppDataTypes.sol";
import "../../libs/AppErrors.sol";
import "../../libs/AppUtils.sol";
import "../../libs/EntryKinds.sol";
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
    uint entryKind;
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
    require(p_.amountIn != 0 && p_.countBlocks != 0, AppErrors.INCORRECT_VALUE);
    require(healthFactor2_ >= controller.minHealthFactor2(), AppErrors.WRONG_HEALTH_FACTOR);

    if (! frozen) {
      LocalsGetConversionPlan memory vars;
      vars.comptroller = comptroller;
      vars.cTokenCollateral = activeAssets[p_.collateralAsset];
      if (vars.cTokenCollateral != address(0)) {

        vars.cTokenBorrow = activeAssets[p_.borrowAsset];
        if (vars.cTokenBorrow != address(0)) {
          (plan.ltv18, plan.liquidationThreshold18) = getMarketsInfo(vars.cTokenCollateral, vars.cTokenBorrow);
          if (plan.ltv18 != 0 && plan.liquidationThreshold18 != 0) {
            //-------------------------------- converter, LTV and liquidation threshold
            plan.converter = converter;

            //------------------------------- Calculate maxAmountToSupply and maxAmountToBorrow
            plan.maxAmountToBorrow = IHfCToken(vars.cTokenBorrow).getCash();
            uint borrowCap = vars.comptroller.borrowCaps(vars.cTokenBorrow);
            if (borrowCap != 0) {
              uint totalBorrows = IHfCToken(vars.cTokenBorrow).totalBorrows();
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

            //-------------------------------- Prices and health factor
            vars.priceOracle = IHfPriceOracle(vars.comptroller.oracle());

            AppDataTypes.PricesAndDecimals memory pd;
            pd.rc10powDec = 10**IERC20Metadata(p_.collateralAsset).decimals();
            pd.rb10powDec = 10**IERC20Metadata(p_.borrowAsset).decimals();
            pd.priceCollateral = HfAprLib.getPrice(vars.priceOracle, vars.cTokenCollateral) * pd.rc10powDec;
            pd.priceBorrow = HfAprLib.getPrice(vars.priceOracle, vars.cTokenBorrow) * pd.rb10powDec;
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
            if (plan.collateralAmount >= plan.maxAmountToSupply
              || plan.amountToBorrow >= plan.maxAmountToBorrow
              || plan.amountToBorrow == 0
              || plan.collateralAmount == 0
            ) {
              plan.converter = address(0);
            } else {
            //------------------------------- values for APR
              (plan.borrowCost36,
               plan.supplyIncomeInBorrowAsset36
              ) = HfAprLib.getRawCostAndIncomes(
                HfAprLib.getCore(vars.cTokenCollateral, vars.cTokenBorrow),
                p_.amountIn,
                p_.countBlocks,
                plan.amountToBorrow,
                pd
              );

              plan.amountCollateralInBorrowAsset36 =
                p_.amountIn * (10**36 * pd.priceCollateral / pd.priceBorrow)
                / pd.rc10powDec;
            }
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
