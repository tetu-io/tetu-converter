// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../openzeppelin/Initializable.sol";
import "../../libs/AppErrors.sol";
import "../../interfaces/IConverterController.sol";
import "../../interfaces/IPoolAdapter.sol";
import "../../interfaces/IPoolAdapterInitializer.sol";
import "../../interfaces/IDebtMonitor.sol";
import "../../integrations/compound3/IComet.sol";
import "./Compound3AprLib.sol";

contract Compound3PoolAdapter is IPoolAdapter, IPoolAdapterInitializer, Initializable {
  using SafeERC20 for IERC20;

  ///////////////////////////////////////////////////////
  ///                Constants
  ///////////////////////////////////////////////////////

  ///////////////////////////////////////////////////////
  ///                Variables
  ///////////////////////////////////////////////////////

  address public collateralAsset;
  address public borrowAsset;
  address public user;
  IComet public comet;
  IConverterController public controller;
  address public originConverter;
  uint public collateralTokensBalance;

  ///////////////////////////////////////////////////////
  ///                Events
  ///////////////////////////////////////////////////////

  event OnInitialized(address controller, address pool, address user, address collateralAsset, address borrowAsset, address originConverter);
  event OnBorrow(uint collateralAmount, uint borrowAmount, address receiver, uint resultHealthFactor18);
  event OnRepay(uint amountToRepay, address receiver, bool closePosition, uint resultHealthFactor18);

  ///////////////////////////////////////////////////////
  ///                Initialization
  ///////////////////////////////////////////////////////

  function initialize(
    address controller_,
    address comet_,
    address user_,
    address collateralAsset_,
    address borrowAsset_,
    address originConverter_
  ) external initializer {
    require(
      controller_ != address(0)
      && comet_ != address(0)
      && user_ != address(0)
      && collateralAsset_ != address(0)
      && borrowAsset_ != address(0)
      && originConverter_ != address(0),
      AppErrors.ZERO_ADDRESS
    );

    controller = IConverterController(controller_);
    user = user_;
    collateralAsset = collateralAsset_;
    borrowAsset = borrowAsset_;
    originConverter = originConverter_;

    comet = IComet(comet_);

    // The pool adapter doesn't keep assets on its balance, so it's safe to use infinity approve
    // All approves replaced by infinity-approve were commented in the code below
    IERC20(collateralAsset_).safeApprove(comet_, 2**255); // 2*255 is more gas-efficient than type(uint).max
    IERC20(borrowAsset_).safeApprove(comet_, 2**255);

    emit OnInitialized(controller_, comet_, user_, collateralAsset_, borrowAsset_, originConverter_);
  }

  ///////////////////////////////////////////////////////
  ///                Modifiers
  ///////////////////////////////////////////////////////

  /// @notice Ensure that the caller is TetuConverter
  function _onlyTetuConverter(IConverterController controller_) internal view {
    require(controller_.tetuConverter() == msg.sender, AppErrors.TETU_CONVERTER_ONLY);
  }

  ///////////////////////////////////////////////////////
  ///                Gov actions
  ///////////////////////////////////////////////////////

  ///////////////////////////////////////////////////////
  ///                Views
  ///////////////////////////////////////////////////////

  function getConfig() external view returns (
    address originConverter_,
    address user_,
    address collateralAsset_,
    address borrowAsset_
  ) {
    return (originConverter, user, collateralAsset, borrowAsset);
  }

  function getStatus() external view returns (
    uint collateralAmount,
    uint amountToPay,
    uint healthFactor18,
    bool opened,
    uint collateralAmountLiquidated
  ) {
    (
    uint tokenBalanceOut,
    uint borrowBalanceOut,
    uint collateralAmountBase,
    uint sumBorrowBase,,,
    uint liquidateCollateralFactor
    ) = _getStatus();

    (, healthFactor18) = _getHealthFactor(liquidateCollateralFactor, collateralAmountBase, sumBorrowBase);

    opened = tokenBalanceOut !=0 || borrowBalanceOut != 0;
    collateralAmount = tokenBalanceOut;
    amountToPay = borrowBalanceOut;
  }

  /// @notice If we paid {amountToRepay_}, how much collateral would we receive?
  function getCollateralAmountToReturn(uint amountToRepay_, bool closePosition_) external view returns (uint) {
    (uint amount,) = _getCollateralAmountToReturn(comet, collateralAsset, amountToRepay_, closePosition_);
    return amount;
  }

  function getConversionKind() external pure returns (
    AppDataTypes.ConversionKind
  ) {}

  ///////////////////////////////////////////////////////
  ///                External logic
  ///////////////////////////////////////////////////////

  function updateStatus() external {}

  function borrow(uint collateralAmount_, uint borrowAmount_, address receiver_) external returns (
    uint borrowedAmountOut
  ) {
    IConverterController c = controller;
    _onlyTetuConverter(c);

    address assetCollateral = collateralAsset;
    address assetBorrow = borrowAsset;

    IERC20(assetCollateral).safeTransferFrom(msg.sender, address(this), collateralAmount_);
    uint tokenBalanceBefore = _supply(assetCollateral, collateralAmount_);

    // make borrow
    uint balanceBorrowAsset0 = _getBalance(assetBorrow);
    comet.withdraw(assetBorrow, borrowAmount_);

    // ensure that we have received required borrowed amount, send the amount to the receiver
    require(
      borrowAmount_ + balanceBorrowAsset0 == IERC20(assetBorrow).balanceOf(address(this)),
      AppErrors.WRONG_BORROWED_BALANCE
    );
    IERC20(assetBorrow).safeTransfer(receiver_, borrowAmount_);

    // register the borrow in DebtMonitor
    IDebtMonitor(c.debtMonitor()).onOpenPosition();

    // ensure that current health factor is greater than min allowed
    (uint healthFactor, uint tokenBalanceAfter) = _validateHealthStatusAfterBorrow(c);
    require(tokenBalanceAfter >= tokenBalanceBefore, AppErrors.WEIRD_OVERFLOW); // overflow below is not possible
    collateralTokensBalance += tokenBalanceAfter - tokenBalanceBefore;

    emit OnBorrow(collateralAmount_, borrowAmount_, receiver_, healthFactor);

    return borrowAmount_;
  }

  function borrowToRebalance(uint borrowAmount_, address receiver_) external returns (
    uint resultHealthFactor18,
    uint borrowedAmountOut
  ) {}

  function repay(uint amountToRepay_, address receiver_, bool closePosition_) external returns (
    uint collateralAmountOut
  ) {
    IConverterController c = controller;
    _onlyTetuConverter(c);

    IComet _comet = comet;
    address assetBorrow = borrowAsset;
    address assetCollateral = collateralAsset;

    IERC20(assetBorrow).safeTransferFrom(msg.sender, address(this), amountToRepay_);

    uint collateralBalanceBefore;
    (collateralAmountOut, collateralBalanceBefore) = _getCollateralAmountToReturn(_comet, assetCollateral, amountToRepay_, closePosition_);
    _comet.supply(assetBorrow, amountToRepay_);

    _comet.withdraw(assetCollateral, collateralAmountOut);

    IERC20(assetCollateral).safeTransfer(receiver_, collateralAmountOut);

    (
    uint collateralBalance,
    uint borrowBalance,
    uint collateralBase,
    uint borrowBase,,,
    uint liquidateCollateralFactor
    ) = _getStatus();

    uint healthFactor18;
    if (collateralBalance == 0 && borrowBalance == 0) {
      IDebtMonitor(c.debtMonitor()).onClosePosition();
    } else {
      require(!closePosition_, AppErrors.CLOSE_POSITION_FAILED);

      (,healthFactor18) = _getHealthFactor(liquidateCollateralFactor, collateralBase, borrowBase);
      _validateHealthFactor(c, healthFactor18);
    }

    require(collateralBalanceBefore >= collateralBalance, AppErrors.WEIRD_OVERFLOW);

    emit OnRepay(amountToRepay_, receiver_, closePosition_, healthFactor18);
  }

  function repayToRebalance(uint amount_, bool isCollateral_) external returns (
    uint resultHealthFactor18
  ) {}

  function claimRewards(address receiver_) external returns (address rewardToken, uint amount) {}

  ///////////////////////////////////////////////////////
  ///                Internal logic
  ///////////////////////////////////////////////////////

  /// @notice Supply collateral to Compound3
  /// @return Collateral token balance before supply
  function _supply(
    address assetCollateral_,
    uint collateralAmount_
  ) internal returns (uint) {
    uint tokenBalanceBefore = comet.userCollateral(address(this), assetCollateral_).balance;
    comet.supply(assetCollateral_, collateralAmount_);
    return tokenBalanceBefore;
  }

  /// @return (Health factor, decimal 18; collateral-token-balance)
  function _validateHealthStatusAfterBorrow(IConverterController controller_) internal view returns (uint, uint) {
    (
    uint tokenBalance,,
    uint collateralBase,
    uint borrowBase,,,
    uint liquidateCollateralFactor
    ) = _getStatus();

    (
    uint sumCollateralSafe,
    uint healthFactor18
    ) = _getHealthFactor(liquidateCollateralFactor, collateralBase, borrowBase);

    require(sumCollateralSafe > borrowBase && borrowBase != 0, AppErrors.INCORRECT_RESULT_LIQUIDITY);

    _validateHealthFactor(controller_, healthFactor18);
    return (healthFactor18, tokenBalance);
  }

  function _validateHealthFactor(IConverterController controller_, uint hf18) internal view {
    require(hf18 > uint(controller_.minHealthFactor2())*10**(18-2), AppErrors.WRONG_HEALTH_FACTOR);
  }

  /// @return tokenBalanceOut Count of collateral tokens on balance
  /// @return borrowBalanceOut Borrow amount [borrow asset units]
  /// @return collateralAmountBase Total collateral in base currency, decimals 8
  /// @return sumBorrowBase Total borrow amount in base currency, decimals 8
  function _getStatus() internal view returns (
    uint tokenBalanceOut,
    uint borrowBalanceOut,
    uint collateralAmountBase,
    uint sumBorrowBase,
    uint collateralAssetPrice,
    uint borrowAssetPrice,
    uint liquidateCollateralFactor
  ) {
    IComet _comet = comet;
    tokenBalanceOut = _comet.userCollateral(address(this), collateralAsset).balance;
    IComet.AssetInfo memory assetInfo = _comet.getAssetInfoByAddress(collateralAsset);
    collateralAssetPrice = Compound3AprLib.getPrice(assetInfo.priceFeed);
    collateralAmountBase = tokenBalanceOut * collateralAssetPrice / 10 ** IERC20Metadata(collateralAsset).decimals();
    borrowBalanceOut = _comet.borrowBalanceOf(address(this));
    borrowAssetPrice = Compound3AprLib.getPrice(comet.baseTokenPriceFeed());
    sumBorrowBase = borrowBalanceOut * borrowAssetPrice / 10 ** IERC20Metadata(borrowAsset).decimals();
    liquidateCollateralFactor = assetInfo.liquidateCollateralFactor;
  }

  function _getHealthFactor(uint liquidateCollateralFactor, uint sumCollateralBase, uint sumBorrowBase) internal pure returns (
    uint sumCollateralSafe,
    uint healthFactor18
  ) {
    sumCollateralSafe = liquidateCollateralFactor * sumCollateralBase / 1e18;
    healthFactor18 = sumBorrowBase == 0 ? type(uint).max : sumCollateralSafe * 1e18 / sumBorrowBase;
  }

  function _getBalance(address asset) internal view returns (uint) {
    return IERC20(asset).balanceOf(address(this));
  }

  /// @notice Get a part of collateral safe to return after repaying {amountToRepay_}
  /// @param amountToRepay_ Amount to be repaid [in borrowed tokens]
  /// @return Amount of collateral [in collateral tokens] to be returned in exchange of {borrowedAmount_}, full balance of collateral tokens
  function _getCollateralAmountToReturn(
    IComet comet_,
    address assetCollateral_,
    uint amountToRepay_,
    bool closePosition_
  ) internal view returns (uint, uint) {
    uint collateralBalance = comet_.userCollateral(address(this), assetCollateral_).balance;
    uint borrowBalance = comet_.borrowBalanceOf(address(this));

    require(borrowBalance != 0, AppErrors.ZERO_BALANCE);

    if (closePosition_) {
      require(borrowBalance <= amountToRepay_, AppErrors.CLOSE_POSITION_PARTIAL);

      return (collateralBalance, collateralBalance);
    } else {
      require(amountToRepay_ <= borrowBalance, AppErrors.WRONG_BORROWED_BALANCE);
    }

    return (collateralBalance * amountToRepay_ / borrowBalance, collateralBalance);
  }
}