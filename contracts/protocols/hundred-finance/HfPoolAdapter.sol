// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../interfaces/IPoolAdapter.sol";
import "../../core/DebtMonitor.sol";
import "../../core/AppErrors.sol";
import "../../integrations/hundred-finance/IHfComptroller.sol";
import "../../interfaces/IPoolAdapterInitializerWithAP.sol";
import "../../integrations/hundred-finance/IHfCToken.sol";
import "../../integrations/hundred-finance/IHfPriceOracle.sol";
import "../../interfaces/ITokenAddressProvider.sol";
import "../../integrations/hundred-finance/IHfHMatic.sol";
import "../../integrations/IWmatic.sol";
import "../../openzeppelin/Initializable.sol";
import "hardhat/console.sol";

/// @notice Implementation of IPoolAdapter for HundredFinance-protocol, see https://docs.hundred.finance/
/// @dev Instances of this contract are created using proxy-minimal pattern, so no constructor
contract HfPoolAdapter is IPoolAdapter, IPoolAdapterInitializerWithAP, Initializable {
  using SafeERC20 for IERC20;

  ///////////////////////////////////////////////////////
  ///    Data types
  ///////////////////////////////////////////////////////

  /// @notice To avoid stack too deep
  struct LocalRepayVars {
    uint error;
    uint healthFactor18;
    address assetBorrow;
    address assetCollateral;
    address cTokenBorrow;
    address cTokenCollateral;
  }
  ///////////////////////////////////////////////////////
  ///    Constants and variables
  ///////////////////////////////////////////////////////
  address private constant WMATIC = address(0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270);

  address public collateralAsset;
  address public borrowAsset;
  address public collateralCToken;
  address public borrowCToken;
  address public user;

  IController public controller;
  IHfComptroller private _comptroller;

  /// @notice Address of original PoolAdapter contract that was cloned to make the instance of the pool adapter
  address public originConverter;

  /// @notice Total amount of all supplied and withdrawn amounts of collateral in collateral tokens
  uint public collateralTokensBalance;

  ///////////////////////////////////////////////////////
  ///                Events
  ///////////////////////////////////////////////////////
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

  ///////////////////////////////////////////////////////
  ///                Initialization
  ///////////////////////////////////////////////////////

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

    controller = IController(controller_);
    user = user_;
    collateralAsset = collateralAsset_;
    borrowAsset = borrowAsset_;
    originConverter = originConverter_;

    (address cTokenCollateral,
     address cTokenBorrow
    ) = ITokenAddressProvider(cTokenAddressProvider_).getCTokenByUnderlying(collateralAsset_, borrowAsset_);

    require(cTokenCollateral != address(0), AppErrors.C_TOKEN_NOT_FOUND);
    require(cTokenBorrow != address(0), AppErrors.C_TOKEN_NOT_FOUND);

    collateralCToken = cTokenCollateral;
    borrowCToken = cTokenBorrow;
    _comptroller = IHfComptroller(comptroller_);

    // The pool adapter doesn't keep assets on its balance, so it's safe to use infinity approve
    // All approves replaced by infinity-approve were commented in the code below
    IERC20(collateralAsset_).safeApprove(cTokenCollateral, type(uint).max);
    IERC20(borrowAsset_).safeApprove(cTokenBorrow, type(uint).max);

    emit OnInitialized(controller_, cTokenAddressProvider_, comptroller_, user_, collateralAsset_, borrowAsset_, originConverter_);
  }

  ///////////////////////////////////////////////////////
  ///                 Restrictions
  ///////////////////////////////////////////////////////

  /// @notice Ensure that the caller is TetuConverter
  function _onlyTetuConverter() internal view {
    require(controller.tetuConverter() == msg.sender, AppErrors.TETU_CONVERTER_ONLY);
  }

  ///////////////////////////////////////////////////////
  ///                 Borrow logic
  ///////////////////////////////////////////////////////
  function updateStatus() external override {
    // Update borrowBalance to actual value
    IHfCToken(borrowCToken).borrowBalanceCurrent(address(this));
  }

  /// @notice Supply collateral to the pool and borrow {borrowedAmount_} in {borrowedToken_}
  /// @dev Caller should call "syncBalance" before transferring borrow amount and call "borrow"
  function borrow(
    uint collateralAmount_,
    uint borrowAmount_,
    address receiver_
  ) external override returns (uint) {
    console.log("HfPoolAdapter.borrow", borrowAmount_);
    _onlyTetuConverter();
    uint error;
    IHfComptroller comptroller = _comptroller;

    address cTokenCollateral = collateralCToken;
    address cTokenBorrow = borrowCToken;
    address assetCollateral = collateralAsset;
    address assetBorrow = borrowAsset;

    IERC20(assetCollateral).safeTransferFrom(msg.sender, address(this), collateralAmount_);

    // enter markets (repeat entering is not a problem)
    address[] memory markets = new address[](2);
    markets[0] = cTokenCollateral;
    markets[1] = cTokenBorrow;
    comptroller.enterMarkets(markets);

    // supply collateral
    uint tokenBalanceBeforeBorrow = _supply(cTokenCollateral, assetCollateral, collateralAmount_);

    // make borrow
    uint balanceBorrowAsset0 = _getBalance(assetBorrow);
    console.log("balanceBorrowAsset0", balanceBorrowAsset0);
    error = IHfCToken(cTokenBorrow).borrow(borrowAmount_);
    console.log("BORROW ERROR", error);
    require(error == 0, AppErrors.BORROW_FAILED);

    // ensure that we have received required borrowed amount, send the amount to the receiver
    if (_isMatic(assetBorrow)) {
      IWmatic(WMATIC).deposit{value : borrowAmount_}();
    }
    require(
      borrowAmount_ + balanceBorrowAsset0 == IERC20(assetBorrow).balanceOf(address(this)), // TODO <= instead ==
      AppErrors.WRONG_BORROWED_BALANCE
    );
    IERC20(assetBorrow).safeTransfer(receiver_, borrowAmount_);

    // register the borrow in DebtMonitor
    IDebtMonitor(controller.debtMonitor()).onOpenPosition();

    // ensure that current health factor is greater than min allowed
    (uint healthFactor, uint tokenBalanceAfterBorrow) = _validateHealthStatusAfterBorrow(comptroller, cTokenCollateral, cTokenBorrow);
    require(tokenBalanceAfterBorrow >= tokenBalanceBeforeBorrow, AppErrors.WEIRD_OVERFLOW);
    collateralTokensBalance += tokenBalanceAfterBorrow - tokenBalanceBeforeBorrow;

    emit OnBorrow(collateralAmount_, borrowAmount_, receiver_, healthFactor);
    return borrowAmount_;
  }

  /// @notice Supply collateral to Hundred finance market
  /// @return Collateral token balance before supply
  function _supply(
    address cTokenCollateral_,
    address assetCollateral_,
    uint collateralAmount_
  ) internal returns (uint) {
    uint tokenBalanceBefore = IERC20(cTokenCollateral_).balanceOf(address(this));

    // the amount is received through safeTransferFrom before calling of _supply()
    // so we don't need following additional check:
    //    require(tokenBalanceBefore >= collateralAmount_, AppErrors.MINT_FAILED);

    if (_isMatic(assetCollateral_)) {
      IWmatic(WMATIC).withdraw(collateralAmount_);
      IHfHMatic(payable(cTokenCollateral_)).mint{value : collateralAmount_}();
    } else {
      // replaced by infinity approve: IERC20(assetCollateral_).approve(cTokenCollateral_, collateralAmount_);
      uint error = IHfCToken(cTokenCollateral_).mint(collateralAmount_);
      require(error == 0, AppErrors.MINT_FAILED);
    }
    return tokenBalanceBefore;
  }

  /// @return (Health factor, decimal 18; collateral-token-balance)
  function _validateHealthStatusAfterBorrow(
    IHfComptroller comptroller_,
    address cTokenCollateral_,
    address cTokenBorrow_
  ) internal view returns (uint, uint) {
    (uint tokenBalance,,
     uint collateralBase,
     uint borrowBase,,
    ) = _getStatus(cTokenCollateral_, cTokenBorrow_);

    (uint sumCollateralSafe, uint healthFactor18) = _getHealthFactor(
      cTokenCollateral_,
      collateralBase,
      borrowBase
    );

    (uint256 dError, uint liquidity,) = comptroller_.getAccountLiquidity(address(this));
    require(dError == 0, AppErrors.CTOKEN_GET_ACCOUNT_LIQUIDITY_FAILED);

    require(
      sumCollateralSafe > borrowBase
      && borrowBase > 0
    // here we should have: sumCollateralSafe - sumBorrowPlusEffects == liquidity
    // but it seems like round-error can happen, we can check only sumCollateralSafe - sumBorrowPlusEffects ~ liquidity
    // let's ensure that liquidity has a reasonable value //TODO: remove this check at all?
      && liquidity > (sumCollateralSafe - borrowBase) / 2,
      AppErrors.INCORRECT_RESULT_LIQUIDITY
    );

    _validateHealthFactor(healthFactor18);
    return (healthFactor18, tokenBalance);
  }

  function borrowToRebalance(
    uint borrowAmount_,
    address receiver_
  ) external override returns (
    uint resultHealthFactor18,
    uint borrowedAmountOut
  ) {
    _onlyTetuConverter();
    uint error;
    IHfComptroller comptroller = _comptroller;

    address cTokenBorrow = borrowCToken;
    address assetBorrow = borrowAsset;

    // ensure that the position is opened
    require(IDebtMonitor(controller.debtMonitor()).isPositionOpened(), AppErrors.BORROW_POSITION_IS_NOT_REGISTERED);

    // make borrow
    uint balanceBorrowAsset0 = _getBalance(assetBorrow);
    error = IHfCToken(cTokenBorrow).borrow(borrowAmount_);
    require(error == 0, AppErrors.BORROW_FAILED);

    // ensure that we have received required borrowed amount, send the amount to the receiver
    if (_isMatic(assetBorrow)) {
      IWmatic(WMATIC).deposit{value : borrowAmount_}();
    }
    // we assume here, that syncBalance(true) is called before the call of this function
    require(
      borrowAmount_ + balanceBorrowAsset0 == IERC20(assetBorrow).balanceOf(address(this)),
      AppErrors.WRONG_BORROWED_BALANCE
    );
    IERC20(assetBorrow).safeTransfer(receiver_, borrowAmount_);

    // ensure that current health factor is greater than min allowed
    (resultHealthFactor18,) = _validateHealthStatusAfterBorrow(comptroller, collateralCToken, cTokenBorrow);

    emit OnBorrowToRebalance(borrowAmount_, receiver_, resultHealthFactor18);
    return (resultHealthFactor18, borrowAmount_);
  }

  ///////////////////////////////////////////////////////
  ///                 Repay logic
  ///////////////////////////////////////////////////////

  /// @notice Repay borrowed amount, return collateral to the user
  /// @dev Caller should call "syncBalance" before transferring amount to repay and call the "repay"
  function repay(
    uint amountToRepay_,
    address receiver_,
    bool closePosition_
  ) external override returns (uint) {
    _onlyTetuConverter();

    LocalRepayVars memory vars;
    vars.assetBorrow = borrowAsset;
    vars.assetCollateral = collateralAsset;
    vars.cTokenBorrow = borrowCToken;
    vars.cTokenCollateral = collateralCToken;

    IERC20(vars.assetBorrow).safeTransferFrom(msg.sender, address(this), amountToRepay_);

    // Update borrowBalance to actual value, we must do it before calculation of collateral to withdraw
    IHfCToken(borrowCToken).borrowBalanceCurrent(address(this));
    // how much collateral we are going to return
    (uint collateralTokensToWithdraw, uint tokenBalanceBefore) = _getCollateralTokensToRedeem(
      vars.cTokenCollateral,
      vars.cTokenBorrow,
      closePosition_,
      amountToRepay_
    );

    // transfer borrow amount back to the pool
    if (_isMatic(vars.assetBorrow)) {
      IWmatic(WMATIC).withdraw(amountToRepay_);
      IHfHMatic(payable(vars.cTokenBorrow)).repayBorrow{value : amountToRepay_}();
    } else {
      // replaced by infinity approve: IERC20(assetBorrow).approve(cTokenBorrow, amountToRepay_);
      vars.error = IHfCToken(vars.cTokenBorrow).repayBorrow(amountToRepay_);
      require(vars.error == 0, AppErrors.REPAY_FAILED);
    }

    // withdraw the collateral
    uint balanceCollateralAssetBeforeRedeem = _getBalance(vars.assetCollateral);
    vars.error = IHfCToken(vars.cTokenCollateral).redeem(collateralTokensToWithdraw);
    require(vars.error == 0, AppErrors.REDEEM_FAILED);

    // transfer collateral back to the user
    uint balanceCollateralAssetAfterRedeem = _getBalance(vars.assetCollateral);
    require(balanceCollateralAssetAfterRedeem >= balanceCollateralAssetBeforeRedeem, AppErrors.WEIRD_OVERFLOW);
    uint collateralAmountToReturn = balanceCollateralAssetAfterRedeem - balanceCollateralAssetBeforeRedeem;
    if (_isMatic(vars.assetCollateral)) {
      IWmatic(WMATIC).deposit{value : collateralAmountToReturn}();
    }
    IERC20(vars.assetCollateral).safeTransfer(receiver_, collateralAmountToReturn);

    // validate result status
    (uint tokenBalanceAfter,
     uint borrowBalance,
     uint collateralBase,
     uint borrowBase,,
    ) = _getStatus(vars.cTokenCollateral, vars.cTokenBorrow);

    if (tokenBalanceAfter == 0 && borrowBalance == 0) {
      IDebtMonitor(controller.debtMonitor()).onClosePosition();
      // We don't exit the market to avoid additional gas consumption
    } else {
      require(!closePosition_, AppErrors.CLOSE_POSITION_FAILED);
      (, vars.healthFactor18) = _getHealthFactor(vars.cTokenCollateral, collateralBase, borrowBase);
      _validateHealthFactor(vars.healthFactor18);
    }

    require(
      tokenBalanceBefore >= tokenBalanceAfter
      && collateralTokensBalance >= tokenBalanceBefore - tokenBalanceAfter,
      AppErrors.WEIRD_OVERFLOW
    );
    collateralTokensBalance -= tokenBalanceBefore - tokenBalanceAfter;

    emit OnRepay(amountToRepay_, receiver_, closePosition_, vars.healthFactor18);
    return collateralAmountToReturn;
  }

  /// @return Amount of collateral tokens to redeem, full balance of collateral tokens
  function _getCollateralTokensToRedeem(
    address cTokenCollateral_,
    address cTokenBorrow_,
    bool closePosition_,
    uint amountToRepay_
  ) internal view returns (uint, uint) {
    (uint error, uint tokenBalance,,) = IHfCToken(cTokenCollateral_).getAccountSnapshot(address(this));
    require(error == 0, AppErrors.CTOKEN_GET_ACCOUNT_SNAPSHOT_FAILED);

    (uint error2,, uint borrowBalance,) = IHfCToken(cTokenBorrow_).getAccountSnapshot(address(this));
    require(error2 == 0, AppErrors.CTOKEN_GET_ACCOUNT_SNAPSHOT_FAILED);
    require(borrowBalance != 0, AppErrors.ZERO_BALANCE);
    if (closePosition_) {
      require(borrowBalance <= amountToRepay_, AppErrors.CLOSE_POSITION_FAILED);
      return (tokenBalance, tokenBalance);
    } else {
      require(amountToRepay_ <= borrowBalance, AppErrors.WRONG_BORROWED_BALANCE);
    }
    return (tokenBalance * amountToRepay_ / borrowBalance, tokenBalance);
  }

  function repayToRebalance(
    uint amount_,
    bool isCollateral_
  ) external override returns (
    uint resultHealthFactor18
  ) {
    _onlyTetuConverter();

    uint error;
    address cTokenBorrow = borrowCToken;
    address cTokenCollateral = collateralCToken;
    uint tokenBalanceBefore;

    // ensure that the position is opened
    require(IDebtMonitor(controller.debtMonitor()).isPositionOpened(), AppErrors.BORROW_POSITION_IS_NOT_REGISTERED);

    if (isCollateral_) {
      address assetCollateral = collateralAsset;
      IERC20(assetCollateral).safeTransferFrom(msg.sender, address(this), amount_);
      tokenBalanceBefore = _supply(cTokenCollateral, collateralAsset, amount_);
    } else {
      uint borrowBalance;
      address assetBorrow = borrowAsset;
      // ensure, that amount to repay is less then the total debt
      (tokenBalanceBefore, borrowBalance,,,,) = _getStatus(cTokenCollateral, cTokenBorrow);
      require(borrowBalance > 0 && amount_ < borrowBalance, AppErrors.REPAY_TO_REBALANCE_NOT_ALLOWED);

      IERC20(assetBorrow).safeTransferFrom(msg.sender, address(this), amount_);
      // the amount is received through safeTransferFrom so we don't need following additional check:
      //    require(IERC20(assetBorrow).balanceOf(address(this)) >= amount_, AppErrors.MINT_FAILED);

      // transfer borrow amount back to the pool
      if (_isMatic(assetBorrow)) {
        IWmatic(WMATIC).withdraw(amount_);
        IHfHMatic(payable(cTokenBorrow)).repayBorrow{value : amount_}();
      } else {
        // replaced by infinity approve: IERC20(assetBorrow).approve(cTokenBorrow, amount_);
        error = IHfCToken(cTokenBorrow).repayBorrow(amount_);
        require(error == 0, AppErrors.REPAY_FAILED);
      }
    }

    // validate result status
    (uint tokenBalanceAfter,,
     uint collateralBase,
     uint borrowBase,,
    ) = _getStatus(cTokenCollateral, cTokenBorrow);

    (, uint healthFactor18) = _getHealthFactor(cTokenCollateral, collateralBase, borrowBase);
    _validateHealthFactor(healthFactor18);

    require(tokenBalanceAfter >= tokenBalanceBefore, AppErrors.WEIRD_OVERFLOW);
    collateralTokensBalance += tokenBalanceAfter - tokenBalanceBefore;

    emit OnRepayToRebalance(amount_, isCollateral_, healthFactor18);
    return healthFactor18;
  }

  ///////////////////////////////////////////////////////
  ///                 Rewards
  ///////////////////////////////////////////////////////
  function claimRewards(address receiver_) external pure override returns (
    address rewardToken,
    uint amount
  ) {
    //nothing to do, HundredFinance doesn't have rewards on polygon anymore
    receiver_; // hide warning
    return (rewardToken, amount);
  }


  ///////////////////////////////////////////////////////
  ///         View current status
  ///////////////////////////////////////////////////////

  function getConfig() external view override returns (
    address origin,
    address outUser,
    address outCollateralAsset,
    address outBorrowAsset
  ) {
    return (originConverter, user, collateralAsset, borrowAsset);
  }

  function getStatus() external view override returns (
    uint collateralAmount,
    uint amountToPay,
    uint healthFactor18,
    bool opened,
    uint collateralAmountLiquidated
  ) {
    address cTokenBorrow = borrowCToken;
    address cTokenCollateral = collateralCToken;
    ( uint collateralTokens,
      uint borrowBalance,
      uint collateralBase,
      uint borrowBase,
      uint collateralPrice,
      uint collateralAmountLiquidatedBase
    ) = _getStatus(cTokenCollateral, cTokenBorrow);

    (, healthFactor18) = _getHealthFactor(cTokenCollateral, collateralBase, borrowBase);

    return (
    // Total amount of provided collateral [collateral asset]
      collateralBase * 10**18 / collateralPrice,
    // Total amount of borrowed debt in [borrow asset]. 0 - for closed borrow positions.
      borrowBalance,
    // Current health factor, decimals 18
      healthFactor18,
      collateralTokens != 0 || borrowBalance != 0,
    // Amount of liquidated collateral == amount of lost
      collateralAmountLiquidatedBase == 0
        ? 0
        : collateralAmountLiquidatedBase * 10 ** IERC20Metadata(collateralAsset).decimals() / 10**18
    );
  }

  /// @return tokenBalanceOut Count of collateral tokens on balance
  /// @return borrowBalanceOut Borrow amount [borrow asset units]
  /// @return collateralBaseOut Total collateral in base currency
  /// @return borrowBaseOut Total borrow amount in base currency
  function _getStatus(address cTokenCollateral, address cTokenBorrow) internal view returns (
    uint tokenBalanceOut,
    uint borrowBalanceOut,
    uint collateralBaseOut,
    uint borrowBaseOut,
    uint outPriceCollateral,
    uint outCollateralAmountLiquidatedBase
  ) {
    console.log("_getStatus");
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

    (error, tokenBalanceOut,, cExchangeRateMantissa) = IHfCToken(cTokenCollateral)
      .getAccountSnapshot(address(this));
    require(error == 0, AppErrors.CTOKEN_GET_ACCOUNT_SNAPSHOT_FAILED);
    console.log("_getStatus;1");
    (error,, borrowBalanceOut,) = IHfCToken(cTokenBorrow).getAccountSnapshot(address(this));
    require(error == 0, AppErrors.CTOKEN_GET_ACCOUNT_SNAPSHOT_FAILED);
    console.log("_getStatus.2");
    IHfPriceOracle priceOracle = IHfPriceOracle(_comptroller.oracle());
    uint priceCollateral = priceOracle.getUnderlyingPrice(cTokenCollateral);
    collateralBaseOut = (priceCollateral * cExchangeRateMantissa / 10**18) * tokenBalanceOut / 10**18;
    borrowBaseOut = priceOracle.getUnderlyingPrice(cTokenBorrow) * borrowBalanceOut / 10**18;
    outCollateralAmountLiquidatedBase = tokenBalanceOut > collateralTokensBalance
      ? 0
      : (collateralTokensBalance - tokenBalanceOut) * (priceCollateral * cExchangeRateMantissa / 10**18) / 10**18;

    console.log("_getStatus.3");
    return (
      tokenBalanceOut,
      borrowBalanceOut,
      collateralBaseOut,
      borrowBaseOut,
      priceCollateral,
      outCollateralAmountLiquidatedBase
    );
  }

  function getConversionKind() external pure override returns (AppDataTypes.ConversionKind) {
    return AppDataTypes.ConversionKind.BORROW_2;
  }

