// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./CompoundLib.sol";
import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../openzeppelin/Initializable.sol";
import "../../openzeppelin/IERC20Metadata.sol";
import "../../interfaces/IConverterController.sol";
import "../../integrations/compound/ICompoundComptrollerBase.sol";
import "../../integrations/compound/ICTokenBase.sol";
import "../../interfaces/IController.sol";
import "../../integrations/compound/INativeToken.sol";
import "../../integrations/compound/ICTokenNative.sol";
import "../../integrations/compound/ICompoundPriceOracle.sol";
import "../../libs/AppDataTypes.sol";
import "../../libs/AppErrors.sol";
import "../../interfaces/ITokenAddressProvider.sol";
import "../../interfaces/IDebtMonitor.sol";
import "../../integrations/compound/ICompoundComptrollerBaseV2.sol";
import "../../integrations/compound/ICompoundComptrollerBaseV1.sol";

library CompoundPoolAdapterLib {
  using SafeERC20 for IERC20;

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
    uint tokenBalanceAfter;
    uint borrowBalance;
    uint collateralBase;
    uint borrowBase;

    address assetBorrow;
    address assetCollateral;
    address cTokenBorrow;
    address cTokenCollateral;
    ICompoundComptrollerBase comptroller;
  }

  struct GetStatusLocal {
    ICompoundComptrollerBase comptroller;
    address cTokenBorrow;
    address cTokenCollateral;
    uint collateralTokens;
    uint borrowBalance;
    uint collateralBase;
    uint borrowBase;
    uint collateralPrice;
    uint collateralAmountLiquidatedBase;
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
    IERC20(collateralAsset_).safeApprove(cTokenCollateral, type(uint).max);
    IERC20(borrowAsset_).safeApprove(cTokenBorrow, type(uint).max);

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
    BorrowLocal memory v;

    v.controller = state.controller;
    _onlyTetuConverter(v.controller);

    v.comptroller = state.comptroller;
    v.cTokenCollateral = state.collateralCToken;
    v.cTokenBorrow = state.borrowCToken;
    v.assetCollateral = state.collateralAsset;
    v.assetBorrow = state.borrowAsset;


    IERC20(v.assetCollateral).safeTransferFrom(msg.sender, address(this), collateralAmount_);

    // enter markets (repeat entering is not a problem)
    v.markets = new address[](2);
    v.markets[0] = v.cTokenCollateral;
    v.markets[1] = v.cTokenBorrow;
    v.comptroller.enterMarkets(v.markets);

    // supply collateral
    uint tokenBalanceBeforeBorrow = _supply(f_, v.cTokenCollateral, v.assetCollateral, collateralAmount_);

    // make borrow
    uint balanceBorrowAsset0 = _getBalance(f_, v.assetBorrow);
    v.error = ICTokenBase(v.cTokenBorrow).borrow(borrowAmount_);
    require(v.error == 0, AppErrors.BORROW_FAILED);

    // ensure that we have received required borrowed amount, send the amount to the receiver
    if (f_.nativeToken == v.assetBorrow) {
      INativeToken(v.assetBorrow).deposit{value: borrowAmount_}();
    }
    require(
      borrowAmount_ + balanceBorrowAsset0 == IERC20(v.assetBorrow).balanceOf(address(this)),
      AppErrors.WRONG_BORROWED_BALANCE
    );
    IERC20(v.assetBorrow).safeTransfer(receiver_, borrowAmount_);

    // register the borrow in DebtMonitor
    IDebtMonitor(v.controller.debtMonitor()).onOpenPosition();

    // ensure that current health factor is greater than min allowed
    (
      uint healthFactor, uint tokenBalanceAfterBorrow
    ) = _validateHealthStatusAfterBorrow(state, f_, v.controller, v.comptroller, v.cTokenCollateral, v.cTokenBorrow);
    require(tokenBalanceAfterBorrow >= tokenBalanceBeforeBorrow, AppErrors.WEIRD_OVERFLOW);
    state.collateralTokensBalance += tokenBalanceAfterBorrow - tokenBalanceBeforeBorrow;

    emit OnBorrow(collateralAmount_, borrowAmount_, receiver_, healthFactor);
    return borrowAmount_;
  }

  /// @notice Supply collateral to Hundred finance market
  /// @return Collateral token balance before supply
  function _supply(
    CompoundLib.ProtocolFeatures memory f_,
    address cTokenCollateral_,
    address assetCollateral_,
    uint collateralAmount_
  ) internal returns (uint) {
    uint tokenBalanceBefore = IERC20(cTokenCollateral_).balanceOf(address(this));

    // the amount is received through safeTransferFrom before calling of _supply()
    // so we don't need following additional check:
    //    require(tokenBalanceBefore >= collateralAmount_, AppErrors.MINT_FAILED);

    if (f_.nativeToken == assetCollateral_) {
      INativeToken(f_.nativeToken).withdraw(collateralAmount_);
      ICTokenNative(payable(cTokenCollateral_)).mint{value: collateralAmount_}();
    } else {
      // replaced by infinity approve: IERC20(assetCollateral_).approve(cTokenCollateral_, collateralAmount_);
      uint error = ICTokenBase(cTokenCollateral_).mint(collateralAmount_);
      require(error == 0, AppErrors.MINT_FAILED);
    }
    return tokenBalanceBefore;
  }

  /// @return (Health factor, decimal 18; collateral-token-balance)
  function _validateHealthStatusAfterBorrow(
    State storage state,
    CompoundLib.ProtocolFeatures memory f_,
    IConverterController controller_,
    ICompoundComptrollerBase comptroller_,
    address cTokenCollateral_,
    address cTokenBorrow_
  ) internal view returns (uint, uint) {
    (uint tokenBalance,,
      uint collateralBase,
      uint borrowBase,,
    ) = _getStatus(state.comptroller, state.collateralTokensBalance, cTokenCollateral_, cTokenBorrow_);

    (uint sumCollateralSafe, uint healthFactor18) = _getHealthFactor(
      f_,
      comptroller_,
      cTokenCollateral_,
      collateralBase,
      borrowBase
    );

    (uint256 dError,,) = comptroller_.getAccountLiquidity(address(this));
    require(dError == 0, AppErrors.CTOKEN_GET_ACCOUNT_LIQUIDITY_FAILED);

    require(
      sumCollateralSafe > borrowBase
      && borrowBase != 0,
      // here we should have: sumCollateralSafe - sumBorrowPlusEffects == liquidity
      // but it seems like round-error can happen, we can check only sumCollateralSafe - sumBorrowPlusEffects ~ liquidity
      // let's ensure that liquidity has a reasonable value
      // && AppUtils.approxEqual(liquidity + borrowBase, sumCollateralSafe, MAX_DIVISION18), // it doesn't work correctly with WBTC
      AppErrors.INCORRECT_RESULT_LIQUIDITY
    );

    _validateHealthFactor(controller_, healthFactor18);
    return (healthFactor18, tokenBalance);
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
  ) internal returns (
    uint resultHealthFactor18,
    uint borrowedAmountOut
  ) {
    IConverterController controller = state.controller;
    _onlyTetuConverter(controller);

    ICompoundComptrollerBase comptroller = state.comptroller;

    address cTokenBorrow = state.borrowCToken;
    address assetBorrow = state.borrowAsset;

    {
      uint error;
      // ensure that the position is opened
      require(IDebtMonitor(controller.debtMonitor()).isPositionOpened(), AppErrors.BORROW_POSITION_IS_NOT_REGISTERED);

      // make borrow
      uint balanceBorrowAsset0 = _getBalance(f_, assetBorrow);
      error = ICTokenBase(cTokenBorrow).borrow(borrowAmount_);
      require(error == 0, AppErrors.BORROW_FAILED);

      // ensure that we have received required borrowed amount, send the amount to the receiver
      if (f_.nativeToken == assetBorrow) {
        INativeToken(f_.nativeToken).deposit{value: borrowAmount_}();
      }
      // we assume here, that syncBalance(true) is called before the call of this function
      require(
        borrowAmount_ + balanceBorrowAsset0 == IERC20(assetBorrow).balanceOf(address(this)),
        AppErrors.WRONG_BORROWED_BALANCE
      );
      IERC20(assetBorrow).safeTransfer(receiver_, borrowAmount_);
    }

    // ensure that current health factor is greater than min allowed
    (
      resultHealthFactor18,
    ) = _validateHealthStatusAfterBorrow(state, f_, controller, comptroller, state.collateralCToken, cTokenBorrow);

    emit OnBorrowToRebalance(borrowAmount_, receiver_, resultHealthFactor18);
    return (resultHealthFactor18, borrowAmount_);
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
    (
      uint collateralTokensToWithdraw, uint tokenBalanceBefore
    ) = _getCollateralTokensToRedeem(v.cTokenCollateral, v.cTokenBorrow, closePosition_, amountToRepay_);

    // transfer borrow amount back to the pool
    if (v.assetBorrow == f_.nativeToken) {
      INativeToken(f_.nativeToken).withdraw(amountToRepay_);
      ICTokenNative(payable(v.cTokenBorrow)).repayBorrow{value: amountToRepay_}();
    } else {
      // infinity approve
      v.error = ICTokenBase(v.cTokenBorrow).repayBorrow(amountToRepay_);
      require(v.error == 0, AppErrors.REPAY_FAILED);
    }

    // withdraw the collateral
    uint balanceCollateralAssetBeforeRedeem = _getBalance(f_, v.assetCollateral);
    v.error = ICTokenBase(v.cTokenCollateral).redeem(collateralTokensToWithdraw);
    require(v.error == 0, AppErrors.REDEEM_FAILED);

    // transfer collateral back to the user
    uint balanceCollateralAssetAfterRedeem = _getBalance(f_, v.assetCollateral);
    require(balanceCollateralAssetAfterRedeem >= balanceCollateralAssetBeforeRedeem, AppErrors.WEIRD_OVERFLOW);
    uint collateralAmountToReturn = balanceCollateralAssetAfterRedeem - balanceCollateralAssetBeforeRedeem;
    if (v.assetCollateral == f_.nativeToken) {
      INativeToken(f_.nativeToken).deposit{value: collateralAmountToReturn}();
    }
    IERC20(v.assetCollateral).safeTransfer(receiver_, collateralAmountToReturn);

    // validate result status
    (
      v.tokenBalanceAfter, v.borrowBalance, v.collateralBase, v.borrowBase ,,
    ) = _getStatus(v.comptroller, v.collateralTokensBalance, v.cTokenCollateral, v.cTokenBorrow);

    if (v.tokenBalanceAfter == 0 && v.borrowBalance == 0) {
      IDebtMonitor(controller.debtMonitor()).onClosePosition();
      // We don't exit the market to avoid additional gas consumption
    } else {
      require(!closePosition_, AppErrors.CLOSE_POSITION_FAILED);
      (, v.healthFactor18) = _getHealthFactor(f_, v.comptroller, v.cTokenCollateral, v.collateralBase, v.borrowBase);
      _validateHealthFactor(controller, v.healthFactor18);
    }

    require(
      tokenBalanceBefore >= v.tokenBalanceAfter
      && v.collateralTokensBalance >= tokenBalanceBefore - v.tokenBalanceAfter,
      AppErrors.WEIRD_OVERFLOW
    );
    state.collateralTokensBalance = v.collateralTokensBalance - (tokenBalanceBefore - v.tokenBalanceAfter);

    emit OnRepay(amountToRepay_, receiver_, closePosition_, v.healthFactor18);
    return collateralAmountToReturn;
  }

  /// @return Amount of collateral tokens to redeem, full balance of collateral tokens
  function _getCollateralTokensToRedeem(
    address cTokenCollateral_,
    address cTokenBorrow_,
    bool closePosition_,
    uint amountToRepay_
  ) internal view returns (uint, uint) {
    (uint error, uint tokenBalance,,) = ICTokenBase(cTokenCollateral_).getAccountSnapshot(address(this));
    require(error == 0, AppErrors.CTOKEN_GET_ACCOUNT_SNAPSHOT_FAILED);

    (uint error2,, uint borrowBalance,) = ICTokenBase(cTokenBorrow_).getAccountSnapshot(address(this));
    require(error2 == 0, AppErrors.CTOKEN_GET_ACCOUNT_SNAPSHOT_FAILED);

    require(borrowBalance != 0, AppErrors.ZERO_BALANCE);
    if (closePosition_) {
      require(borrowBalance <= amountToRepay_, AppErrors.CLOSE_POSITION_PARTIAL);
      return (tokenBalance, tokenBalance);
    } else {
      require(amountToRepay_ <= borrowBalance, AppErrors.WRONG_BORROWED_BALANCE);
    }
    return (tokenBalance * amountToRepay_ / borrowBalance, tokenBalance);
  }

  /// @notice Repay with rebalancing. Send amount of collateral/borrow asset to the pool adapter
  ///         to recover the health factor to target state.
  /// @dev It's not allowed to close position here (pay full debt) because no collateral will be returned.
  /// @param f_ Specific features of the given lending platform
  /// @param amount_ Exact amount of asset that is transferred to the balance of the pool adapter.
  ///                It can be amount of collateral asset or borrow asset depended on {isCollateral_}
  ///                It must be stronger less then total borrow debt.
  ///                The amount should be approved for the pool adapter before the call.
  /// @param isCollateral_ true/false indicates that {amount_} is the amount of collateral/borrow asset
  /// @return resultHealthFactor18 Result health factor after repay, decimals 18
  function repayToRebalance(
    State storage state,
    CompoundLib.ProtocolFeatures memory f_,
    uint amount_,
    bool isCollateral_
  ) internal returns (
    uint resultHealthFactor18
  ) {
    IConverterController controller = state.controller;
    _onlyTetuConverter(controller);

    address cTokenBorrow = state.borrowCToken;
    address cTokenCollateral = state.collateralCToken;
    ICompoundComptrollerBase comptroller = state.comptroller;
    uint collateralTokensBalance = state.collateralTokensBalance;
    uint tokenBalanceBefore;

    // ensure that the position is opened
    require(IDebtMonitor(controller.debtMonitor()).isPositionOpened(), AppErrors.BORROW_POSITION_IS_NOT_REGISTERED);

    if (isCollateral_) {
      address assetCollateral = state.collateralAsset;
      IERC20(assetCollateral).safeTransferFrom(msg.sender, address(this), amount_);
      tokenBalanceBefore = _supply(f_, cTokenCollateral, assetCollateral, amount_);
    } else {
      uint borrowBalance;
      address assetBorrow = state.borrowAsset;
      // ensure, that amount to repay is less then the total debt
      (
        tokenBalanceBefore, borrowBalance,,,,
      ) = _getStatus(comptroller, collateralTokensBalance, cTokenCollateral, cTokenBorrow);
      require(borrowBalance != 0 && amount_ < borrowBalance, AppErrors.REPAY_TO_REBALANCE_NOT_ALLOWED);

      IERC20(assetBorrow).safeTransferFrom(msg.sender, address(this), amount_);
      // the amount is received through safeTransferFrom so we don't need following additional check:
      //    require(IERC20(assetBorrow).balanceOf(address(this)) >= amount_, AppErrors.MINT_FAILED);

      // transfer borrow amount back to the pool
      if (f_.nativeToken == assetBorrow) {
        INativeToken(f_.nativeToken).withdraw(amount_);
        ICTokenNative(payable(cTokenBorrow)).repayBorrow{value: amount_}();
      } else {
        // infinity approve
        uint error = ICTokenBase(cTokenBorrow).repayBorrow(amount_);
        require(error == 0, AppErrors.REPAY_FAILED);
      }
    }

    // validate result status
    (
      uint tokenBalanceAfter,, uint collateralBase, uint borrowBase,,
    ) = _getStatus(comptroller, collateralTokensBalance, cTokenCollateral, cTokenBorrow);

    (, uint healthFactor18) = _getHealthFactor(f_, comptroller, cTokenCollateral, collateralBase, borrowBase);
    _validateHealthFactor(controller, healthFactor18);

    require(tokenBalanceAfter >= tokenBalanceBefore, AppErrors.WEIRD_OVERFLOW);
    state.collateralTokensBalance += tokenBalanceAfter - tokenBalanceBefore;

    emit OnRepayToRebalance(amount_, isCollateral_, healthFactor18);
    return healthFactor18;
  }

  /// @notice If we paid {amountToRepay_}, how much collateral would we receive?
  function getCollateralAmountToReturn(
    State storage state,
    uint amountToRepay_,
    bool closePosition_
  ) internal view returns (uint) {
    address cTokenCollateral = state.collateralCToken;

    (uint error,,, uint cExchangeRateMantissa) = ICTokenBase(cTokenCollateral).getAccountSnapshot(address(this));
    require(error == 0, AppErrors.CTOKEN_GET_ACCOUNT_SNAPSHOT_FAILED);

    (uint tokensToReturn,) = _getCollateralTokensToRedeem(cTokenCollateral, state.borrowCToken, closePosition_, amountToRepay_);
    return tokensToReturn * cExchangeRateMantissa / 10 ** 18;
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
    (v.collateralTokens,
      v.borrowBalance,
      v.collateralBase,
      v.borrowBase,
      v.collateralPrice,
      v.collateralAmountLiquidatedBase
    ) = _getStatus(v.comptroller, state.collateralTokensBalance, v.cTokenCollateral, v.cTokenBorrow);

    (, healthFactor18) = _getHealthFactor(f_, v.comptroller, v.cTokenCollateral, v.collateralBase, v.borrowBase);

    return (
    // Total amount of provided collateral [collateral asset]
      v.collateralBase * 10 ** 18 / v.collateralPrice,
    // Total amount of borrowed debt in [borrow asset]. 0 - for closed borrow positions.
      v.borrowBalance,
    // Current health factor, decimals 18
      healthFactor18,
      v.collateralTokens != 0 || v.borrowBalance != 0,
    // Amount of liquidated collateral == amount of lost
      v.collateralAmountLiquidatedBase == 0
        ? 0
        : v.collateralAmountLiquidatedBase * 10 ** IERC20Metadata(state.collateralAsset).decimals() / 10 ** 18,
      false
    );
  }

  /// @return tokenBalanceOut Count of collateral tokens on balance
  /// @return borrowBalanceOut Borrow amount [borrow asset units]
  /// @return collateralBaseOut Total collateral in base currency
  /// @return borrowBaseOut Total borrow amount in base currency
  function _getStatus(
    ICompoundComptrollerBase comptroller,
    uint collateralTokensBalance,
    address cTokenCollateral,
    address cTokenBorrow
  ) internal view returns (
    uint tokenBalanceOut,
    uint borrowBalanceOut,
    uint collateralBaseOut,
    uint borrowBaseOut,
    uint outPriceCollateral,
    uint outCollateralAmountLiquidatedBase
  ) {
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

    uint cExchangeRateMantissa;
    uint error;

    (error, tokenBalanceOut,, cExchangeRateMantissa) = ICTokenBase(cTokenCollateral).getAccountSnapshot(address(this));
    require(error == 0, AppErrors.CTOKEN_GET_ACCOUNT_SNAPSHOT_FAILED);

    (error,, borrowBalanceOut,) = ICTokenBase(cTokenBorrow).getAccountSnapshot(address(this));
    require(error == 0, AppErrors.CTOKEN_GET_ACCOUNT_SNAPSHOT_FAILED);

    ICompoundPriceOracle priceOracle = ICompoundPriceOracle(comptroller.oracle());
    uint priceCollateral = priceOracle.getUnderlyingPrice(cTokenCollateral);

    collateralBaseOut = (priceCollateral * cExchangeRateMantissa / 10 ** 18) * tokenBalanceOut / 10 ** 18;
    borrowBaseOut = priceOracle.getUnderlyingPrice(cTokenBorrow) * borrowBalanceOut / 10 ** 18;

    {
      outCollateralAmountLiquidatedBase = tokenBalanceOut > collateralTokensBalance
        ? 0
        : (collateralTokensBalance - tokenBalanceOut) * (priceCollateral * cExchangeRateMantissa / 10 ** 18) / 10 ** 18;
    }

    return (
      tokenBalanceOut,
      borrowBalanceOut,
      collateralBaseOut,
      borrowBaseOut,
      priceCollateral,
      outCollateralAmountLiquidatedBase
    );
  }
  //endregion ----------------------------------------------------- View current status

  //region ----------------------------------------------------- Utils
  /// @param f_ Specific features of the given lending platform
  function _getHealthFactor(
    CompoundLib.ProtocolFeatures memory f_,
    ICompoundComptrollerBase comptroller_,
    address cTokenCollateral_,
    uint sumCollateral_,
    uint sumBorrowPlusEffects_
  ) internal view returns (
    uint sumCollateralSafe,
    uint healthFactor18
  ) {
    uint collateralFactor;
    if (f_.compoundStorageVersion == CompoundLib.COMPOUND_STORAGE_V1) {
      (, collateralFactor) = ICompoundComptrollerBaseV1(address(comptroller_)).markets(cTokenCollateral_);
    } else {
      (, collateralFactor ,) = ICompoundComptrollerBaseV2(address(comptroller_)).markets(cTokenCollateral_);
    }

    sumCollateralSafe = collateralFactor * sumCollateral_ / 10 ** 18;
    healthFactor18 = sumBorrowPlusEffects_ == 0
      ? type(uint).max
      : sumCollateralSafe * 10 ** 18 / sumBorrowPlusEffects_;

    return (sumCollateralSafe, healthFactor18);
  }

  function _validateHealthFactor(IConverterController controller_, uint hf18) internal view {
    // todo fix in same way as in AAVE
    require(hf18 > uint(controller_.minHealthFactor2()) * 10 ** (18 - 2), AppErrors.WRONG_HEALTH_FACTOR);
  }
  //endregion ----------------------------------------------------- Utils

  //region ----------------------------------------------------- Native tokens

  function _getBalance(CompoundLib.ProtocolFeatures memory f_, address asset) internal view returns (uint) {
    return f_.nativeToken == asset
      ? address(this).balance
      : IERC20(asset).balanceOf(address(this));
  }
  //endregion ----------------------------------------------------- Native tokens

}