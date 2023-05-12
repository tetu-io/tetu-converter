// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./DForceAprLib.sol";
import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../openzeppelin/Initializable.sol";
import "../../openzeppelin/IERC20Metadata.sol";
import "../../libs/AppErrors.sol";
import "../../interfaces/IPoolAdapter.sol";
import "../../interfaces/IPoolAdapterInitializerWithAP.sol";
import "../../interfaces/ITokenAddressProvider.sol";
import "../../interfaces/IConverterController.sol";
import "../../interfaces/IDebtMonitor.sol";
import "../../integrations/dforce/IDForceController.sol";
import "../../integrations/dforce/IDForceCToken.sol";
import "../../integrations/dforce/IDForcePriceOracle.sol";
import "../../integrations/dforce/IDForceCTokenMatic.sol";
import "../../integrations/IWmatic.sol";
import "../../integrations/dforce/IDForceInterestRateModel.sol";
import "../../integrations/dforce/IDForceRewardDistributor.sol";

/// @notice Implementation of IPoolAdapter for dForce-protocol, see https://developers.dforce.network/
/// @dev Instances of this contract are created using proxy-minimal pattern, so no constructor
contract DForcePoolAdapter is IPoolAdapter, IPoolAdapterInitializerWithAP, Initializable {
  using SafeERC20 for IERC20;

  /// @notice Max allowed difference for sumCollateralSafe - sumBorrowPlusEffects == liquidity
  uint private constant DELTA = 100;
  address private constant WMATIC = address(0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270);
  address private constant DFORCE_MATIC = address(0x6A3fE5342a4Bd09efcd44AC5B9387475A0678c74);

  //region -----------------------------------------------------  Members and constants

  address public collateralAsset;
  address public borrowAsset;
  address public collateralCToken;
  address public borrowCToken;
  address public user;

  IConverterController public controller;
  IDForceController private _comptroller;

  /// @notice Address of original PoolAdapter contract that was cloned to make the instance of the pool adapter
  address public originConverter;

  /// @notice Total amount of all supplied and withdrawn amounts of collateral in collateral tokens
  uint public collateralTokensBalance;
  //endregion ----------------------------------------------------- Members and constants

  //region ----------------------------------------------------- Events
  event OnInitialized(address controller, address cTokenAddressProvider, address comptroller, address user, address collateralAsset, address borrowAsset, address originConverter);
  event OnBorrow(uint collateralAmount, uint borrowAmount, address receiver, uint resultHealthFactor18);
  event OnBorrowToRebalance(uint borrowAmount, address receiver, uint resultHealthFactor18);
  event OnRepay(uint amountToRepay, address receiver, bool closePosition, uint resultHealthFactor18);
  event OnRepayToRebalance(uint amount, bool isCollateral, uint resultHealthFactor18);
  /// @notice On claim not empty {amount} of reward tokens
  event OnClaimRewards(address rewardToken, uint amount, address receiver);
  event OnSalvage(address receiver, address token, uint amount);
  event ValueReceived(address user, uint amount);
  //endregion ----------------------------------------------------- Events

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
    require(
      controller_ != address(0)
      && comptroller_ != address(0)
      && user_ != address(0)
      && collateralAsset_ != address(0)
      && borrowAsset_ != address(0)
      && originConverter_ != address(0)
      && cTokenAddressProvider_ != address(0),
      AppErrors.ZERO_ADDRESS
    );

    controller = IConverterController(controller_);
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

    _comptroller = IDForceController(comptroller_);

    // The pool adapter doesn't keep assets on its balance, so it's safe to use infinity approve
    // All approves replaced by infinity-approve were commented in the code below
    IERC20(collateralAsset_).safeApprove(cTokenCollateral, 2 ** 255); // 2*255 is more gas-efficient than type(uint).max
    IERC20(borrowAsset_).safeApprove(cTokenBorrow, 2 ** 255); // 2*255 is more gas-efficient than type(uint).max

    emit OnInitialized(controller_, cTokenAddressProvider_, comptroller_, user_, collateralAsset_, borrowAsset_, originConverter_);
  }

  /// @notice Save any not cToken  from balance to {receiver}
  /// @dev Normally this contract doesn't have any tokens on balance except cTokens
  function salvage(address receiver, address token, uint amount) external {
    require(msg.sender == controller.governance(), AppErrors.GOVERNANCE_ONLY);
    require(token != collateralCToken && token != borrowCToken, AppErrors.UNSALVAGEABLE);

    IERC20(token).safeTransfer(receiver, amount);
    emit OnSalvage(receiver, token, amount);
  }
  //endregion ----------------------------------------------------- Initialization

  //region ----------------------------------------------------- Restrictions

  /// @notice Ensure that the caller is TetuConverter
  function _onlyTetuConverter(IConverterController controller_) internal view {
    require(controller_.tetuConverter() == msg.sender, AppErrors.TETU_CONVERTER_ONLY);
  }
  //endregion ----------------------------------------------------- Restrictions

  //region ----------------------------------------------------- Borrow logic
  function updateStatus() external override {
    _onlyTetuConverter(controller);

    // Update borrowBalance to actual value
    IDForceCToken(borrowCToken).borrowBalanceCurrent(address(this));
    IDForceCToken(collateralCToken).exchangeRateCurrent();
  }

  /// @notice Supply collateral to the pool and borrow specified amount
  /// @dev No re-balancing here; Collateral amount must be approved to the pool adapter before the call of this function
  /// @param collateralAmount_ Amount of collateral, must be approved to the pool adapter before the call of borrow()
  /// @param borrowAmount_ Amount that should be borrowed in result
  /// @param receiver_ Receiver of the borrowed amount
  /// @return Result borrowed amount sent to the {receiver_}
  function borrow(
    uint collateralAmount_,
    uint borrowAmount_,
    address receiver_
  ) external override returns (uint) {
    IConverterController c = controller;
    _onlyTetuConverter(c);

    address cTokenCollateral = collateralCToken;
    address cTokenBorrow = borrowCToken;
    address assetCollateral = collateralAsset;
    address assetBorrow = borrowAsset;

    IERC20(assetCollateral).safeTransferFrom(msg.sender, address(this), collateralAmount_);

    // enter markets (repeat entering is not a problem)
    address[] memory markets = new address[](2);
    markets[0] = cTokenCollateral;
    markets[1] = cTokenBorrow;
    _comptroller.enterMarkets(markets);

    uint tokenBalanceBefore = _supply(cTokenCollateral, assetCollateral, collateralAmount_);

    // make borrow
    uint balanceBorrowAsset0 = _getBalance(assetBorrow);
    IDForceCToken(cTokenBorrow).borrow(borrowAmount_);

    // ensure that we have received required borrowed amount, send the amount to the receiver
    if (_isMatic(assetBorrow)) {
      IWmatic(WMATIC).deposit{value: borrowAmount_}();
    }
    require(
      borrowAmount_ + balanceBorrowAsset0 == IERC20(assetBorrow).balanceOf(address(this)),
      AppErrors.WRONG_BORROWED_BALANCE
    );
    IERC20(assetBorrow).safeTransfer(receiver_, borrowAmount_);

    // register the borrow in DebtMonitor
    IDebtMonitor(c.debtMonitor()).onOpenPosition();

    // ensure that current health factor is greater than min allowed
    (uint healthFactor, uint tokenBalanceAfter) = _validateHealthStatusAfterBorrow(c, cTokenCollateral, cTokenBorrow);
    require(tokenBalanceAfter >= tokenBalanceBefore, AppErrors.WEIRD_OVERFLOW); // overflow below is not possible
    collateralTokensBalance += tokenBalanceAfter - tokenBalanceBefore;

    emit OnBorrow(collateralAmount_, borrowAmount_, receiver_, healthFactor);

    return borrowAmount_;
  }

  /// @notice Supply collateral to DForce market
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

    // supply collateral
    if (_isMatic(assetCollateral_)) {
      IWmatic(WMATIC).withdraw(collateralAmount_);
      IDForceCTokenMatic(cTokenCollateral_).mint{value: collateralAmount_}(address(this));
    } else {
      // replaced by infinity approve: IERC20(assetCollateral_).safeApprove(cTokenCollateral_, collateralAmount_);
      IDForceCToken(cTokenCollateral_).mint(address(this), collateralAmount_);
    }
    return tokenBalanceBefore;
  }

  /// @return (Health factor, decimal 18; collateral-token-balance)
  function _validateHealthStatusAfterBorrow(
    IConverterController controller_,
    address cTokenCollateral_,
    address cTokenBorrow_
  ) internal view returns (uint, uint) {
    (uint tokenBalance,,
      uint collateralBase36,
      uint borrowBase36,,
    ) = _getStatus(cTokenCollateral_, cTokenBorrow_);

    (uint sumCollateralSafe36,
      uint healthFactor18
    ) = _getHealthFactor(cTokenCollateral_, collateralBase36, borrowBase36);

    // USD with 36 integer precision
    // see https://developers.dforce.network/lend/lend-and-synth/controller#calcaccountequity
    (uint liquidity36,,,) = _comptroller.calcAccountEquity(address(this));

    require(
      sumCollateralSafe36 > borrowBase36
      && borrowBase36 != 0
      // here we should have: sumCollateralSafe - sumBorrowPlusEffects == liquidity
      && liquidity36 + DELTA + borrowBase36 >= sumCollateralSafe36,
      AppErrors.INCORRECT_RESULT_LIQUIDITY
    );

    _validateHealthFactor(controller_, healthFactor18);
    return (healthFactor18, tokenBalance);
  }

  /// @notice Borrow additional amount {borrowAmount_} using exist collateral and send it to {receiver_}
  /// @dev Re-balance: too big health factor => target health factor
  /// @return resultHealthFactor18 Result health factor after borrow
  /// @return borrowedAmountOut Exact amount sent to the borrower
  function borrowToRebalance(uint borrowAmount_, address receiver_) external override returns (
    uint resultHealthFactor18,
    uint borrowedAmountOut
  ) {
    IConverterController c = controller;
    _onlyTetuConverter(c);
    address cTokenBorrow = borrowCToken;
    address assetBorrow = borrowAsset;

    // ensure that the position is opened
    require(IDebtMonitor(c.debtMonitor()).isPositionOpened(), AppErrors.BORROW_POSITION_IS_NOT_REGISTERED);

    // make borrow
    uint balanceBorrowAsset0 = _getBalance(assetBorrow);
    IDForceCToken(cTokenBorrow).borrow(borrowAmount_);

    // ensure that we have received required borrowed amount, send the amount to the receiver
    if (_isMatic(assetBorrow)) {
      IWmatic(WMATIC).deposit{value: borrowAmount_}();
    }
    require(
      borrowAmount_ + balanceBorrowAsset0 == IERC20(assetBorrow).balanceOf(address(this)),
      AppErrors.WRONG_BORROWED_BALANCE
    );
    IERC20(assetBorrow).safeTransfer(receiver_, borrowAmount_);

    // ensure that current health factor is greater than min allowed
    (resultHealthFactor18,) = _validateHealthStatusAfterBorrow(c, collateralCToken, cTokenBorrow);

    emit OnBorrowToRebalance(borrowAmount_, receiver_, resultHealthFactor18);
    return (resultHealthFactor18, borrowAmount_);
  }
  //endregion ----------------------------------------------------- Borrow logic

  //region ----------------------------------------------------- Repay logic

  /// @notice Repay borrowed amount, return collateral to the user
  /// @param amountToRepay_ Exact amount of borrow asset that should be repaid
  ///                       The amount should be approved for the pool adapter before the call of repay()
  /// @param closePosition_ true to pay full borrowed amount
  /// @param receiver_ Receiver of withdrawn collateral
  /// @return collateralAmountToReturn Amount of collateral asset sent to the {receiver_}
  function repay(
    uint amountToRepay_,
    address receiver_,
    bool closePosition_
  ) external override returns (uint collateralAmountToReturn) {
    IConverterController c = controller;
    _onlyTetuConverter(c);

    uint healthFactor18;
    {
      address assetBorrow = borrowAsset;
      address assetCollateral = collateralAsset;
      address cTokenBorrow = borrowCToken;
      address cTokenCollateral = collateralCToken;

      {
        // Update borrowBalance to actual value, we must do it before calculation of collateral to withdraw
        uint debt = IDForceCToken(cTokenBorrow).borrowBalanceCurrent(address(this));
        if (amountToRepay_ > debt) {
          // all amount exceeded the debt should be directly sent to the {receiver_}
          IERC20(assetBorrow).safeTransferFrom(msg.sender, receiver_, amountToRepay_ - debt);
          amountToRepay_ = debt;
        }
      }

      IERC20(assetBorrow).safeTransferFrom(msg.sender, address(this), amountToRepay_);
      // we don't need following check after successful safeTransferFrom
      //    require(IERC20(assetBorrow).balanceOf(address(this)) >= amountToRepay_, AppErrors.MINT_FAILED);

      // how much collateral we are going to return
      (uint collateralTokensToWithdraw, uint tokenBalanceBefore) = _getCollateralTokensToRedeem(
        cTokenCollateral,
        cTokenBorrow,
        closePosition_,
        amountToRepay_
      );

      // transfer borrow amount back to the pool
      if (_isMatic(address(assetBorrow))) {
        IWmatic(WMATIC).withdraw(amountToRepay_);
        IDForceCTokenMatic(cTokenBorrow).repayBorrow{value: amountToRepay_}();
      } else {
        // replaced by infinity approve: IERC20(assetBorrow).safeApprove(cTokenBorrow, amountToRepay_);
        IDForceCToken(cTokenBorrow).repayBorrow(amountToRepay_);
      }

      // withdraw the collateral
      uint balanceCollateralAsset = _getBalance(assetCollateral);
      IDForceCToken(cTokenCollateral).redeem(address(this), collateralTokensToWithdraw);
      uint balanceCollateralAssetAfterRedeem = _getBalance(assetCollateral);

      // transfer collateral back to the user
      require(balanceCollateralAssetAfterRedeem >= balanceCollateralAsset, AppErrors.WEIRD_OVERFLOW); // overflow is not possible below
      collateralAmountToReturn = balanceCollateralAssetAfterRedeem - balanceCollateralAsset;
      if (_isMatic(assetCollateral)) {
        IWmatic(WMATIC).deposit{value: collateralAmountToReturn}();
      }
      IERC20(assetCollateral).safeTransfer(receiver_, collateralAmountToReturn);

      // validate result status
      (uint tokenBalanceAfter,
        uint borrowBalance,
        uint collateralBase,
        uint sumBorrowPlusEffects,,
      ) = _getStatus(cTokenCollateral, cTokenBorrow);


      if (tokenBalanceAfter == 0 && borrowBalance == 0) {
        IDebtMonitor(c.debtMonitor()).onClosePosition();
        // We don't exit the market to avoid additional gas consumption
      } else {
        require(!closePosition_, AppErrors.CLOSE_POSITION_FAILED);
        (, healthFactor18) = _getHealthFactor(cTokenCollateral, collateralBase, sumBorrowPlusEffects);
        _validateHealthFactor(c, healthFactor18);
      }

      require(
        tokenBalanceBefore >= tokenBalanceAfter
        && collateralTokensBalance >= tokenBalanceBefore - tokenBalanceAfter,
        AppErrors.WEIRD_OVERFLOW
      );
      collateralTokensBalance -= tokenBalanceBefore - tokenBalanceAfter;
    }

    emit OnRepay(amountToRepay_, receiver_, closePosition_, healthFactor18);
    return collateralAmountToReturn;
  }

  /// @return Amount of collateral tokens to redeem, full balance of collateral tokens
  function _getCollateralTokensToRedeem(
    address cTokenCollateral_,
    address cTokenBorrow_,
    bool closePosition_,
    uint amountToRepay_
  ) internal view returns (uint, uint) {
    uint tokenBalance = IERC20(cTokenCollateral_).balanceOf(address(this));

    uint borrowBalance = IDForceCToken(cTokenBorrow_).borrowBalanceStored(address(this));
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
  /// @param amount_ Exact amount of asset that is transferred to the balance of the pool adapter.
  ///                It can be amount of collateral asset or borrow asset depended on {isCollateral_}
  ///                It must be stronger less then total borrow debt.
  ///                The amount should be approved for the pool adapter before the call.
  /// @param isCollateral_ true/false indicates that {amount_} is the amount of collateral/borrow asset
  /// @return resultHealthFactor18 Result health factor after repay, decimals 18
  function repayToRebalance(
    uint amount_,
    bool isCollateral_
  ) external override returns (
    uint resultHealthFactor18
  ) {
    IConverterController c = controller;
    _onlyTetuConverter(c);

    address cTokenBorrow = borrowCToken;
    address cTokenCollateral = collateralCToken;
    uint tokenBalanceBefore;

    // ensure that the position is opened
    require(IDebtMonitor(c.debtMonitor()).isPositionOpened(), AppErrors.BORROW_POSITION_IS_NOT_REGISTERED);

    if (isCollateral_) {
      address assetCollateral = collateralAsset;
      IERC20(assetCollateral).safeTransferFrom(msg.sender, address(this), amount_);
      tokenBalanceBefore = _supply(cTokenCollateral, collateralAsset, amount_);
    } else {
      uint borrowBalance;
      address assetBorrow = borrowAsset;
      // ensure, that amount to repay is less then the total debt
      (tokenBalanceBefore, borrowBalance,,,,) = _getStatus(cTokenCollateral, cTokenBorrow);
      require(borrowBalance != 0 && amount_ < borrowBalance, AppErrors.REPAY_TO_REBALANCE_NOT_ALLOWED);

      IERC20(assetBorrow).safeTransferFrom(msg.sender, address(this), amount_);
      // the amount is received through safeTransferFrom so we don't need following additional check:
      //    require(IERC20(assetBorrow).balanceOf(address(this)) >= amount_, AppErrors.MINT_FAILED);

      // transfer borrow amount back to the pool
      if (_isMatic(assetBorrow)) {
        IWmatic(WMATIC).withdraw(amount_);
        IDForceCTokenMatic(cTokenBorrow).repayBorrow{value: amount_}();
      } else {
        // replaced by infinity approve in constructor: IERC20(assetBorrow).safeApprove(cTokenBorrow, amount_);
        IDForceCToken(cTokenBorrow).repayBorrow(amount_);
      }
    }
    // validate result status
    (uint tokenBalanceAfter,,
      uint collateralBase,
      uint sumBorrowPlusEffects,,
    ) = _getStatus(cTokenCollateral, cTokenBorrow);

    (, uint healthFactor18) = _getHealthFactor(cTokenCollateral, collateralBase, sumBorrowPlusEffects);
    _validateHealthFactor(c, healthFactor18);

    require(tokenBalanceAfter >= tokenBalanceBefore, AppErrors.WEIRD_OVERFLOW);
    collateralTokensBalance += tokenBalanceAfter - tokenBalanceBefore;

    emit OnRepayToRebalance(amount_, isCollateral_, healthFactor18);
    return healthFactor18;
  }

  /// @notice If we paid {amountToRepay_}, how much collateral would we receive?
  function getCollateralAmountToReturn(uint amountToRepay_, bool closePosition_) external view override returns (uint) {
    address cTokenCollateral = collateralCToken;

    (uint tokensToReturn,) = _getCollateralTokensToRedeem(cTokenCollateral, borrowCToken, closePosition_, amountToRepay_);
    return tokensToReturn * IDForceCToken(cTokenCollateral).exchangeRateStored() / 10 ** 18;
  }
  //endregion ----------------------------------------------------- Repay logic

  //region ----------------------------------------------------- Rewards

  /// @notice Check if any reward tokens exist on the balance of the pool adapter, transfer reward tokens to {receiver_}
  /// @return rewardTokenOut Address of the transferred reward token
  /// @return amountOut Amount of the transferred reward token
  function claimRewards(address receiver_) external override returns (
    address rewardTokenOut,
    uint amountOut
  ) {
    _onlyTetuConverter(controller);

    IDForceRewardDistributor rd = IDForceRewardDistributor(_comptroller.rewardDistributor());
    rewardTokenOut = rd.rewardToken();

    address cTokenBorrow = borrowCToken;
    address cTokenCollateral = collateralCToken;
    rd.updateDistributionState(cTokenCollateral, false);
    rd.updateDistributionState(cTokenBorrow, true);
    rd.updateReward(cTokenCollateral, address(this), false);
    rd.updateReward(cTokenBorrow, address(this), true);

    amountOut = rd.reward(address(this));
    if (amountOut != 0) {
      address[] memory holders = new address[](1);
      holders[0] = address(this);
      rd.claimAllReward(holders);

      uint balance = IERC20(rewardTokenOut).balanceOf(address(this));
      if (balance != 0) {
        IERC20(rewardTokenOut).safeTransfer(receiver_, balance);
      }

      emit OnClaimRewards(rewardTokenOut, amountOut, receiver_);
    }

    return (rewardTokenOut, amountOut);
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
    return (originConverter, user, collateralAsset, borrowAsset);
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
    address cTokenBorrow = borrowCToken;
    address cTokenCollateral = collateralCToken;

    (uint collateralTokens,
      uint borrowBalance,
      uint collateralBase36,
      uint borrowBase36,
      uint collateralAmountLiquidatedBase36,
      uint collateralPrice
    ) = _getStatus(cTokenCollateral, cTokenBorrow);

    (, healthFactor18) = _getHealthFactor(
      cTokenCollateral,
      collateralBase36,
      borrowBase36
    );

    return (
    // Total amount of provided collateral in [collateral asset]
      collateralBase36 / collateralPrice,
    // Total amount of borrowed debt in [borrow asset]. 0 - for closed borrow positions.
      borrowBalance,
    // Current health factor, decimals 18
      healthFactor18,
      collateralTokens != 0 || borrowBalance != 0,
    // Amount of liquidated collateral == amount of lost
      collateralAmountLiquidatedBase36 / collateralPrice,
      false
    );
  }

  /// @return tokenBalanceOut Count of collateral tokens on balance
  /// @return borrowBalanceOut Borrow amount [borrow asset units]
  /// @return collateralAmountBase36 Total collateral in base currency, decimals 36
  /// @return sumBorrowBase36 Total borrow amount in base currency, decimals 36
  function _getStatus(address cTokenCollateral_, address cTokenBorrow_) internal view returns (
    uint tokenBalanceOut,
    uint borrowBalanceOut,
    uint collateralAmountBase36,
    uint sumBorrowBase36,
    uint collateralAmountLiquidatedBase36,
    uint collateralPrice
  ) {
    // Calculate value of all collaterals, see ControllerV2.calcAccountEquityWithEffect
    // collateralValuePerToken = underlyingPrice * exchangeRate * collateralFactor
    // collateralValue = balance * collateralValuePerToken
    // sumCollateral += collateralValue
    tokenBalanceOut = IDForceCToken(cTokenCollateral_).balanceOf(address(this));

    IDForcePriceOracle priceOracle = IDForcePriceOracle(_comptroller.priceOracle());
    collateralPrice = DForceAprLib.getPrice(priceOracle, cTokenCollateral_);

    {
      uint exchangeRateMantissa = IDForceCToken(cTokenCollateral_).exchangeRateStored();
      collateralAmountBase36 = tokenBalanceOut * collateralPrice * exchangeRateMantissa / 10 ** 18;
      collateralAmountLiquidatedBase36 = tokenBalanceOut > collateralTokensBalance
        ? 0
        : (collateralTokensBalance - tokenBalanceOut) * collateralPrice * exchangeRateMantissa / 10 ** 18;
    }

    // Calculate all borrowed value, see ControllerV2.calcAccountEquityWithEffect
    // borrowValue = underlyingPrice * underlyingBorrowed / borrowFactor
    // sumBorrowed += borrowValue
    borrowBalanceOut = IDForceCToken(cTokenBorrow_).borrowBalanceStored(address(this));

    uint underlyingPrice = DForceAprLib.getPrice(priceOracle, cTokenBorrow_);

    sumBorrowBase36 = borrowBalanceOut * underlyingPrice;

    return (
      tokenBalanceOut,
      borrowBalanceOut,
      collateralAmountBase36,
      sumBorrowBase36,
      collateralAmountLiquidatedBase36,
      collateralPrice
    );
  }

  function getConversionKind() external pure override returns (AppDataTypes.ConversionKind) {
    return AppDataTypes.ConversionKind.BORROW_2;
  }
  //endregion ----------------------------------------------------- View current status

  //region ----------------------------------------------------- Utils
  function _getHealthFactor(address cTokenCollateral_, uint sumCollateralBase36_, uint sumBorrowBase36_)
  internal view returns (
    uint sumCollateralSafe36,
    uint healthFactor18
  ) {
    (uint collateralFactorMantissa,,,,,,) = _comptroller.markets(cTokenCollateral_);

    sumCollateralSafe36 = collateralFactorMantissa * sumCollateralBase36_ / 10 ** 18;

    healthFactor18 = sumBorrowBase36_ == 0
      ? type(uint).max
      : sumCollateralSafe36 * 10 ** 18 / sumBorrowBase36_;
    return (sumCollateralSafe36, healthFactor18);
  }

  function _validateHealthFactor(IConverterController controller_, uint hf18) internal view {
    require(hf18 > uint(controller_.minHealthFactor2()) * 10 ** (18 - 2), AppErrors.WRONG_HEALTH_FACTOR);
  }
  //endregion ----------------------------------------------------- Utils

  //region ----------------------------------------------------- Native tokens

  function _isMatic(address asset_) internal pure returns (bool) {
    return asset_ == WMATIC;
  }

  function _getBalance(address asset) internal view returns (uint) {
    return _isMatic(asset)
      ? address(this).balance
      : IERC20(asset).balanceOf(address(this));
  }

  /// @notice this is needed for the native token unwrapping
  receive() external payable {
    emit ValueReceived(msg.sender, msg.value);
    require(
      msg.sender == WMATIC
      || msg.sender == DFORCE_MATIC
      || msg.sender == collateralCToken
      || msg.sender == borrowCToken,
      AppErrors.ACCESS_DENIED
    );
  }
  //endregion ----------------------------------------------------- Native tokens
}