//  /// @notice Compute current cost of the money
//  function getAPR18() external view override returns (int) {
//    return int(IHfCToken(borrowCToken).borrowRatePerBlock() * controller.blocksPerDay() * 365 * 100);
//  }

  ///////////////////////////////////////////////////////
  ///                   Utils
  ///////////////////////////////////////////////////////
  function _getHealthFactor(address cTokenCollateral_, uint sumCollateral_, uint sumBorrowPlusEffects_)
  internal view returns (
    uint sumCollateralSafe,
    uint healthFactor18
  ) {
    console.log("_getHealthFactor.cTokenCollateral_", cTokenCollateral_);
    console.log("_getHealthFactor.sumCollateral_", sumCollateral_);
    console.log("_getHealthFactor.sumBorrowPlusEffects_", sumBorrowPlusEffects_);

    (,uint collateralFactor,) = _comptroller.markets(cTokenCollateral_);

    sumCollateralSafe = collateralFactor * sumCollateral_ / 10**18;
    healthFactor18 = sumBorrowPlusEffects_ == 0
      ? type(uint).max
      : sumCollateralSafe * 10**18 / sumBorrowPlusEffects_;

    return (sumCollateralSafe, healthFactor18);
  }

  function _validateHealthFactor(uint hf18) internal view {
    require(hf18 > uint(controller.minHealthFactor2())*10**(18-2), AppErrors.WRONG_HEALTH_FACTOR);
  }

  ///////////////////////////////////////////////////////
  ///                Native tokens
  ///////////////////////////////////////////////////////

  function _isMatic(address asset_) internal pure returns (bool) {
    return asset_ == WMATIC;
  }

  function _getBalance(address asset) internal view returns (uint) {
    return _isMatic(asset)
    ? address(this).balance
    : IERC20(asset).balanceOf(address(this));
  }

  receive() external payable {} // this is needed for the native token unwrapping
}