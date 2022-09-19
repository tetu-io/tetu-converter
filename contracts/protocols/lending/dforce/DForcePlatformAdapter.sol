// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "./DForceAprLib.sol";
import "../../../core/AppDataTypes.sol";
import "../../../core/AppErrors.sol";
import "../../../core/AppUtils.sol";
import "../../../openzeppelin/SafeERC20.sol";
import "../../../openzeppelin/IERC20.sol";
import "../../../interfaces/IPlatformAdapter.sol";
import "../../../interfaces/IController.sol";
import "../../../interfaces/IPoolAdapterInitializerWithAP.sol";
import "../../../interfaces/ITokenAddressProvider.sol";
import "../../../integrations/dforce/IDForcePriceOracle.sol";
import "../../../integrations/IERC20Extended.sol";
import "../../../integrations/dforce/IDForceInterestRateModel.sol";
import "../../../integrations/dforce/IDForceController.sol";
import "../../../integrations/dforce/IDForceCToken.sol";
import "hardhat/console.sol";

/// @notice Adapter to read current pools info from DForce-protocol, see https://developers.dforce.network/
contract DForcePlatformAdapter is IPlatformAdapter, ITokenAddressProvider {
  using SafeERC20 for IERC20;
  using AppUtils for uint;

  address private constant WMATIC = address(0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270);
  address private constant iMATIC = address(0x6A3fE5342a4Bd09efcd44AC5B9387475A0678c74);

  IController public controller;
  IDForceController public comptroller;

  /// @notice Template of pool adapter
  address _converter;

  /// @notice All enabled pairs underlying : cTokens. All assets usable for collateral/to borrow.
  /// @dev There is no underlying for WMATIC, we store iMATIC:WMATIC
  mapping(address => address) public activeAssets;

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
      && controller_ != address(0)
    , AppErrors.ZERO_ADDRESS);

    comptroller = IDForceController(comptroller_);
    controller = IController(controller_);

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
        // Special case: there is no underlying for WMATIC, so we store iMATIC:WMATIC
        address underlying = iMATIC == cTokens_[i]
          ? WMATIC
          : IDForceCToken(cTokens_[i]).underlying();
        activeAssets[underlying] = cTokens_[i];
      }
    } else {
      for (uint i = 0; i < lenCTokens; i = i.uncheckedInc()) {
        delete activeAssets[cTokens_[i]];
      }
    }
  }

  ///////////////////////////////////////////////////////
  ///                  Access
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
    IDForcePriceOracle priceOracle = IDForcePriceOracle(comptroller.priceOracle());

    uint lenAssets = assets_.length;
    prices18 = new uint[](lenAssets);
    for (uint i = 0; i < lenAssets; i = i.uncheckedInc()) {
      console.log("Token", activeAssets[assets_[i]]);
      address cToken = activeAssets[assets_[i]];

      // we get a price with decimals = (36 - asset decimals)
      // let's convert it to decimals = 18
      (uint underlyingPrice, bool isPriceValid) = priceOracle.getUnderlyingPriceAndStatus(address(cToken));
      console.log("underlyingPrice", underlyingPrice, isPriceValid);
      require(underlyingPrice != 0 && isPriceValid, AppErrors.ZERO_PRICE);

      prices18[i] = underlyingPrice / (10 ** (18 - IERC20Extended(assets_[i]).decimals()));
    }

    return prices18;
  }

  function getCTokenByUnderlying(address token1_, address token2_)
  external view override
  returns (address cToken1, address cToken2, address priceOracle) {
    return (activeAssets[token1_], activeAssets[token2_], comptroller.priceOracle());
  }

  ///////////////////////////////////////////////////////
  ///            Get conversion plan
  ///////////////////////////////////////////////////////

  function getConversionPlan (
    address collateralAsset_,
    uint collateralAmount_,
    address borrowAsset_,
    uint borrowAmountFactor18_,
    uint countBlocks_
  ) external override view returns (
    AppDataTypes.ConversionPlan memory plan
  ) {
    console.log("getConversionPlan");
    IDForceController comptrollerLocal = comptroller;
    address cTokenCollateral = activeAssets[collateralAsset_];
    if (cTokenCollateral != address(0)) {

      address cTokenBorrow = activeAssets[borrowAsset_];
      if (cTokenBorrow != address(0)) {
        (uint collateralFactor, uint supplyCapacity) = _getCollateralMarketData(comptrollerLocal, cTokenCollateral);
        if (collateralFactor != 0 && supplyCapacity != 0) {
          (uint borrowFactorMantissa, uint borrowCapacity) = _getBorrowMarketData(comptrollerLocal, cTokenBorrow);

          if (borrowFactorMantissa != 0 && borrowCapacity != 0) {
            plan.converter = _converter;

            plan.liquidationThreshold18 = collateralFactor;
            plan.ltv18 = collateralFactor * borrowFactorMantissa / 10**18;

            plan.maxAmountToBorrowBT = IDForceCToken(cTokenBorrow).getCash();
            if (borrowCapacity != type(uint).max) { // == uint(-1)
              // we shouldn't exceed borrowCapacity limit, see Controller.beforeBorrow
              uint totalBorrow = IDForceCToken(cTokenBorrow).totalBorrows();
              if (totalBorrow > borrowCapacity) {
                plan.maxAmountToBorrowBT = 0;
              } else {
                if (totalBorrow + plan.maxAmountToBorrowBT > borrowCapacity) {
                  plan.maxAmountToBorrowBT = borrowCapacity - totalBorrow;
                }
              }
            }

            if (supplyCapacity == type(uint).max) { // == uint(-1)
              plan.maxAmountToSupplyCT = type(uint).max;
            } else {
              // we shouldn't exceed supplyCapacity limit, see Controller.beforeMint
              uint totalSupply = IDForceCToken(cTokenCollateral).totalSupply()
                * IDForceCToken(cTokenCollateral).exchangeRateStored();
              plan.maxAmountToSupplyCT = totalSupply >= supplyCapacity
                ? type(uint).max
                : supplyCapacity - totalSupply;
            }
          }

          // calculate current borrow rate and predicted APR after borrowing required amount
          uint amountToBorrow = AppUtils.toMantissa(
            borrowAmountFactor18_ * plan.liquidationThreshold18 / 1e18
            , 18
            , IDForceCToken(cTokenBorrow).decimals()
          );
          console.log("DForcePlatformAdapter borrowAmountFactor18_=", borrowAmountFactor18_);
          console.log("DForcePlatformAdapter amountToBorrow=", amountToBorrow);
          console.log("DForcePlatformAdapter liquidationThreshold18=", plan.liquidationThreshold18);
          if (amountToBorrow > plan.maxAmountToBorrowBT) {
            amountToBorrow = plan.maxAmountToBorrowBT;
            console.log("DForcePlatformAdapter amountToBorrow CORRECTED=", amountToBorrow);
          }

          (plan.borrowApr36, plan.supplyAprBt36, plan.rewardsAmountBt36) = DForceAprLib.getRawAprInfo36(
            DForceAprLib.getCore(comptroller, cTokenCollateral, cTokenBorrow),
            collateralAmount_,
            countBlocks_,
            amountToBorrow
          );
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
  function getBorrowRateAfterBorrow(
    address borrowAsset_,
    uint amountToBorrow_
  ) external view override returns (uint) {
    address borrowCToken = activeAssets[borrowAsset_];
    return DForceAprLib.getEstimatedBorrowRate(
      IDForceInterestRateModel(IDForceCToken(borrowCToken).interestRateModel()),
      IDForceCToken(borrowCToken),
      amountToBorrow_
    );
  }

  function getRewardAmounts(
    address collateralCToken_,
    uint collateralAmount_,
    address borrowCToken_,
    uint borrowAmount_,
    uint countBlocks_,
    uint delayBlocks_
  ) external view returns (
    uint rewardAmountSupply,
    uint rewardAmountBorrow,
    uint totalRewardsBT
  ) {
    DForceAprLib.DForceCore memory core = DForceAprLib.getCore(comptroller, collateralCToken_, borrowCToken_);

    (uint priceBorrow, bool isPriceValid) = core.priceOracle.getUnderlyingPriceAndStatus(address(core.cTokenBorrow));
    require(priceBorrow != 0 && isPriceValid, AppErrors.ZERO_PRICE);

    return DForceAprLib.getRewardAmountsBt(core,
      DForceAprLib.RewardsAmountInput({
        collateralAmount: collateralAmount_,
        borrowAmount: borrowAmount_,
        countBlocks: countBlocks_,
        delayBlocks: delayBlocks_,
        priceBorrow36: priceBorrow * 10**core.cRewardsToken.decimals()
      })
    );
  }

  ///////////////////////////////////////////////////////
  ///                    Utils
  ///////////////////////////////////////////////////////

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
}