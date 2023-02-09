// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "../../libs/AppDataTypes.sol";
import "../../libs/EntryKinds.sol";
import "../../interfaces/IPlatformAdapter.sol";
import "hardhat/console.sol";
import "./PoolAdapterMock.sol";
import "../../libs/AppUtils.sol";

contract LendingPlatformMock is IPlatformAdapter {
  using AppUtils for uint;

  address private _pool;
  address[] private _converters;
  address private _controller;
  /// @notice asset => liquidation threshold18
  mapping(address => uint256) public liquidationThresholds18;
  address private _priceOracle;

  /// @notice asset => borrowRates in terms of borrow tokens, decimals is the decimals of the borrow token
  mapping(address => uint256) public borrowRates;
  /// @notice asset => supplyRate in terms of BORROW tokens, decimals is the decimals of the BORROW token
  mapping(address => uint256) public supplyRatesBt18;
  /// @notice asset => total reward amount, decimals 36
  mapping(address => uint256) public rewardsAmountsBt36;
  /// @notice asset => max available liquidity to borrow
  mapping(address => uint256) public liquidityToBorrow;
  mapping(address => uint) public maxAmountToSupply;
  /// @notice asset => cToken
  mapping(address => address) public cTokens;

  /// @notice True if the platform is frozen and new borrowing is not possible (at this moment)
  bool public override frozen;

  constructor(
    address controller_,
    address pool_,
    address priceOracle_,
    address[] memory converters_,
    address[] memory assets_,
    address[] memory cTokens_,
    uint[] memory liquidity_
  ) {
    _pool = pool_;
    _controller = controller_;
    _priceOracle = priceOracle_;
    _converters = converters_;

    for (uint i = 0; i < assets_.length; ++i) {
      liquidityToBorrow[assets_[i]] = liquidity_[i];
      cTokens[assets_[i]] = cTokens_[i];
    }
  }
  ///////////////////////////////////////////////////////////////////////////////
  ///  initialization
  ///////////////////////////////////////////////////////////////////////////////

  function setBorrowRates(address[] memory assets_, uint[] memory borrowRates_) external {
    for (uint i = 0; i < assets_.length; ++i) {
      borrowRates[assets_[i]] = borrowRates_[i];
    }
  }

  function setLiquidationThresholds(address[] memory assets_, uint[] memory liquidationThresholds18_) external {
    for (uint i = 0; i < assets_.length; ++i) {
      liquidationThresholds18[assets_[i]] = liquidationThresholds18_[i];
    }
  }

  function setSupplyRates(address[] memory assets_, uint[] memory supplyRateBt_) external {
    for (uint i = 0; i < assets_.length; ++i) {
      supplyRatesBt18[assets_[i]] = supplyRateBt_[i];
    }
  }

  /// @dev for simplicity, we set supply rate in BORROW tokens
  function setSupplyRate(address asset, uint supplyRateBt_) external {
    supplyRatesBt18[asset] = supplyRateBt_;
  }

  function setRewardsAmount(address asset, uint rewardsAmountsBt36_) external {
    rewardsAmountsBt36[asset] = rewardsAmountsBt36_;
  }

  function changeBorrowRate(address asset_, uint borrowRate_) external {
    borrowRates[asset_] = borrowRate_;
  }

  function setMaxAmountToSupply(address asset_, uint maxAmountToSupply_) external {
    maxAmountToSupply[asset_] = maxAmountToSupply_;
    console.log("setMaxAmountToSupply", asset_, maxAmountToSupply_, address(this));
  }

  /// @notice Set platform to frozen/unfrozen state. In frozen state any new borrowing is forbidden.
  function setFrozen(bool frozen_) external {
    require(msg.sender == IController(_controller).governance(), AppErrors.GOVERNANCE_ONLY);
    frozen = frozen_;
  }
  ///////////////////////////////////////////////////////////////////////////////
  ///  get conversion plan
  ///////////////////////////////////////////////////////////////////////////////

  function getConversionPlan (
    AppDataTypes.InputConversionParams memory p_,
    uint16 healthFactor2_
  ) external view override returns (
    AppDataTypes.ConversionPlan memory plan
  ) {
    if (frozen) {
      return plan;
    } else {
      uint decimalsBorrowAsset = IERC20Metadata(p_.borrowAsset).decimals();

      uint entryKind = EntryKinds.getEntryKind(p_.entryData);
      console.log("EntryKind", entryKind);
      if (entryKind == EntryKinds.ENTRY_KIND_EXACT_COLLATERAL_IN_FOR_MAX_BORROW_OUT_0) {
        plan.collateralAmount = p_.collateralAmount;
        plan.amountToBorrow = EntryKinds.exactCollateralInForMaxBorrowOut(
          p_.collateralAmount,
          uint(healthFactor2_) * 10**16,
          liquidationThresholds18[p_.collateralAsset],
          AppDataTypes.PricesAndDecimals({
            priceCollateral: IPriceOracle(_priceOracle).getAssetPrice(p_.collateralAsset),
            priceBorrow: IPriceOracle(_priceOracle).getAssetPrice(p_.borrowAsset),
            rc10powDec: 10 ** IERC20Metadata(p_.collateralAsset).decimals(),
            rb10powDec: 10 ** decimalsBorrowAsset
          }),
          false // prices have decimals 18, not 36
        );
      } else if (entryKind == EntryKinds.ENTRY_KIND_EXACT_PROPORTION_1) {
        (plan.collateralAmount, plan.amountToBorrow) = EntryKinds.exactProportion(
          p_.collateralAmount,
          uint(healthFactor2_) * 10**16,
          liquidationThresholds18[p_.collateralAsset],
          AppDataTypes.PricesAndDecimals({
            priceCollateral: IPriceOracle(_priceOracle).getAssetPrice(p_.collateralAsset),
            priceBorrow: IPriceOracle(_priceOracle).getAssetPrice(p_.borrowAsset),
            rc10powDec: 10 ** IERC20Metadata(p_.collateralAsset).decimals(),
            rb10powDec: 10 ** decimalsBorrowAsset
          }),
          p_.entryData,
          false // prices have decimals 18, not 36
        );
        console.log("Collaterals", plan.collateralAmount, p_.collateralAmount);
      }

      uint amountCollateralInBorrowAsset36 = AppUtils.toMantissa(
        p_.collateralAmount
          * IPriceOracle(_priceOracle).getAssetPrice(p_.collateralAsset)
          / IPriceOracle(_priceOracle).getAssetPrice(p_.borrowAsset),
        uint8(IERC20Metadata(p_.collateralAsset).decimals()),
        36
      );

      return AppDataTypes.ConversionPlan({
        converter: _converters[0], //TODO: make converter selectable
        liquidationThreshold18: liquidationThresholds18[p_.collateralAsset],
        ltv18: liquidationThresholds18[p_.collateralAsset],
        maxAmountToBorrow: liquidityToBorrow[p_.borrowAsset],
        maxAmountToSupply: maxAmountToSupply[p_.collateralAsset] == 0
          ? type(uint).max
          : maxAmountToSupply[p_.collateralAsset],
        amountToBorrow: plan.amountToBorrow,
        amountCollateralInBorrowAsset36: amountCollateralInBorrowAsset36,
  // For simplicity, costs and incomes don't depend on amount of borrow
        borrowCost36: borrowRates[p_.borrowAsset] * p_.countBlocks * 1e36 / 10**decimalsBorrowAsset,
        supplyIncomeInBorrowAsset36: supplyRatesBt18[p_.collateralAsset]  * p_.countBlocks * 1e36 / 10**decimalsBorrowAsset,
        rewardsAmountInBorrowAsset36: rewardsAmountsBt36[p_.borrowAsset],
        collateralAmount: plan.collateralAmount
      });
    }
  }

  function converters() external view override returns (address[] memory) {
    return _converters;
  }

  function initializePoolAdapter(
    address converter_,
    address poolAdapter_,
    address user_,
    address collateralAsset_,
    address borrowAsset_
  ) external override {
    console.log("initializePoolAdapter %s", poolAdapter_);
    PoolAdapterMock(poolAdapter_).initialize(
      _controller,
      _pool,
      user_,
      collateralAsset_,
      borrowAsset_,
      converter_,

      cTokens[collateralAsset_],
      liquidationThresholds18[collateralAsset_],
      borrowRates[borrowAsset_],
      _priceOracle
    );
  }

  function getBorrowRateAfterBorrow(address borrowAsset_, uint amountToBorrow_) external pure override returns (uint) {
    borrowAsset_;
    amountToBorrow_;

    return 0;
  }
}
