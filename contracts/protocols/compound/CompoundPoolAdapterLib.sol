// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./CompoundLib.sol";
import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../openzeppelin/Initializable.sol";
import "../../openzeppelin/IERC20Metadata.sol";
import "../../openzeppelin/Strings.sol";
import "../../interfaces/IConverterController.sol";
import "../../interfaces/IController.sol";
import "../../interfaces/IBookkeeper.sol";
import "../../interfaces/ITokenAddressProvider.sol";
import "../../interfaces/IDebtMonitor.sol";
import "../../integrations/compound/ICompoundComptrollerBase.sol";
import "../../integrations/compound/ICTokenBase.sol";
import "../../integrations/compound/INativeToken.sol";
import "../../integrations/compound/ICTokenNative.sol";
import "../../integrations/compound/ICompoundPriceOracle.sol";
import "../../integrations/compound/ICompoundComptrollerBaseV1.sol";
import "../../integrations/compound/ICompoundComptrollerBaseV2.sol";
import "../../integrations/compound/ICompoundComptrollerBaseV2Zerovix.sol";
import "../../libs/AppDataTypes.sol";
import "../../libs/AppErrors.sol";
import "../../libs/AppUtils.sol";
import "hardhat/console.sol";

library CompoundPoolAdapterLib {
  using SafeERC20 for IERC20;

  //region ----------------------------------------------------- Constants
  uint constant internal EXCHANGE_RATE_DECIMALS = 18;
  uint constant internal DECIMALS_18 = 18;
  uint constant internal COLLATERAL_FACTOR_DECIMALS = 18;

  /// @notice Small amount (equal for all tokens) to implement "almost equal" logic
  uint constant internal DUST_AMOUNT = 1000;

  /// @notice repay allows to reduce health factor of following value (decimals 18):
  uint constant public MAX_ALLOWED_HEALTH_FACTOR_REDUCTION = 1e13; // 0.001%
  //endregion ----------------------------------------------------- Constants

  //region ----------------------------------------------------- Data types
  struct State {
    address collateralAsset;
    address borrowAsset;
    address collateralCToken;
    address borrowCToken;
    address user;

    IConverterController controller;
    ICompoundComptrollerBase comptroller;

    /// @notice Address of original PoolAdapter contract that was cloned to make the instance of the pool adapter
    address originConverter;

    /// @notice Total amount of all supplied and withdrawn amounts of collateral in collateral tokens
    uint collateralTokensBalance;
  }

  /// @notice To avoid stack too deep
  struct RepayLocal {
    uint error;
    uint healthFactor18;
    uint collateralTokensBalance;

    address assetBorrow;
    address assetCollateral;
    address cTokenBorrow;
    address cTokenCollateral;
    ICompoundComptrollerBase comptroller;

    uint collateralTokensToWithdraw;
    uint tokenBalanceBefore;
    uint healthFactorBefore;
    uint balanceCollateralAssetBeforeRedeem;
    uint balanceCollateralAssetAfterRedeem;
  }

  struct GetStatusLocal {
    ICompoundComptrollerBase comptroller;
    address cTokenBorrow;
    address cTokenCollateral;
    uint collateralBase;
    uint collateralAmountLiquidated;
    uint collateralTokensBalance;
  }

  struct BorrowLocal {
    uint error;

    IConverterController controller;
    ICompoundComptrollerBase comptroller;
    address cTokenCollateral;
    address cTokenBorrow;
    address assetCollateral;
    address assetBorrow;

    address[] markets;
  }

  struct PricesData {
    /// @notice Collateral underlying price, decimals = [36 - decimals of the collateral asset]
    uint priceCollateral;
    /// @notice Borrow underlying price, decimals = [36 - decimals of the borrow asset]
    uint priceBorrow;
  }

  struct AccountData {
    uint collateralTokenBalance;
    /// @notice Decimals 18. [token amount] * [exchange rate] = [asset amount]
    uint exchangeRateCollateral;
    uint borrowBalance;
  }
  //endregion ----------------------------------------------------- Data types

  //region ----------------------------------------------------- Events
  event OnInitialized(
    address controller,
    address cTokenAddressProvider,
    address comptroller,
    address user,
    address collateralAsset,
    address borrowAsset,
    address originConverter
  );
  event OnBorrow(uint collateralAmount, uint borrowAmount, address receiver, uint resultHealthFactor18);
  event OnBorrowToRebalance(uint borrowAmount, address receiver, uint resultHealthFactor18);
  event OnRepay(uint amountToRepay, address receiver, bool closePosition, uint resultHealthFactor18);
  event OnRepayToRebalance(uint amount, bool isCollateral, uint resultHealthFactor18);
  //endregion ----------------------------------------------------- Events

  //region ----------------------------------------------------- Restrictions

  /// @notice Ensure that the caller is TetuConverter
  function _onlyTetuConverter(IConverterController controller_) internal view {
    require(controller_.tetuConverter() == msg.sender, AppErrors.TETU_CONVERTER_ONLY);
  }
  //endregion ----------------------------------------------------- Restrictions

  //region ----------------------------------------------------- Initialization

  function initialize(
    State storage dest,
    address controller_,
    address cTokenAddressProvider_,
    address comptroller_,
    address user_,
    address collateralAsset_,
    address borrowAsset_,
    address originConverter_
  ) internal {
    require(
      controller_ != address(0)
      && comptroller_ != address(0)
      && user_ != address(0)
      && collateralAsset_ != address(0)
      && borrowAsset_ != address(0)
      && cTokenAddressProvider_ != address(0)
      && originConverter_ != address(0),
      AppErrors.ZERO_ADDRESS
    );

    dest.controller = IConverterController(controller_);
    dest.user = user_;
    dest.collateralAsset = collateralAsset_;
    dest.borrowAsset = borrowAsset_;
    dest.originConverter = originConverter_;

    (address cTokenCollateral,
      address cTokenBorrow
    ) = ITokenAddressProvider(cTokenAddressProvider_).getCTokenByUnderlying(collateralAsset_, borrowAsset_);

    require(cTokenCollateral != address(0), AppErrors.C_TOKEN_NOT_FOUND);
    require(cTokenBorrow != address(0), AppErrors.C_TOKEN_NOT_FOUND);

    dest.collateralCToken = cTokenCollateral;
    dest.borrowCToken = cTokenBorrow;
    dest.comptroller = ICompoundComptrollerBase(comptroller_);

    // The pool adapter doesn't keep assets on its balance, so it's safe to use infinity approve
    // All approves replaced by infinity-approve were commented in the code below
    IERC20(collateralAsset_).safeApprove(cTokenCollateral, 2 ** 255);
    IERC20(borrowAsset_).safeApprove(cTokenBorrow, 2 ** 255);

    emit OnInitialized(controller_, cTokenAddressProvider_, comptroller_, user_, collateralAsset_, borrowAsset_, originConverter_);
  }
  //endregion ----------------------------------------------------- Initialization

  //region ----------------------------------------------------- Borrow logic
  /// @notice Update internal stored variables to current values
  function updateStatus(State storage state) internal {
    // Update borrowBalance to actual value
    _onlyTetuConverter(state.controller);
    ICTokenBase(state.borrowCToken).borrowBalanceCurrent(address(this));
    ICTokenBase(state.collateralCToken).exchangeRateCurrent();
  }

  /// @notice Supply collateral to the pool and borrow specified amount
  /// @dev No re-balancing here; Collateral amount must be approved to the pool adapter before the call of this function
  /// @param f_ Specific features of the given lending platform
  /// @param collateralAmount_ Amount of collateral, must be approved to the pool adapter before the call of borrow()
  /// @param borrowAmount_ Amount that should be borrowed in result
  /// @param receiver_ Receiver of the borrowed amount
  /// @return Result borrowed amount sent to the {receiver_}
  function borrow(
    State storage state,
    CompoundLib.ProtocolFeatures memory f_,
    uint collateralAmount_,
    uint borrowAmount_,
    address receiver_
  ) internal returns (uint) {
    console.log("borrow");
    BorrowLocal memory v;

    v.controller = state.controller;
    _onlyTetuConverter(v.controller);
    console.log("borrow.1");

    v.comptroller = state.comptroller;
    v.cTokenCollateral = state.collateralCToken;
    v.cTokenBorrow = state.borrowCToken;
    v.assetCollateral = state.collateralAsset;
    v.assetBorrow = state.borrowAsset;

    console.log("borrow.2");
    IERC20(v.assetCollateral).safeTransferFrom(msg.sender, address(this), collateralAmount_);

    // enter markets (repeat entering is not a problem)
    v.markets = new address[](2);
    v.markets[0] = v.cTokenCollateral;
    v.markets[1] = v.cTokenBorrow;
    v.comptroller.enterMarkets(v.markets);
    console.log("borrow.3");

    // supply collateral
    uint tokenBalanceBeforeBorrow = _supply(f_, v.cTokenCollateral, collateralAmount_);

    // make borrow
    uint balanceBorrowAssetBefore = _getBalance(f_, v.assetBorrow);
    v.error = ICTokenBase(v.cTokenBorrow).borrow(borrowAmount_);
    require(v.error == 0, string(abi.encodePacked(AppErrors.BORROW_FAILED, Strings.toString(v.error))));
    console.log("borrow.4");

    // ensure that we have received required borrowed amount, send the amount to the receiver
    if (f_.nativeToken == v.assetBorrow) {
      INativeToken(v.assetBorrow).deposit{value: borrowAmount_}();
    }
    console.log("borrow.5");
    uint balanceBorrowAssetAfter = IERC20(v.assetBorrow).balanceOf(address(this));
    require(
      borrowAmount_ + balanceBorrowAssetBefore <= balanceBorrowAssetAfter,
      AppErrors.WRONG_BORROWED_BALANCE
    );
    console.log("borrow.6");
    IERC20(v.assetBorrow).safeTransfer(receiver_, balanceBorrowAssetAfter - balanceBorrowAssetBefore);

    // register the borrow in DebtMonitor
    IDebtMonitor(v.controller.debtMonitor()).onOpenPosition();
    console.log("borrow.7");

    // ensure that current health factor is greater than min allowed
    (uint healthFactor, uint tokenBalanceAfterBorrow) = _validateHealthStatusAfterBorrow(
      f_, v.controller, v.comptroller, v.cTokenCollateral, v.cTokenBorrow
    );
    state.collateralTokensBalance += AppUtils.sub0(tokenBalanceAfterBorrow, tokenBalanceBeforeBorrow);
    console.log("borrow.8");

    _registerInBookkeeperBorrow(v.controller, collateralAmount_, balanceBorrowAssetAfter - balanceBorrowAssetBefore);
    emit OnBorrow(collateralAmount_, balanceBorrowAssetAfter - balanceBorrowAssetBefore, receiver_, healthFactor);
    return balanceBorrowAssetAfter - balanceBorrowAssetBefore;
  }

  /// @notice Borrow additional amount {borrowAmount_} using exist collateral and send it to {receiver_}
  /// @dev Re-balance: too big health factor => target health factor
  /// @return resultHealthFactor18 Result health factor after borrow
  /// @return borrowedAmountOut Exact amount sent to the borrower
  function borrowToRebalance(
    State storage state,
    CompoundLib.ProtocolFeatures memory f_,
    uint borrowAmount_,
    address receiver_
  ) internal pure returns (
    uint resultHealthFactor18,
    uint borrowedAmountOut
  ) {
    state;
    f_;
    borrowAmount_;
    receiver_;
    resultHealthFactor18;
    borrowedAmountOut;
    revert(AppErrors.DEPRECATED_LEGACY_CODE);
  }

  //endregion ----------------------------------------------------- Borrow logic

  //region ----------------------------------------------------- Repay logic

  /// @notice Repay borrowed amount, return collateral to the user
  /// @param f_ Specific features of the given lending platform
  /// @param amountToRepay_ Exact amount of borrow asset that should be repaid
  ///                       The amount should be approved for the pool adapter before the call of repay()
  /// @param closePosition_ true to pay full borrowed amount
  /// @param receiver_ Receiver of withdrawn collateral
  /// @return Amount of collateral asset sent to the {receiver_}
  function repay(
    State storage state,
    CompoundLib.ProtocolFeatures memory f_,
    uint amountToRepay_,
    address receiver_,
    bool closePosition_
  ) internal returns (uint) {
    IConverterController controller = state.controller;
    _onlyTetuConverter(controller);

    RepayLocal memory v;
    v.assetBorrow = state.borrowAsset;
    v.assetCollateral = state.collateralAsset;
    v.cTokenBorrow = state.borrowCToken;
    v.cTokenCollateral = state.collateralCToken;
    v.collateralTokensBalance = state.collateralTokensBalance;
    v.comptroller = state.comptroller;

    IERC20(v.assetBorrow).safeTransferFrom(msg.sender, address(this), amountToRepay_);

    // Update borrowBalance to actual value, we must do it before calculation of collateral to withdraw
    ICTokenBase(v.cTokenBorrow).borrowBalanceCurrent(address(this));

    // how much collateral we are going to return
    AccountData memory data;
    _initAccountData(v.cTokenCollateral, v.cTokenBorrow, data);

    PricesData memory prices;
    _initPricesData(v.comptroller, v.cTokenCollateral, v.cTokenBorrow, prices);

    v.collateralTokensToWithdraw = _getCollateralTokensToRedeem(data, closePosition_, amountToRepay_);
    v.tokenBalanceBefore = data.collateralTokenBalance;
    (v.healthFactorBefore,,,) = _getAccountValues(f_, v.comptroller, v.cTokenCollateral, data, prices);

    // transfer borrow amount back to the pool
    if (v.cTokenBorrow == f_.cTokenNative) {
      INativeToken(f_.nativeToken).withdraw(amountToRepay_);
      ICTokenNative(payable(v.cTokenBorrow)).repayBorrow{value: amountToRepay_}();
    } else {
      // infinity approve
      v.error = ICTokenBase(v.cTokenBorrow).repayBorrow(amountToRepay_);
      require(v.error == 0, string(abi.encodePacked(AppErrors.REPAY_FAILED, Strings.toString(v.error))));
    }

    // withdraw the collateral
    v.balanceCollateralAssetBeforeRedeem = _getBalance(f_, v.assetCollateral);
    v.error = ICTokenBase(v.cTokenCollateral).redeem(v.collateralTokensToWithdraw);
    require(v.error == 0, string(abi.encodePacked(AppErrors.REDEEM_FAILED, Strings.toString(v.error))));

    // transfer collateral back to the user
    v.balanceCollateralAssetAfterRedeem = _getBalance(f_, v.assetCollateral);
    uint collateralAmountToReturn = AppUtils.sub0(v.balanceCollateralAssetAfterRedeem, v.balanceCollateralAssetBeforeRedeem);
    if (v.assetCollateral == f_.nativeToken) {
      INativeToken(f_.nativeToken).deposit{value: collateralAmountToReturn}();
    }

    // we don't check equality [token amount] * [exchange rate] = [asset amount]
    // we can do it, but it's too dangerous to have additional revert in repay

    IERC20(v.assetCollateral).safeTransfer(receiver_, collateralAmountToReturn);

    // validate result status
    _initAccountData(v.cTokenCollateral, v.cTokenBorrow, data);

    if (data.collateralTokenBalance == 0 &&  data.borrowBalance == 0) {
      IDebtMonitor(controller.debtMonitor()).onClosePosition();
      // We don't exit the market to avoid additional gas consumption
    } else {
      require(!closePosition_, AppErrors.CLOSE_POSITION_FAILED);
      (v.healthFactor18,,,) = _getAccountValues(f_, v.comptroller, v.cTokenCollateral, data, prices);
      _validateHealthFactor(controller, v.healthFactor18, v.healthFactorBefore);
    }

    require(
      v.tokenBalanceBefore >= data.collateralTokenBalance
      && v.collateralTokensBalance >= v.tokenBalanceBefore - data.collateralTokenBalance,
      AppErrors.WEIRD_OVERFLOW
    );
    state.collateralTokensBalance = v.collateralTokensBalance - (v.tokenBalanceBefore - data.collateralTokenBalance);

    _registerInBookkeeperRepay(controller, collateralAmountToReturn, amountToRepay_);
    emit OnRepay(amountToRepay_, receiver_, closePosition_, v.healthFactor18);
    return collateralAmountToReturn;
  }

  /// @notice Repay with rebalancing. Send amount of collateral/borrow asset to the pool adapter
  ///         to recover the health factor to target state.
  /// @dev It's not allowed to close position here (pay full debt) because no collateral will be returned.
  /// @param f_ Specific features of the given lending platform
  /// @param amountIn_ Exact amount of asset that is transferred to the balance of the pool adapter.
  ///                It can be amount of collateral asset or borrow asset depended on {isCollateral_}
  ///                It must be stronger less then total borrow debt.
  ///                The amount should be approved for the pool adapter before the call.
  /// @param isCollateral_ true/false indicates that {amount_} is the amount of collateral/borrow asset
  /// @return resultHealthFactor18 Result health factor after repay, decimals 18
  function repayToRebalance(
    State storage state,
    CompoundLib.ProtocolFeatures memory f_,
    uint amountIn_,
    bool isCollateral_
  ) internal returns (
    uint resultHealthFactor18
  ) {
    IConverterController controller = state.controller;
    _onlyTetuConverter(controller);

    address cTokenBorrow = state.borrowCToken;
    address cTokenCollateral = state.collateralCToken;
    ICompoundComptrollerBase comptroller = state.comptroller;
    uint tokenBalanceBefore;

    PricesData memory prices;
    _initPricesData(comptroller, cTokenCollateral, cTokenBorrow, prices);

    AccountData memory data;
    _initAccountData(cTokenCollateral, cTokenBorrow, data);
    (uint healthFactorBefore ,,,) = _getAccountValues(f_, comptroller, cTokenCollateral, data, prices);

    // ensure that the position is opened
    require(IDebtMonitor(controller.debtMonitor()).isPositionOpened(), AppErrors.BORROW_POSITION_IS_NOT_REGISTERED);

    if (isCollateral_) {
      address assetCollateral = state.collateralAsset;
      IERC20(assetCollateral).safeTransferFrom(msg.sender, address(this), amountIn_);
      tokenBalanceBefore = _supply(f_, cTokenCollateral, amountIn_);
      _registerInBookkeeperBorrow(controller, amountIn_, 0);
    } else {
      address assetBorrow = state.borrowAsset;

      // ensure, that amount to repay is less then the total debt
      tokenBalanceBefore = data.collateralTokenBalance;

      require(data.borrowBalance != 0 && amountIn_ < data.borrowBalance, AppErrors.REPAY_TO_REBALANCE_NOT_ALLOWED);

      IERC20(assetBorrow).safeTransferFrom(msg.sender, address(this), amountIn_);
      // the amount is received through safeTransferFrom so we don't need following additional check:
      //    require(IERC20(assetBorrow).balanceOf(address(this)) >= amount_, AppErrors.MINT_FAILED);

      // transfer borrow amount back to the pool
      if (f_.cTokenNative == cTokenBorrow) {
        INativeToken(f_.nativeToken).withdraw(amountIn_);
        ICTokenNative(payable(cTokenBorrow)).repayBorrow{value: amountIn_}();
      } else {
        // infinity approve
        uint error = ICTokenBase(cTokenBorrow).repayBorrow(amountIn_);
        require(error == 0, string(abi.encodePacked(AppErrors.REPAY_FAILED, Strings.toString(error))));
      }
      _registerInBookkeeperRepay(controller, 0, amountIn_);
    }

    // validate result status
    _initAccountData(cTokenCollateral, cTokenBorrow, data);
    (uint healthFactor18 ,,,) = _getAccountValues(f_, comptroller, cTokenCollateral, data, prices);
    _validateHealthFactor(controller, healthFactor18, healthFactorBefore);

    require(data.collateralTokenBalance >= tokenBalanceBefore, AppErrors.WEIRD_OVERFLOW);
    state.collateralTokensBalance += data.collateralTokenBalance - tokenBalanceBefore;

    emit OnRepayToRebalance(amountIn_, isCollateral_, healthFactor18);
    return healthFactor18;
  }
  //endregion ----------------------------------------------------- Repay logic

  //region ----------------------------------------------------- View current status

  /// @notice Get current status of the borrow position
  /// @dev It returns STORED status. To get current status it's necessary to call updateStatus
  ///      at first to update interest and recalculate status.
  /// @param f_ Specific features of the given lending platform
  /// @return collateralAmount Total amount of provided collateral, collateral currency
  /// @return amountToPay Total amount of borrowed debt in [borrow asset]. 0 - for closed borrow positions.
  /// @return healthFactor18 Current health factor, decimals 18
  /// @return opened The position is opened (there is not empty collateral/borrow balance)
  /// @return collateralAmountLiquidated How much collateral was liquidated
  /// @return debtGapRequired When paying off a debt, the amount of the payment must be greater
  ///         than the amount of the debt by a small amount (debt gap, see IConverterController.debtGap)
  ///         getStatus returns it (same as getConfig) to exclude additional call of getConfig by the caller
  function getStatus(State storage state, CompoundLib.ProtocolFeatures memory f_) internal view returns (
    uint collateralAmount,
    uint amountToPay,
    uint healthFactor18,
    bool opened,
    uint collateralAmountLiquidated,
    bool debtGapRequired
  ) {
    GetStatusLocal memory v;
    v.comptroller = state.comptroller;
    v.cTokenBorrow = state.borrowCToken;
    v.cTokenCollateral = state.collateralCToken;
    v.collateralTokensBalance = state.collateralTokensBalance;

    // we need to repeat Comptroller.getHypotheticalAccountLiquidityInternal
    // but for single collateral and single borrow only
    // Collateral factor = CF, exchange rate = ER, price = P
    // Liquidity = sumCollateral - sumBorrowPlusEffects
    // where sumCollateral = ERMP * Collateral::TokenBalance
    //       sumBorrowPlusEffects = Borrow::P * Borrow::BorrowBalance
    //       ERMP = Collateral::ER * Collateral::P
    // TokenBalance and BorrowBalance can be received through Token.getAccountSnapshot
    // Liquidity - through Comptroller.getAccountLiquidity
    //
    // Health factor = (Collateral::CF * sumCollateral) / sumBorrowPlusEffects
    //               = (Liquidity + sumBorrowPlusEffects) / sumBorrowPlusEffects

    AccountData memory data;
    _initAccountData(v.cTokenCollateral, v.cTokenBorrow, data);

    PricesData memory prices;
    _initPricesData(v.comptroller, v.cTokenCollateral, v.cTokenBorrow, prices);

    (healthFactor18, v.collateralBase,, ) = _getAccountValues(f_, v.comptroller, v.cTokenCollateral, data, prices);

    v.collateralAmountLiquidated = AppUtils.sub0(v.collateralTokensBalance, data.collateralTokenBalance)
      * data.exchangeRateCollateral / 10 ** EXCHANGE_RATE_DECIMALS;

    return (
    // Total amount of provided collateral [collateral asset]
      _fromBaseAmount(v.collateralBase, prices.priceCollateral),
    // Total amount of borrowed debt in [borrow asset]. 0 - for closed borrow positions.
      data.borrowBalance,
    // Current health factor, decimals 18
      healthFactor18,
      data.collateralTokenBalance != 0 || data.borrowBalance != 0,
    // Amount of liquidated collateral == amount of lost
      v.collateralAmountLiquidated,
      false
    );
  }

  /// @notice If we paid {amountToRepay_}, how much collateral would we receive?
  /// @return amountCollateralOut Amount of collateral asset that can be redeemed after repaying of {amountToRepay_}
  function getCollateralAmountToReturn(State storage state, uint amountToRepay_, bool closePosition_)
  internal view returns (
    uint amountCollateralOut
  ) {
    AccountData memory data;
    _initAccountData(state.collateralCToken, state.borrowCToken, data);

    uint tokensToReturn = _getCollateralTokensToRedeem(data, closePosition_, amountToRepay_);
    amountCollateralOut = tokensToReturn * data.exchangeRateCollateral / 10 ** EXCHANGE_RATE_DECIMALS;
  }
  //endregion ----------------------------------------------------- View current status

  //region ----------------------------------------------------- Internal logic
  /// @notice Supply collateral to compound market
  /// @param cToken_ cToken of the collateral asset
  /// @param amount_ Collateral amount
  /// @return tokenBalanceBefore Collateral token balance before supply
  function _supply(CompoundLib.ProtocolFeatures memory f_, address cToken_, uint amount_) internal returns (
    uint tokenBalanceBefore
  ) {
    // the amount is received through safeTransferFrom before calling of _supply(), no need additional check:
    //    require(tokenBalanceBefore >= collateralAmount_, AppErrors.MINT_FAILED);
    tokenBalanceBefore = IERC20(cToken_).balanceOf(address(this));

    if (f_.cTokenNative == cToken_) {
      INativeToken(f_.nativeToken).withdraw(amount_);
      ICTokenNative(payable(cToken_)).mint{value: amount_}();
    } else { // assume infinity approve: IERC20(assetCollateral_).approve(cTokenCollateral_, collateralAmount_);
      uint error = ICTokenBase(cToken_).mint(amount_);
      require(error == 0, string(abi.encodePacked(AppErrors.MINT_FAILED, Strings.toString(error))));
    }
  }

  /// @return healthFactor18 Current health factor, decimal 18
  /// @return collateralTokenBalance Current amount of collateral cTokens
  function _validateHealthStatusAfterBorrow(
    CompoundLib.ProtocolFeatures memory f_,
    IConverterController controller_,
    ICompoundComptrollerBase comptroller_,
    address cTokenCollateral_,
    address cTokenBorrow_
  ) internal view returns (
    uint healthFactor18,
    uint collateralTokenBalance
  ) {
    PricesData memory prices;
    _initPricesData(comptroller_, cTokenCollateral_, cTokenBorrow_, prices);

    AccountData memory data;
    _initAccountData(cTokenCollateral_, cTokenBorrow_, data);

    uint safeDebtAmountBase;
    uint borrowBase;
    (healthFactor18,, safeDebtAmountBase, borrowBase) = _getAccountValues(
      f_, comptroller_, cTokenCollateral_, data, prices
    );
    require(borrowBase != 0 && safeDebtAmountBase > borrowBase, AppErrors.INCORRECT_RESULT_LIQUIDITY);

    (uint error ,,) = comptroller_.getAccountLiquidity(address(this)); // todo do we need this call?
    require(error == 0, string(abi.encodePacked(AppErrors.CTOKEN_GET_ACCOUNT_LIQUIDITY_FAILED, Strings.toString(error))));

    _validateHealthFactor(controller_, healthFactor18, 0);
    return (healthFactor18, data.collateralTokenBalance);
  }

  /// @return collateralTokenToRedeem Amount of collateral tokens to redeem
  function _getCollateralTokensToRedeem(AccountData memory data, bool closePosition_, uint amountToRepay_)
  internal pure returns (
    uint collateralTokenToRedeem
  ) {
    require(data.borrowBalance != 0, AppErrors.ZERO_BALANCE);

    if (closePosition_) {
      require(data.borrowBalance <= amountToRepay_, AppErrors.CLOSE_POSITION_PARTIAL);
      collateralTokenToRedeem = data.collateralTokenBalance;
    } else {
      require(amountToRepay_ <= data.borrowBalance, AppErrors.WRONG_BORROWED_BALANCE);
      collateralTokenToRedeem = data.collateralTokenBalance * amountToRepay_ / data.borrowBalance;
    }
  }
  //endregion ----------------------------------------------------- Internal logic

  //region ----------------------------------------------------- Utils
  /// @notice Get all data required to calculate current status, save results to {dest}
  function _initAccountData(address cTokenCollateral, address cTokenBorrow, AccountData memory dest) internal view {
    uint error;

    (error, dest.collateralTokenBalance,, dest.exchangeRateCollateral) = ICTokenBase(cTokenCollateral).getAccountSnapshot(address(this));
    require(error == 0, string(abi.encodePacked(AppErrors.CTOKEN_GET_ACCOUNT_SNAPSHOT_FAILED, Strings.toString(error))));

    (error,, dest.borrowBalance,) = ICTokenBase(cTokenBorrow).getAccountSnapshot(address(this));
    require(error == 0, string(abi.encodePacked(AppErrors.CTOKEN_GET_ACCOUNT_SNAPSHOT_FAILED, Strings.toString(error))));
  }

  function _initPricesData(
    ICompoundComptrollerBase comptroller,
    address cTokenCollateral,
    address cTokenBorrow,
    PricesData memory dest
  ) internal view {
    ICompoundPriceOracle priceOracle = ICompoundPriceOracle(comptroller.oracle());
    dest.priceCollateral = CompoundLib.getPrice(priceOracle, cTokenCollateral);
    dest.priceBorrow = CompoundLib.getPrice(priceOracle, cTokenBorrow);
  }

  /// @param collateralFactor Collateral factor, decimals 18
  /// @param collateralAmountBase Total collateral amount, in base currency
  /// @param borrowAmountBase Total borrow amount + effects, in base currency
  /// @return safeDebtAmountBase Amount of debt that is safe to be borrowed under given collateral, in base currency
  /// @return healthFactor18 Current health factor, decimals 18. Return type(uint).max if there is no borrow.
  function _getHealthFactor(uint collateralFactor, uint collateralAmountBase, uint borrowAmountBase) internal pure returns (
    uint safeDebtAmountBase,
    uint healthFactor18
  ) {
    safeDebtAmountBase = collateralFactor * collateralAmountBase / 10 ** COLLATERAL_FACTOR_DECIMALS;
    healthFactor18 = borrowAmountBase == 0
      ? type(uint).max
      : safeDebtAmountBase * 10 ** 18 / borrowAmountBase;

    return (safeDebtAmountBase, healthFactor18);
  }

  /// @notice Calculate auxiliary values using {data_}
  /// @return healthFactor18 Current health factor, decimals 18
  /// @return collateralBase Amount of collateral in base currency (USD), decimals 18
  /// @return safeDebtAmountBase Safe amount of debt for the current collateral, in terms of base currency (USD)
  function _getAccountValues(
    CompoundLib.ProtocolFeatures memory f_,
    ICompoundComptrollerBase comptroller_,
    address cTokenCollateral_,
    AccountData memory data_,
    PricesData memory prices_
  ) internal view returns (
    uint healthFactor18,
    uint collateralBase,
    uint safeDebtAmountBase,
    uint borrowBase
  ) {
    (collateralBase, borrowBase) = _getBaseAmounts(data_, prices_);
    uint collateralFactor = _getCollateralFactor(f_, comptroller_, cTokenCollateral_);
    (safeDebtAmountBase, healthFactor18) = _getHealthFactor(collateralFactor, collateralBase, borrowBase);
  }

  /// @notice Validate that result health factor is correct, SCB-794
  ///         1) If we make a borrow the health factor is correct if it's greater than the min allowed threshold.
  ///         2) If we make repaying, the health factor is correct if
  ///                   it's greater than the min allowed threshold
  ///                   or it wasn't reduced too much
  /// @param healthFactorAfter Value of health factor after the operation - the value to check
  /// @param healthFactorBefore Value of health factor before the operation. 0 if borrow.
  function _validateHealthFactor(
    IConverterController controller_,
    uint healthFactorAfter,
    uint healthFactorBefore
  ) internal view {
    uint threshold = uint(controller_.minHealthFactor2()) * 10 ** (18 - 2);
    uint reduction = healthFactorBefore > healthFactorAfter
      ? healthFactorBefore - healthFactorAfter
      : 0;
    require(
      healthFactorAfter >= threshold
      || (healthFactorBefore != 0 && reduction < MAX_ALLOWED_HEALTH_FACTOR_REDUCTION),
      AppErrors.WRONG_HEALTH_FACTOR
    );
  }

  /// @param asset Underlying, it can be native token
  function _getBalance(CompoundLib.ProtocolFeatures memory f_, address asset) internal view returns (uint) {
    return f_.nativeToken == asset
      ? address(this).balance
      : IERC20(asset).balanceOf(address(this));
  }

  /// @notice Recalculate amount of collateral tokens and amount of debt to base currency (USD)
  /// @return collateralBase Amount of collateral in base currency (USD), decimals 18
  /// @return borrowBase Amount of debt in base currency (USD), decimals 18
  function _getBaseAmounts(AccountData memory data, PricesData memory prices) internal pure returns (
    uint collateralBase,
    uint borrowBase
  ) {
    // Price has decimals [36 - decimals of the token]
    // result base-amounts have decimals 18
    collateralBase = _toBaseAmount(
      (data.collateralTokenBalance * data.exchangeRateCollateral / 10 ** EXCHANGE_RATE_DECIMALS),
      prices.priceCollateral
    );
    borrowBase = _toBaseAmount(data.borrowBalance, prices.priceBorrow);
  }

  /// @param amount_ Amount of asset
  /// @param price_ Price of the asset: $ / [asset], decimals = [36 - decimals of the asset]
  /// @return {amount_} in terms of base currency (USD) with decimals 18
  function _toBaseAmount(uint amount_, uint price_) internal pure returns (uint) {
    return amount_ * price_ / 10 ** DECIMALS_18;
  }

  /// @param baseAmount_ Amount in base currency (USD), decimals 18
  /// @param price_ Price of the asset: $ / [asset], decimals = [36 - decimals of the asset]
  /// @return {baseAmount_} in terms of asset, decimals = decimals of the asset
  function _fromBaseAmount(uint baseAmount_, uint price_) internal pure returns (uint) {
    return baseAmount_ * 10**DECIMALS_18 / price_;
  }
  //endregion ----------------------------------------------------- Utils

  //region ----------------------------------------------------- Protocol features logic
  /// @return collateralFactor Decimals = COLLATERAL_FACTOR_DECIMALS
  function _getCollateralFactor(
    CompoundLib.ProtocolFeatures memory f_,
    ICompoundComptrollerBase comptroller_,
    address cTokenCollateral_
  ) internal view returns (uint collateralFactor) {
    if (f_.compoundStorageVersion == CompoundLib.COMPOUND_STORAGE_V1) {
      (, collateralFactor) = ICompoundComptrollerBaseV1(address(comptroller_)).markets(cTokenCollateral_);
    } else if (f_.compoundStorageVersion == CompoundLib.COMPOUND_STORAGE_V2_ZEROVIX) {
      (, , collateralFactor) = ICompoundComptrollerBaseV2Zerovix(address(comptroller_)).markets(cTokenCollateral_);
    } else { // CompoundLib.COMPOUND_STORAGE_V2
      (, collateralFactor ,) = ICompoundComptrollerBaseV2(address(comptroller_)).markets(cTokenCollateral_);
    }
  }

  /// @notice Register borrow operation in Bookkeeper
  function _registerInBookkeeperBorrow(
    IConverterController controller_,
    uint amountCollateral,
    uint amountBorrow
  ) internal {
    IBookkeeper(controller_.bookkeeper()).onBorrow(amountCollateral, amountBorrow);
  }

  /// @notice Register repay operation in Bookkeeper
  function _registerInBookkeeperRepay(
    IConverterController controller_,
    uint withdrawnCollateral,
    uint paidAmount
  ) internal {
    IBookkeeper(controller_.bookkeeper()).onRepay(withdrawnCollateral, paidAmount);
  }
  //endregion ----------------------------------------------------- Protocol features logic
}