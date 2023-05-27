// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "../../openzeppelin/IERC20.sol";
import "../../openzeppelin/IERC20Metadata.sol";
import "../../libs/AppErrors.sol";
import "../../libs/EntryKinds.sol";
import "../../interfaces/IConverterController.sol";
import "../../interfaces/IPlatformAdapter.sol";
import "../../interfaces/IPoolAdapterInitializerWithRewards.sol";
import "../../integrations/compound3/IComet.sol";
import "../../integrations/compound3/ICometRewards.sol";
import "./Compound3AprLib.sol";
import "hardhat/console.sol";

contract Compound3PlatformAdapter is IPlatformAdapter {
  //region ----------------------------------------------------- Constants
  string public constant override PLATFORM_ADAPTER_VERSION = "1.0.2";
  //endregion ----------------------------------------------------- Constants

  //region ----------------------------------------------------- Variables
  IConverterController immutable public controller;

  /// @notice Template of pool adapter
  address immutable public converter;

  /// @dev Same as controller.borrowManager(); we cache it for gas optimization
  address immutable public borrowManager;

  /// @notice True if the platform is frozen and new borrowing is not possible (at this moment)
  bool public override frozen;

  address[] public comets;

  address public cometRewards;
  //endregion ----------------------------------------------------- Variables

  //region ----------------------------------------------------- Events
  event OnPoolAdapterInitialized(address converter, address poolAdapter, address user, address collateralAsset, address borrowAsset);
  //endregion ----------------------------------------------------- Events

  //region ----------------------------------------------------- Initialization
  constructor(address controller_, address borrowManager_, address templatePoolAdapter_, address[] memory comets_, address cometRewards_) {
    require(
      borrowManager_ != address(0)
      && templatePoolAdapter_ != address(0)
      && controller_ != address(0)
      && comets_.length > 0
      && cometRewards_ != address(0),
      AppErrors.ZERO_ADDRESS
    );

    controller = IConverterController(controller_);
    converter = templatePoolAdapter_;
    borrowManager = borrowManager_;
    comets = comets_;
    cometRewards = cometRewards_;
  }
  //endregion ----------------------------------------------------- Initialization

  //region ----------------------------------------------------- Modifiers
  /// @notice Ensure that the caller is governance
  function _onlyGovernance() internal view {
    require(controller.governance() == msg.sender, AppErrors.GOVERNANCE_ONLY);
  }
  //endregion ----------------------------------------------------- Modifiers

  //region ----------------------------------------------------- Gov actions
  /// @notice Initialize {poolAdapter_} created from {converter_} using minimal proxy pattern
  function initializePoolAdapter(address converter_, address poolAdapter_, address user_, address collateralAsset_, address borrowAsset_) external override {
    require(msg.sender == borrowManager, AppErrors.BORROW_MANAGER_ONLY);
    require(converter == converter_, AppErrors.CONVERTER_NOT_FOUND);

    // borrowAsset_ must be baseToken of comet
    for (uint i; i < comets.length; ++i) {
      if (IComet(comets[i]).baseToken() == borrowAsset_) {
        IPoolAdapterInitializerWithRewards(poolAdapter_).initialize(
          address(controller),
          comets[i],
          cometRewards,
          user_,
          collateralAsset_,
          borrowAsset_,
          converter_
        );
        emit OnPoolAdapterInitialized(converter_, poolAdapter_, user_, collateralAsset_, borrowAsset_);
        return;
      }
    }

    revert(AppErrors.INCORRECT_BORROW_ASSET);
  }

  function addComet(address comet_) external {
    _onlyGovernance();
    comets.push(comet_);
  }

  function removeComet(uint index) external {
    _onlyGovernance();
    require(index < comets.length, AppErrors.INCORRECT_VALUE);
    comets[index] = comets[comets.length - 1];
    comets.pop();
  }

  /// @notice Set platform to frozen/unfrozen state. In frozen state any new borrowing is forbidden.
  function setFrozen(bool frozen_) external {
    _onlyGovernance();
    frozen = frozen_;
  }
  //endregion ----------------------------------------------------- Gov actions

  //region ----------------------------------------------------- Views
  function converters() external view override returns (address[] memory) {
    address[] memory dest = new address[](1);
    dest[0] = converter;
    return dest;
  }

  function platformKind() external pure returns (AppDataTypes.LendingPlatformKinds) {
    return AppDataTypes.LendingPlatformKinds.COMPOUND3_5;
  }


  /// @notice Get pool data required to select best lending pool
  /// @param healthFactor2_ Health factor (decimals 2) to be able to calculate max borrow amount
  ///                       See IConverterController for explanation of health factors.
  function getConversionPlan(AppDataTypes.InputConversionParams memory p_, uint16 healthFactor2_) external view returns (
    AppDataTypes.ConversionPlan memory plan
  ) {
    require(p_.collateralAsset != address(0) && p_.borrowAsset != address(0), AppErrors.ZERO_ADDRESS);
    require(p_.amountIn != 0 && p_.countBlocks != 0, AppErrors.INCORRECT_VALUE);
    require(healthFactor2_ >= controller.minHealthFactor2(), AppErrors.WRONG_HEALTH_FACTOR);

    if (!frozen && !controller.paused()) {
      address cometAddress = _getCometForBorrowAsset(p_.borrowAsset);
      if (cometAddress != address(0)) {
        // comet was found
        IComet _comet = IComet(cometAddress);
        if (!_comet.isSupplyPaused() && !_comet.isWithdrawPaused()) {
          for (uint8 k; k < _comet.numAssets(); ++k) {
            IComet.AssetInfo memory assetInfo = _comet.getAssetInfo(k);
            if (assetInfo.asset == p_.collateralAsset) {
              // collateral asset was found

              AppDataTypes.PricesAndDecimals memory pd;
              pd.rc10powDec = 10**IERC20Metadata(p_.collateralAsset).decimals();
              pd.rb10powDec = 10**IERC20Metadata(p_.borrowAsset).decimals();
              pd.priceCollateral = Compound3AprLib.getPrice(assetInfo.priceFeed);
              pd.priceBorrow = Compound3AprLib.getPrice(_comet.baseTokenPriceFeed());

              plan.maxAmountToBorrow = IERC20(p_.borrowAsset).balanceOf(address(_comet));
              uint b = IERC20(p_.collateralAsset).balanceOf(address(_comet));
              if (b < assetInfo.supplyCap) {
                plan.maxAmountToSupply = assetInfo.supplyCap - b;
              }

              if (plan.maxAmountToBorrow > 0 && plan.maxAmountToSupply > 0) {
                plan.converter = converter;
                plan.ltv18 = assetInfo.borrowCollateralFactor;
                plan.liquidationThreshold18 = assetInfo.liquidateCollateralFactor;

                uint healthFactor18 = plan.liquidationThreshold18 * 1e18 / plan.ltv18;
                if (healthFactor18 < uint(healthFactor2_) * 10**(18 - 2)) {
                  healthFactor18 = uint(healthFactor2_) * 10**(18 - 2);
                }

                uint entryKind = EntryKinds.getEntryKind(p_.entryData);
                if (entryKind == EntryKinds.ENTRY_KIND_EXACT_COLLATERAL_IN_FOR_MAX_BORROW_OUT_0) {
                  plan.collateralAmount = p_.amountIn;
                  plan.amountToBorrow = EntryKinds.exactCollateralInForMaxBorrowOut(
                    p_.amountIn,
                    healthFactor18,
                    plan.liquidationThreshold18,
                    pd,
                    false
                  );
                } else if (entryKind == EntryKinds.ENTRY_KIND_EXACT_PROPORTION_1) {
                  (plan.collateralAmount, plan.amountToBorrow) = EntryKinds.exactProportion(
                    p_.amountIn,
                    healthFactor18,
                    plan.liquidationThreshold18,
                    pd,
                    p_.entryData,
                    false
                  );
                } else if (entryKind == EntryKinds.ENTRY_KIND_EXACT_BORROW_OUT_FOR_MIN_COLLATERAL_IN_2) {
                  plan.amountToBorrow = p_.amountIn;
                  plan.collateralAmount = EntryKinds.exactBorrowOutForMinCollateralIn(
                    p_.amountIn,
                    healthFactor18,
                    plan.liquidationThreshold18,
                    pd,
                    false
                  );
                }

                if (plan.amountToBorrow > plan.maxAmountToBorrow) {
                  plan.collateralAmount = plan.collateralAmount * plan.maxAmountToBorrow / plan.amountToBorrow;
                  plan.amountToBorrow = plan.maxAmountToBorrow;
                }

                if (plan.collateralAmount > plan.maxAmountToSupply) {
                  plan.amountToBorrow = plan.amountToBorrow * plan.maxAmountToSupply / plan.collateralAmount;
                  plan.collateralAmount = plan.maxAmountToSupply;
                }

                if (plan.amountToBorrow < _comet.baseBorrowMin()) {
                  plan.converter = address(0);
                }

                plan.amountCollateralInBorrowAsset36 = plan.collateralAmount * (1e36 * pd.priceCollateral / pd.priceBorrow) / pd.rc10powDec;
                plan.borrowCost36 = Compound3AprLib.getBorrowCost36(_comet, plan.amountToBorrow, p_.countBlocks, controller.blocksPerDay(), pd.rb10powDec);
                plan.rewardsAmountInBorrowAsset36 = Compound3AprLib.getRewardsAmountInBorrowAsset36(_comet, cometRewards, controller, plan.amountToBorrow, p_.countBlocks, controller.blocksPerDay(), pd.rb10powDec);
              }
              break;
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

  function _getCometForBorrowAsset(address borrowAsset) internal view returns(address) {
    uint length = comets.length;
    for (uint i; i < length; ++i) {
      IComet _comet = IComet(comets[i]);
      if (_comet.baseToken() == borrowAsset) {
        return address(_comet);
      }
    }
    return address(0);
  }

  function cometsLength() external view returns (uint) {
    return comets.length;
  }
  //endregion ----------------------------------------------------- Views
}