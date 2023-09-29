// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

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
import "../compound/CompoundPlatformAdapterLib.sol";
import "./MoonwellLib.sol";

/// @notice Adapter to read current pools info from HundredFinance-protocol, see https://docs.hundred.finance/
contract MoonwellPlatformAdapter is IPlatformAdapter, ITokenAddressProvider {
  using SafeERC20 for IERC20;
  using AppUtils for uint;

  //region ----------------------------------------------------- Constants
  string public constant override PLATFORM_ADAPTER_VERSION = "1.0.0";
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
  //endregion ----------------------------------------------------- View


  //region ----------------------------------------------------- Get conversion plan
  function getConversionPlan (
    AppDataTypes.InputConversionParams memory p_,
    uint16 healthFactor2_
  ) external override view returns (
    AppDataTypes.ConversionPlan memory plan
  ) {
    CompoundLib.ProtocolFeatures memory f;
    MoonwellLib.initProtocolFeatures(f);

    return CompoundPlatformAdapterLib.getConversionPlan(_state, f, p_, healthFactor2_);
  }
  //endregion ----------------------------------------------------- Get conversion plan

  //region ----------------------------------------------------- Calculate borrow rate after borrowing in advance

  /// @notice Estimate value of variable borrow rate after borrowing {amountToBorrow_}
  function getBorrowRateAfterBorrow(address borrowAsset_, uint amountToBorrow_) external view returns (uint) {
    CompoundLib.ProtocolFeatures memory f;
    MoonwellLib.initProtocolFeatures(f);

    return CompoundPlatformAdapterLib.getBorrowRateAfterBorrow(_state, f, borrowAsset_, amountToBorrow_);
  }
  //endregion ----------------------------------------------------- Calculate borrow rate after borrowing in advance

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
