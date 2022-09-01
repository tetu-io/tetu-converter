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
import "../../../integrations/dforce/IDForceInterestRateModel.sol";
import "../../../integrations/dforce/IDForceRewardDistributor.sol";
import "hardhat/console.sol";

/// @notice Implementation of IPoolAdapter for dForce-protocol, see https://developers.dforce.network/
/// @dev Instances of this contract are created using proxy-minimal pattern, so no constructor
contract DForcePoolAdapter is IPoolAdapter, IPoolAdapterInitializerWithAP {
  using SafeERC20 for IERC20;

  /// @notice Max allowed difference for sumCollateralSafe - sumBorrowPlusEffects == liquidity
  uint private constant DELTA = 100;
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

  /// @notice Address of original PoolAdapter contract that was cloned to make the instance of the pool adapter
  address public originConverter;

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
    address borrowAsset_,
    address originConveter_
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
    originConverter = originConveter_;

    (address cTokenCollateral,
     address cTokenBorrow,
     address priceOracle
    ) = ITokenAddressProvider(cTokenAddressProvider_).getCTokenByUnderlying(collateralAsset_, borrowAsset_);

    require(cTokenCollateral != address(0), AppErrors.HF_DERIVATIVE_TOKEN_NOT_FOUND);
    require(cTokenBorrow != address(0), AppErrors.HF_DERIVATIVE_TOKEN_NOT_FOUND);
    require(priceOracle != address(0), AppErrors.ZERO_ADDRESS);

    collateralCToken = cTokenCollateral;
    borrowCToken = cTokenBorrow;
    _priceOracle = IDForcePriceOracle(priceOracle);

    _comptroller = IDForceController(comptroller_);
  }

  ///////////////////////////////////////////////////////
  ///                 Restrictions
  ///////////////////////////////////////////////////////

  /// @notice Ensure that the caller is TetuConveter
  function _onlyTC() internal view {
    require(controller.tetuConverter() == msg.sender, AppErrors.TETU_CONVERTER_ONLY);
  }

  /// @notice Ensure that the caller is the user or TetuConveter
  function _onlyUserOrTC() internal view {
    require(
      msg.sender == controller.tetuConverter()
      || msg.sender == user
    , AppErrors.USER_OR_TETU_CONVERTER_ONLY
    );
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
      IERC20(assetCollateral).approve(cTokenCollateral, 0);
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

    // ensure that current health factor is greater than min allowed
    _validateHealthStatusAfterBorrow(cTokenCollateral, cTokenBorrow);
  }

  function _validateHealthStatusAfterBorrow(address cTokenCollateral_, address cTokenBorrow_) internal view {
    (,, uint collateralBase36, uint borrowBase36,) = _getStatus(cTokenCollateral_, cTokenBorrow_);
    (uint sumCollateralSafe36,
     uint healthFactor18
    ) = _getHealthFactor(cTokenCollateral_, collateralBase36, borrowBase36);

    // USD with 36 integer precision
    // see https://developers.dforce.network/lend/lend-and-synth/controller#calcaccountequity
    (uint liquidity36,,,) = _comptroller.calcAccountEquity(address(this));

    require(
      sumCollateralSafe36 > borrowBase36
      && borrowBase36 > 0
    // here we should have: sumCollateralSafe - sumBorrowPlusEffects == liquidity
      && liquidity36 + DELTA >= sumCollateralSafe36 - borrowBase36
      , AppErrors.INCORRECT_RESULT_LIQUIDITY
    );
    console.log("liquidity", liquidity36);
    console.log("(sumCollateralSafe - borrowBase)", (sumCollateralSafe36 - borrowBase36) );

    _validateHealthFactor(healthFactor18);
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
  ) external override {
    _onlyUserOrTC();
    console.log("REPAY", amountToRepay_, closePosition_ ? 1 : 0);

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
      closePosition_,
      amountToRepay_
    );

    // transfer borrow amount back to the pool
    if (_isMatic(address(assetBorrow))) {
      require(IERC20(WMATIC).balanceOf(address(this)) >= amountToRepay_, AppErrors.MINT_FAILED);
      IWmatic(WMATIC).withdraw(amountToRepay_);
      IDForceCTokenMatic(cTokenBorrow).repayBorrow{value : amountToRepay_}();
    } else {
      IERC20(assetBorrow).approve(cTokenBorrow, 0);
      IERC20(assetBorrow).approve(cTokenBorrow, amountToRepay_);
      IDForceCToken(cTokenBorrow).repayBorrow(amountToRepay_);
      console.log("repayBorrow", amountToRepay_);
    }

    // withdraw the collateral
    uint balanceCollateralAsset = _getBalance(assetCollateral);
    IDForceCToken(cTokenCollateral).redeem(address(this), collateralTokensToWithdraw);
    console.log("balanceCollateralAsset", balanceCollateralAsset);
    console.log("collateralTokensToWithdraw", collateralTokensToWithdraw);

    // transfer collateral back to the user
    uint amountToReturn = _getBalance(assetCollateral) - balanceCollateralAsset;
    if (_isMatic(assetCollateral)) {
      IWmatic(WMATIC).deposit{value : amountToReturn}();
    }
    IERC20(assetCollateral).safeTransfer(receiver_, amountToReturn);
    console.log("amountToReturn", amountToReturn);

    // validate result status
    (uint tokenBalance,
     uint borrowBalance,
     uint collateralBase,
     uint sumBorrowPlusEffects,
    ) = _getStatus(cTokenCollateral, cTokenBorrow);
    console.log("status", tokenBalance, borrowBalance, collateralBase);
    console.log("sumBorrowPlusEffects", sumBorrowPlusEffects);

    if (tokenBalance == 0 && borrowBalance == 0) {
      IDebtMonitor(controller.debtMonitor()).onClosePosition();
      //!TODO: do we need exit the markets?
    } else {
      require(!closePosition_, AppErrors.CLOSE_POSITION_FAILED);
      (, uint healthFactor18) = _getHealthFactor(cTokenCollateral, collateralBase, sumBorrowPlusEffects);
      _validateHealthFactor(healthFactor18);
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

    console.log("_getCollateralTokensToRedeem", tokenBalance, amountToRepay_, borrowBalance);
    return tokenBalance * amountToRepay_ / borrowBalance;
  }

  ///////////////////////////////////////////////////////
  ///                 Rewards
  ///////////////////////////////////////////////////////
  function hasRewards() external view override returns (bool) {
    IDForceRewardDistributor rd = IDForceRewardDistributor(_comptroller.rewardDistributor());
    return rd.reward(address(this)) != 0;
  }

  function claimRewards(address receiver_) external override {
    IDForceRewardDistributor rd = IDForceRewardDistributor(_comptroller.rewardDistributor());
    uint amountRewards = rd.reward(address(this));
    if (amountRewards != 0) {
      address[] memory holders = new address[](1);
      holders[0] = address(this);
      rd.claimAllReward(holders);

      uint balance = IERC20(rd.rewardToken()).balanceOf(address(this));

      console.log("claimRewards", amountRewards, balance);
      if (amountRewards != 0) {
        IERC20(rd.rewardToken()).safeTransfer(receiver_, balance);
      }
    }
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
    uint amountsToPay,
    uint healthFactor18,
    bool opened
  ) {
    address cTokenBorrow = borrowCToken;
    address cTokenCollateral = collateralCToken;

    ( uint collateralTokens,
      uint borrowBalance,
      uint collateralBase36,
      uint borrowBase36,
      uint priceCollateral
    ) = _getStatus(cTokenCollateral, cTokenBorrow);

    (, healthFactor18) = _getHealthFactor(
      cTokenCollateral,
      collateralBase36,
      borrowBase36
    );

    console.log("getStatus");
    console.log("collateralTokens", collateralTokens);
    console.log("borrowBalance", borrowBalance);
    console.log("collateralBase36", collateralBase36);
    console.log("borrowBase36", borrowBase36);

    return (
    // Total amount of provided collateral in [collateral asset]
      collateralBase36 / priceCollateral,
    // Total amount of borrowed debt in [borrow asset]. 0 - for closed borrow positions.
      borrowBalance,
    // Current health factor, decimals 18
      healthFactor18,
      collateralTokens != 0 || borrowBalance != 0
    );
  }

  /// @return tokenBalance Count of collateral tokens on balance
  /// @return borrowBalance Borrow amount [borrow asset units]
  /// @return collateralAmountBase36 Total collateral in base currency, decimals 36
  /// @return sumBorrowBase36 Total borrow amount in base currency, decimals 36
  function _getStatus(address cTokenCollateral_, address cTokenBorrow_) internal view returns (
    uint tokenBalance,
    uint borrowBalance,
    uint collateralAmountBase36,
    uint sumBorrowBase36,
    uint outPriceCollateral
  ) {
    // Calculate value of all collaterals, see ControllerV2.calcAccountEquityWithEffect
    // collateralValuePerToken = underlyingPrice * exchangeRate * collateralFactor
    // collateralValue = balance * collateralValuePerToken
    // sumCollateral += collateralValue
    tokenBalance = IERC20(cTokenCollateral_).balanceOf(address(this));
    uint exchangeRateMantissa = IDForceCToken(cTokenCollateral_).exchangeRateStored();

    (uint underlyingPrice, bool isPriceValid) = _priceOracle.getUnderlyingPriceAndStatus(address(cTokenCollateral_));
    require(underlyingPrice != 0 && isPriceValid, AppErrors.ZERO_PRICE);

    collateralAmountBase36 = tokenBalance * underlyingPrice * exchangeRateMantissa / 10**18;

    // Calculate all borrowed value, see ControllerV2.calcAccountEquityWithEffect
    // borrowValue = underlyingPrice * underlyingBorrowed / borrowFactor
    // sumBorrowed += borrowValue
    borrowBalance = IDForceCToken(cTokenBorrow_).borrowBalanceStored(address(this));

    (underlyingPrice, isPriceValid) = _priceOracle.getUnderlyingPriceAndStatus(address(cTokenBorrow_));
    require(underlyingPrice != 0 && isPriceValid, AppErrors.ZERO_PRICE);

    sumBorrowBase36 = borrowBalance * underlyingPrice;

    return (tokenBalance, borrowBalance, collateralAmountBase36, sumBorrowBase36, underlyingPrice);
  }

  function getConversionKind() external pure override returns (AppDataTypes.ConversionKind) {
    return AppDataTypes.ConversionKind.BORROW_2;
  }

  /// @notice Compute current cost of the money
  function getAPR18() external view override returns (int) {
    return int(IDForceCToken(borrowCToken).borrowRatePerBlock() * controller.blocksPerDay() * 365 * 100);
  }


  ///////////////////////////////////////////////////////
  ///                     Utils
  ///////////////////////////////////////////////////////
  function _getHealthFactor(address cTokenCollateral_, uint sumCollateralBase36_, uint sumBorrowBase36_)
  internal view returns (
    uint sumCollateralSafe36,
    uint healthFactor18
  ) {
    (uint collateralFactorMantissa,,,,,,) = _comptroller.markets(cTokenCollateral_);

    sumCollateralSafe36 = collateralFactorMantissa * sumCollateralBase36_ / 10**18;

    healthFactor18 = sumBorrowBase36_ == 0
      ? type(uint).max
      : sumCollateralSafe36 * 10**18 / sumBorrowBase36_;
    return (sumCollateralSafe36, healthFactor18);
  }

  function _validateHealthFactor(uint hf18) internal view {
    require(hf18 > uint(controller.getMinHealthFactor2())*10**(18-2), AppErrors.WRONG_HEALTH_FACTOR);
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