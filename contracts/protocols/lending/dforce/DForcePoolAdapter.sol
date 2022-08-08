// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../../../openzeppelin/SafeERC20.sol";
import "../../../openzeppelin/IERC20.sol";
import "../../../interfaces/IPoolAdapter.sol";
import "../../../core/DebtMonitor.sol";
import "../../../core/AppErrors.sol";
import "../../../integrations/dforce/IDForceController.sol";
import "../../../interfaces/IPoolAdapterInitializerWithAP.sol";
import "../../../integrations/dforce/IDForceCToken.sol";
import "../../../integrations/dforce/IDForcePriceOracle.sol";
import "../../../interfaces/ITokenAddressProvider.sol";
import "../../../integrations/dforce/IDForceCTokenMatic.sol";
import "../../../integrations/IWmatic.sol";

/// @notice Implementation of IPoolAdapter for dForce-protocol, see https://developers.dforce.network/
/// @dev Instances of this contract are created using proxy-minimal pattern, so no constructor
contract DForcePoolAdapter is IPoolAdapter, IPoolAdapterInitializerWithAP {
  using SafeERC20 for IERC20;

  address private constant WMATIC = address(0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270);

  address public collateralAsset;
  address public borrowAsset;
  address public collateralCToken;
  address public borrowCToken;
  address public user;

  IController public controller;
  IDForceController private _comptroller;
  /// @notice Implementation of IDForcePriceOracle
  IDForcePriceOracle private _priceOracle;

  /// @notice Last synced amount of given token on the balance of this contract
  mapping(address => uint) public collateralBalance;

  /// @notice Last synced amount of given token on the balance of this contract
  mapping(address => uint) public reserveBalances;

  ///////////////////////////////////////////////////////
  ///                Initialization
  ///////////////////////////////////////////////////////

  function initialize(
    address controller_,
    address cTokenAddressProvider_,
    address comptroller_,
    address user_,
    address collateralAsset_,
    address borrowAsset_
  ) override external {
    require(
      controller_ != address(0)
      && comptroller_ != address(0)
      && user_ != address(0)
      && collateralAsset_ != address(0)
      && borrowAsset_ != address(0)
      && cTokenAddressProvider_ != address(0)
      , AppErrors.ZERO_ADDRESS
    );

    controller = IController(controller_);
    user = user_;
    collateralAsset = collateralAsset_;
    borrowAsset = borrowAsset_;

    (address cTokenCollateral, address cTokenBorrow, address priceOracle) = ITokenAddressProvider(cTokenAddressProvider_)
      .getCTokenByUnderlying(collateralAsset_, borrowAsset_);

    require(cTokenCollateral != address(0), AppErrors.HF_DERIVATIVE_TOKEN_NOT_FOUND);
    require(cTokenBorrow != address(0), AppErrors.HF_DERIVATIVE_TOKEN_NOT_FOUND);
    require(priceOracle != address(0), AppErrors.ZERO_ADDRESS);

    collateralCToken = cTokenCollateral;
    borrowCToken = cTokenBorrow;
    _priceOracle = IDForcePriceOracle(priceOracle);

    _comptroller = IDForceController(comptroller_);
  }

  ///////////////////////////////////////////////////////
  ///                 Borrow logic
  ///////////////////////////////////////////////////////

  /// @dev TC calls this function before transferring any amounts to balance of this contract
  function syncBalance(bool beforeBorrow_) external override {
    if (beforeBorrow_) {
      address assetCollateral = collateralAsset;
      reserveBalances[assetCollateral] = _getBalance(assetCollateral);
    } else {
      // Update borrowBalance to actual value
      IDForceCToken(borrowCToken).borrowBalanceCurrent(address(this));
    }

    address assetBorrow = borrowAsset;
    reserveBalances[assetBorrow] = _getBalance(assetBorrow);
  }

  /// @notice Supply collateral to the pool and borrow {borrowedAmount_} in {borrowedToken_}
  /// @dev Caller should call "syncBalance" before transferring borrow amount and call "borrow"
  function borrow(
    uint collateralAmount_,
    uint borrowAmount_,
    address receiver_
  ) external override {
    _onlyTC();
    address cTokenCollateral = collateralCToken;
    address cTokenBorrow = borrowCToken;
    address assetCollateral = collateralAsset;
    address assetBorrow = borrowAsset;

    // ensure we have received expected collateral amount
    require(
      collateralAmount_ >= _getBalance(assetCollateral) - reserveBalances[assetCollateral]
      , AppErrors.WRONG_COLLATERAL_BALANCE
    );

    // enter markets (repeat entering is not a problem)
    address[] memory markets = new address[](2);
    markets[0] = cTokenCollateral;
    markets[1] = cTokenBorrow;
    _comptroller.enterMarkets(markets);

    // supply collateral
    if (_isMatic(assetCollateral)) {
      require(IERC20(WMATIC).balanceOf(address(this)) >= collateralAmount_, AppErrors.MINT_FAILED);
      IWmatic(WMATIC).withdraw(collateralAmount_);
      IDForceCTokenMatic(cTokenCollateral).mint{value : collateralAmount_}(address(this));
    } else {
      IERC20(assetCollateral).approve(cTokenCollateral, collateralAmount_);
      IDForceCToken(cTokenCollateral).mint(address(this), collateralAmount_);
    }

    // make borrow
    IDForceCToken(cTokenBorrow).borrow(borrowAmount_);

    // ensure that we have received required borrowed amount, send the amount to the receiver
    if (_isMatic(assetBorrow)) {
      IWmatic(WMATIC).deposit{value : borrowAmount_}();
    }
    require(
      borrowAmount_ == IERC20(assetBorrow).balanceOf(address(this)) - reserveBalances[address(assetBorrow)]
      , AppErrors.WRONG_BORROWED_BALANCE
    );
    IERC20(assetBorrow).safeTransfer(receiver_, borrowAmount_);

    // register the borrow in DebtMonitor
    IDebtMonitor(controller.debtMonitor()).onOpenPosition();

    // TODO: send cTokens anywhere?

    // ensure that current health factor is greater than min allowed
    _validateHealthStatusAfterBorrow(cTokenCollateral, cTokenBorrow);
  }

  function _validateHealthStatusAfterBorrow(address cTokenCollateral, address cTokenBorrow) internal view {
    (,, uint collateralBase, uint borrowBase) = _getStatus(cTokenCollateral, cTokenBorrow);
    (uint sumCollateralSafe, uint healthFactor18) = _getHealthFactor(cTokenCollateral, collateralBase, borrowBase);

    (uint liquidity,,,) = _comptroller.calcAccountEquity(address(this));

    require(
      sumCollateralSafe > borrowBase
      && borrowBase > 0
    // here we should have: sumCollateralSafe - sumBorrowPlusEffects == liquidity
    // but it seems like round-error can happen, we can check only sumCollateralSafe - sumBorrowPlusEffects ~ liquidity
    // let's ensure that liquidity has a reasonable value //TODO: remove this check at all?
      && liquidity > (sumCollateralSafe - borrowBase) / 2
      , AppErrors.HF_INCORRECT_RESULT_LIQUIDITY
    );

    require(healthFactor18 > uint(controller.MIN_HEALTH_FACTOR2())*10**(18-2), AppErrors.WRONG_HEALTH_FACTOR);
  }

  ///////////////////////////////////////////////////////
  ///                 Repay logic
  ///////////////////////////////////////////////////////

  /// @notice Repay borrowed amount, return collateral to the user
  /// @dev Caller should call "syncBalance" before transferring amount to repay and call the "repay"
  function repay(
    uint amountToRepay_,
    address receiver_,
    bool closePosition
  ) external override {
    address assetBorrow = borrowAsset;
    address assetCollateral = collateralAsset;
    address cTokenBorrow = borrowCToken;
    address cTokenCollateral = collateralCToken;

    // ensure that we have received enough money on our balance just before repay was called
    require(
      amountToRepay_ == IERC20(assetBorrow).balanceOf(address(this)) - reserveBalances[assetBorrow]
    , AppErrors.WRONG_BORROWED_BALANCE
    );

    // how much collateral we are going to return
    uint collateralTokensToWithdraw = _getCollateralTokensToRedeem(
      cTokenCollateral,
      cTokenBorrow,
      closePosition,
      amountToRepay_
    );

    // transfer borrow amount back to the pool
    if (_isMatic(address(assetBorrow))) {
      require(IERC20(WMATIC).balanceOf(address(this)) >= amountToRepay_, AppErrors.MINT_FAILED);
      IWmatic(WMATIC).withdraw(amountToRepay_);
      IDForceCTokenMatic(cTokenBorrow).repayBorrow{value : amountToRepay_}();
    } else {
      IERC20(assetBorrow).approve(cTokenBorrow, amountToRepay_); //TODO: do we need approve(0)?
      IDForceCToken(cTokenBorrow).repayBorrow(amountToRepay_);
    }

    // withdraw the collateral
    uint balanceCollateralAsset = _getBalance(assetCollateral);
    IDForceCToken(cTokenCollateral).redeem(address(this), collateralTokensToWithdraw);

    // transfer collateral back to the user
    uint amountToReturn = _getBalance(assetCollateral) - balanceCollateralAsset;
    if (_isMatic(assetCollateral)) {
      IWmatic(WMATIC).deposit{value : amountToReturn}();
    }
    IERC20(assetCollateral).safeTransfer(receiver_, amountToReturn);

    // validate result status
    (uint tokenBalance,
     uint borrowBalance,
     uint collateralBase,
     uint sumBorrowPlusEffects
    ) = _getStatus(cTokenCollateral, cTokenBorrow);

    if (tokenBalance == 0 && borrowBalance == 0) {
      IDebtMonitor(controller.debtMonitor()).onClosePosition();
      //!TODO: do we need exit the markets?
    } else {
      require(!closePosition, AppErrors.CLOSE_POSITION_FAILED);
      (, uint healthFactor18) = _getHealthFactor(cTokenCollateral, collateralBase, sumBorrowPlusEffects);
      require(healthFactor18 > uint(controller.MIN_HEALTH_FACTOR2())*10**(18-2), AppErrors.WRONG_HEALTH_FACTOR);
    }
  }

  function _getCollateralTokensToRedeem(
    address cTokenCollateral_,
    address cTokenBorrow_,
    bool closePosition_,
    uint amountToRepay_
  ) internal view returns (uint) {
    uint tokenBalance = IERC20(cTokenCollateral_).balanceOf(address(this));

    if (closePosition_) {
      return tokenBalance;
    }

    uint borrowBalance = IDForceCToken(cTokenBorrow_).borrowBalanceStored(address(this));
    require(borrowBalance != 0 && amountToRepay_ <= borrowBalance, AppErrors.WRONG_BORROWED_BALANCE);

    return tokenBalance * amountToRepay_ / borrowBalance;
  }

  ///////////////////////////////////////////////////////
  ///         View current status
  ///////////////////////////////////////////////////////

  function getConfig() external view override returns (
    address pool,
    address outUser,
    address outCollateralAsset,
    address outBorrowAsset
  ) {
    return (address(_comptroller), user, collateralAsset, borrowAsset);
  }

  function getStatus() external view override returns (
    uint collateralAmount,
    uint amountsToPay,
    uint healthFactor18
  ) {
    address cTokenBorrow = borrowCToken;
    address cTokenCollateral = collateralCToken;
    (, uint borrowBalance, uint collateralBase, uint borrowBase) = _getStatus(cTokenCollateral, cTokenBorrow);
    (, healthFactor18) = _getHealthFactor(
      cTokenCollateral,
      collateralBase,
      borrowBase
    );
    return (
    // Total amount of provided collateral in Pool adapter's base currency
      collateralBase,
    // Total amount of borrowed debt in [borrow asset]. 0 - for closed borrow positions.
      borrowBalance,
    // Current health factor, decimals 18
      healthFactor18
    );
  }

  /// @return tokenBalance Count of collateral tokens on balance
  /// @return borrowBalance Borrow amount [borrow asset units]
  /// @return collateralAmountBASE Total collateral in base currency
  /// @return sumBorrowBASE Total borrow amount in base currency
  function _getStatus(address cTokenCollateral_, address cTokenBorrow_) internal view returns (
    uint tokenBalance,
    uint borrowBalance,
    uint collateralAmountBASE,
    uint sumBorrowBASE
  ) {
    // Calculate value of all collaterals, see ControllerV2.calcAccountEquityWithEffect
    // collateralValuePerToken = underlyingPrice * exchangeRate * collateralFactor
    // collateralValue = balance * collateralValuePerToken
    // sumCollateral += collateralValue
    tokenBalance = IERC20(cTokenCollateral_).balanceOf(address(this));
    uint exchangeRateMantissa = IDForceCToken(cTokenCollateral_).exchangeRateStored();

    (uint underlyingPrice, bool isPriceValid) = _priceOracle.getUnderlyingPriceAndStatus(address(cTokenCollateral_));
    require(underlyingPrice != 0 && isPriceValid, AppErrors.ZERO_PRICE);

    collateralAmountBASE = tokenBalance * underlyingPrice * exchangeRateMantissa / 10**18;

    // Calculate all borrowed value, see ControllerV2.calcAccountEquityWithEffect
    // borrowValue = underlyingPrice * underlyingBorrowed / borrowFactor
    // sumBorrowed += borrowValue
    borrowBalance = IDForceCToken(cTokenBorrow_).borrowBalanceStored(address(this));

    (underlyingPrice, isPriceValid) = _priceOracle.getUnderlyingPriceAndStatus(address(cTokenBorrow_));
    require(underlyingPrice != 0 && isPriceValid, AppErrors.ZERO_PRICE);

    sumBorrowBASE = borrowBalance * underlyingPrice;

    return (tokenBalance, borrowBalance, collateralAmountBASE, sumBorrowBASE);
  }

  function getConversionKind() external pure override returns (AppDataTypes.ConversionKind) {
    return AppDataTypes.ConversionKind.BORROW_2;
  }

  ///////////////////////////////////////////////////////
  ///         Utils
  ///////////////////////////////////////////////////////
  function _getHealthFactor(address cTokenCollateral_, uint sumCollateralBase_, uint sumBorrowBase_)
  internal view returns (
    uint sumCollateralSafe,
    uint healthFactor18
  ) {
    (uint collateralFactorMantissa,,,,,,) = _comptroller.markets(cTokenCollateral_);

    sumCollateralSafe = collateralFactorMantissa * sumCollateralBase_ / 10**18;

    healthFactor18 = sumBorrowBase_ == 0
      ? type(uint).max
      : sumCollateralSafe * 10**18 / sumBorrowBase_;
    return (sumCollateralSafe, healthFactor18);
  }

  /// @notice Ensure that the caller is TetuConveter
  function _onlyTC() internal view {
    require(controller.tetuConverter() == msg.sender, AppErrors.TETU_CONVERTER_ONLY);
  }

  /// @notice Convert {amount} with [sourceDecimals} to new amount with {targetDecimals}
  function _toMantissa(uint amount, uint8 sourceDecimals, uint8 targetDecimals) internal pure returns (uint) {
    return sourceDecimals == targetDecimals
      ? amount
      : amount * (10 ** targetDecimals) / (10 ** sourceDecimals);
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