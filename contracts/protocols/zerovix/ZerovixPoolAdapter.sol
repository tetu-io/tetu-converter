// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../openzeppelin/Initializable.sol";
import "../../openzeppelin/IERC20Metadata.sol";
import "./ZerovixLib.sol";
import "../compound/CompoundPoolAdapterLib.sol";
import "../../libs/AppErrors.sol";
import "../../libs/AppUtils.sol";
import "../../interfaces/IDebtMonitor.sol";
import "../../interfaces/IPoolAdapter.sol";
import "../../interfaces/IConverterController.sol";
import "../../interfaces/IPoolAdapterInitializerWithAP.sol";
import "../../interfaces/ITokenAddressProvider.sol";
import "../../integrations/IWmatic.sol";
import "../../integrations/zerovix/IZerovixComptroller.sol";

/// @notice Implementation of IPoolAdapter for Zerovix-protocol, see https://docs.0vix.com/
/// @dev Instances of this contract are created using proxy-minimal pattern, so no constructor
contract ZerovixPoolAdapter is IPoolAdapter, IPoolAdapterInitializerWithAP, Initializable {
  using SafeERC20 for IERC20;

  //region ----------------------------------------------------- Constants and variables
  string public constant POOL_ADAPTER_VERSION = "1.0.0";

  CompoundPoolAdapterLib.State internal _state;
  //endregion ----------------------------------------------------- Constants and variables

  //region ----------------------------------------------------- Initialization

  function initialize(
    address controller_,
    address cTokenAddressProvider_,
    address comptroller_,
    address user_,
    address collateralAsset_,
    address borrowAsset_,
    address originConverter_
  ) override external
    // Borrow Manager creates a pool adapter using minimal proxy pattern, adds it the the set of known pool adapters
    // and initializes it immediately. We should ensure only that the re-initialization is not possible
  initializer
  {
    CompoundPoolAdapterLib.initialize(
      _state,
      controller_,
      cTokenAddressProvider_,
      comptroller_,
      user_,
      collateralAsset_,
      borrowAsset_,
      originConverter_
    );
  }
  //endregion ----------------------------------------------------- Initialization

  //region ----------------------------------------------------- Borrow logic
  function updateStatus() external override {
    CompoundPoolAdapterLib.updateStatus(_state);
  }

  /// @notice Supply collateral to the pool and borrow specified amount
  /// @dev No re-balancing here; Collateral amount must be approved to the pool adapter before the call of this function
  /// @param collateralAmount_ Amount of collateral, must be approved to the pool adapter before the call of borrow()
  /// @param borrowAmount_ Amount that should be borrowed in result
  /// @param receiver_ Receiver of the borrowed amount
  /// @return Result borrowed amount sent to the {receiver_}
  function borrow(uint collateralAmount_, uint borrowAmount_, address receiver_) external override returns (uint) {
    CompoundLib.ProtocolFeatures memory f;
    ZerovixLib.initProtocolFeatures(f);

    return CompoundPoolAdapterLib.borrow(_state, f, collateralAmount_, borrowAmount_, receiver_);
  }

  /// @notice Borrow additional amount {borrowAmount_} using exist collateral and send it to {receiver_}
  /// @dev Re-balance: too big health factor => target health factor
  /// @return resultHealthFactor18 Result health factor after borrow
  /// @return borrowedAmountOut Exact amount sent to the borrower
  function borrowToRebalance(uint borrowAmount_, address receiver_) external view override returns (
    uint resultHealthFactor18,
    uint borrowedAmountOut
  ) {
    CompoundLib.ProtocolFeatures memory f;
    ZerovixLib.initProtocolFeatures(f);

    return CompoundPoolAdapterLib.borrowToRebalance(_state, f, borrowAmount_, receiver_);
  }
  //endregion ----------------------------------------------------- Borrow logic

  //region ----------------------------------------------------- Repay logic

  /// @notice Repay borrowed amount, return collateral to the user
  /// @param amountToRepay_ Exact amount of borrow asset that should be repaid
  ///                       The amount should be approved for the pool adapter before the call of repay()
  /// @param closePosition_ true to pay full borrowed amount
  /// @param receiver_ Receiver of withdrawn collateral
  /// @return Amount of collateral asset sent to the {receiver_}
  function repay(uint amountToRepay_, address receiver_, bool closePosition_) external override returns (uint) {
    CompoundLib.ProtocolFeatures memory f;
    ZerovixLib.initProtocolFeatures(f);

    return CompoundPoolAdapterLib.repay(_state, f, amountToRepay_, receiver_, closePosition_);
  }

  /// @notice Repay with rebalancing. Send amount of collateral/borrow asset to the pool adapter
  ///         to recover the health factor to target state.
  /// @dev It's not allowed to close position here (pay full debt) because no collateral will be returned.
  /// @param amount_ Exact amount of asset that is transferred to the balance of the pool adapter.
  ///                It can be amount of collateral asset or borrow asset depended on {isCollateral_}
  ///                It must be stronger less then total borrow debt.
  ///                The amount should be approved for the pool adapter before the call.
  /// @param isCollateral_ true/false indicates that {amount_} is the amount of collateral/borrow asset
  /// @return resultHealthFactor18 Result health factor after repay, decimals 18
  function repayToRebalance(uint amount_, bool isCollateral_) external override returns (uint resultHealthFactor18) {
    CompoundLib.ProtocolFeatures memory f;
    ZerovixLib.initProtocolFeatures(f);

    return CompoundPoolAdapterLib.repayToRebalance(_state, f, amount_, isCollateral_);
  }

  /// @notice If we paid {amountToRepay_}, how much collateral would we receive?
  function getCollateralAmountToReturn(uint amountToRepay_, bool closePosition_) external view override returns (uint) {
    return CompoundPoolAdapterLib.getCollateralAmountToReturn(_state, amountToRepay_, closePosition_);
  }
  //endregion ----------------------------------------------------- Repay logic

  //region ----------------------------------------------------- Rewards
  function claimRewards(address /*receiver_*/ ) external pure override returns (
    address rewardToken,
    uint amount
  ) {
    // todo

    return (rewardToken, amount);
  }
  //endregion ----------------------------------------------------- Rewards

  //region ----------------------------------------------------- View current status

  /// @inheritdoc IPoolAdapter
  function getConfig() external view override returns (
    address origin,
    address outUser,
    address outCollateralAsset,
    address outBorrowAsset
  ) {
    return (_state.originConverter, _state.user, _state.collateralAsset, _state.borrowAsset);
  }

  /// @inheritdoc IPoolAdapter
  function getStatus() external view override returns (
    uint collateralAmount,
    uint amountToPay,
    uint healthFactor18,
    bool opened,
    uint collateralAmountLiquidated,
    bool debtGapRequired
  ) {
    CompoundLib.ProtocolFeatures memory f;
    ZerovixLib.initProtocolFeatures(f);

    return CompoundPoolAdapterLib.getStatus(_state, f);
  }

  function getConversionKind() external pure override returns (AppDataTypes.ConversionKind) {
    return AppDataTypes.ConversionKind.BORROW_2;
  }

  function controller() external view returns (address) {
    return address(_state.controller);
  }
  function comptroller() external view returns (address) {
    return address(_state.comptroller);
  }
  function collateralTokensBalance() external view returns (uint) {
    return _state.collateralTokensBalance;
  }
  //endregion ----------------------------------------------------- View current status

  //region ----------------------------------------------------- Native tokens
  receive() external payable {
    // this is needed for the native token unwrapping
    // no restrictions because this adpater is not used in production, it's for tests only
  }
  //endregion ----------------------------------------------------- Native tokens
}
