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

/// @notice Implementation of IPoolAdapter for HundredFinance-protocol, see https://docs.hundred.finance/
/// @dev Instances of this contract are created using proxy-minimal pattern, so no constructor
contract HfPoolAdapter is IPoolAdapter, IPoolAdapterInitializerWithAP {
  using SafeERC20 for IERC20;

  address private constant WMATIC = address(0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270);

  address public collateralAsset;
  address public borrowAsset;
  address public collateralCToken;
  address public borrowCToken;
  address public user;

  IController public controller;
  IHfComptroller private _comptroller;
  /// @notice Implementation of IHfPriceOracle
  IHfPriceOracle private _priceOracle;

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
    address originConverter_
  ) override external {
    require(
      controller_ != address(0)
      && comptroller_ != address(0)
      && user_ != address(0)
      && collateralAsset_ != address(0)
      && borrowAsset_ != address(0)
      && cTokenAddressProvider_ != address(0)
      && originConverter_ != address(0)
      , AppErrors.ZERO_ADDRESS
    );

    controller = IController(controller_);
    user = user_;
    collateralAsset = collateralAsset_;
    borrowAsset = borrowAsset_;
    originConverter = originConverter_;

    (address cTokenCollateral,
     address cTokenBorrow,
     address priceOracle
    ) = ITokenAddressProvider(cTokenAddressProvider_).getCTokenByUnderlying(collateralAsset_, borrowAsset_);

    require(cTokenCollateral != address(0), AppErrors.HF_DERIVATIVE_TOKEN_NOT_FOUND);
    require(cTokenBorrow != address(0), AppErrors.HF_DERIVATIVE_TOKEN_NOT_FOUND);
    require(priceOracle != address(0), AppErrors.ZERO_ADDRESS);

    collateralCToken = cTokenCollateral;
    borrowCToken = cTokenBorrow;
    _priceOracle = IHfPriceOracle(priceOracle);

    _comptroller = IHfComptroller(comptroller_);
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
  function syncBalance(bool beforeBorrow_, bool updateStatus_) external override {
    address assetCollateral = collateralAsset;
    reserveBalances[assetCollateral] = _getBalance(assetCollateral);

    if (!beforeBorrow_) {
      address assetBorrow = borrowAsset;
      reserveBalances[assetBorrow] = _getBalance(assetBorrow);
    }

    if (updateStatus_) {
      // Update borrowBalance to actual value
      IHfCToken(borrowCToken).borrowBalanceCurrent(address(this));
    }
  }

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
    _onlyTC();
    uint error;
    IHfComptroller comptroller = _comptroller;

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
    comptroller.enterMarkets(markets);

    // supply collateral
    _supply(cTokenCollateral, assetCollateral, collateralAmount_);

    // make borrow
    uint balanceBorrowAsset0 = _getBalance(assetBorrow);
    error = IHfCToken(cTokenBorrow).borrow(borrowAmount_);
    require(error == 0, AppErrors.BORROW_FAILED);

    // ensure that we have received required borrowed amount, send the amount to the receiver
    if (_isMatic(assetBorrow)) {
      IWmatic(WMATIC).deposit{value : borrowAmount_}();
    }
    require(
      borrowAmount_ == IERC20(assetBorrow).balanceOf(address(this)) - balanceBorrowAsset0
      , AppErrors.WRONG_BORROWED_BALANCE
    );
    IERC20(assetBorrow).safeTransfer(receiver_, borrowAmount_);

    // register the borrow in DebtMonitor
    IDebtMonitor(controller.debtMonitor()).onOpenPosition();

    // ensure that current health factor is greater than min allowed
    _validateHealthStatusAfterBorrow(comptroller, cTokenCollateral, cTokenBorrow);

    return borrowAmount_;
  }

  /// @notice Supply collateral to Hundred finance market
  function _supply(
    address cTokenCollateral_,
    address assetCollateral_,
    uint collateralAmount_
  ) internal {
    if (_isMatic(assetCollateral_)) {
      require(IERC20(WMATIC).balanceOf(address(this)) >= collateralAmount_, AppErrors.MINT_FAILED);
      IWmatic(WMATIC).withdraw(collateralAmount_);
      IHfHMatic(payable(cTokenCollateral_)).mint{value : collateralAmount_}();
    } else {
      IERC20(assetCollateral_).approve(cTokenCollateral_, 0);
      IERC20(assetCollateral_).approve(cTokenCollateral_, collateralAmount_);
      uint error = IHfCToken(cTokenCollateral_).mint(collateralAmount_);
      require(error == 0, AppErrors.MINT_FAILED);
    }
  }

  /// @return Result health factor, decimals 18
  function _validateHealthStatusAfterBorrow(
    IHfComptroller comptroller_,
    address cTokenCollateral_,
    address cTokenBorrow_
  ) internal view returns (uint) {
    (,, uint collateralBase, uint borrowBase, ) = _getStatus(cTokenCollateral_, cTokenBorrow_);
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
      && liquidity > (sumCollateralSafe - borrowBase) / 2
      , AppErrors.INCORRECT_RESULT_LIQUIDITY
    );

    _validateHealthFactor(healthFactor18);
    return healthFactor18;
  }

  function borrowToRebalance(
    uint borrowAmount_,
    address receiver_
  ) external override returns (
    uint resultHealthFactor18,
    uint borrowedAmountOut
  ) {
    _onlyTC();
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
      borrowAmount_ == IERC20(assetBorrow).balanceOf(address(this)) - balanceBorrowAsset0
    , AppErrors.WRONG_BORROWED_BALANCE
    );
    IERC20(assetBorrow).safeTransfer(receiver_, borrowAmount_);

    // ensure that current health factor is greater than min allowed
    resultHealthFactor18 = _validateHealthStatusAfterBorrow(comptroller, collateralCToken, cTokenBorrow);

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
    bool closePosition
  ) external override returns (uint) {
    _onlyUserOrTC();

    uint error;
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
    if (_isMatic(assetBorrow)) {
      require(IERC20(WMATIC).balanceOf(address(this)) >= amountToRepay_, AppErrors.MINT_FAILED);
      IWmatic(WMATIC).withdraw(amountToRepay_);
      IHfHMatic(payable(cTokenBorrow)).repayBorrow{value : amountToRepay_}();
    } else {
      IERC20(assetBorrow).approve(cTokenBorrow, 0);
      IERC20(assetBorrow).approve(cTokenBorrow, amountToRepay_);
      error = IHfCToken(cTokenBorrow).repayBorrow(amountToRepay_);
      require(error == 0, AppErrors.REPAY_FAILED);
    }

    // withdraw the collateral
    uint balanceCollateralAsset = _getBalance(assetCollateral);
    error = IHfCToken(cTokenCollateral).redeem(collateralTokensToWithdraw);
    require(error == 0, AppErrors.REDEEM_FAILED);

    // transfer collateral back to the user
    uint collateralAmountToReturn = _getBalance(assetCollateral) - balanceCollateralAsset;
    if (_isMatic(assetCollateral)) {
      IWmatic(WMATIC).deposit{value : collateralAmountToReturn}();
    }
    IERC20(assetCollateral).safeTransfer(receiver_, collateralAmountToReturn);

    // validate result status
    (uint tokenBalance,
     uint borrowBalance,
     uint collateralBase,
     uint borrowBase,
    ) = _getStatus(cTokenCollateral, cTokenBorrow);

    if (tokenBalance == 0 && borrowBalance == 0) {
      IDebtMonitor(controller.debtMonitor()).onClosePosition();
      //!TODO: do we need to exit the markets?
    } else {
      require(!closePosition, AppErrors.CLOSE_POSITION_FAILED);
      (, uint healthFactor18) = _getHealthFactor(cTokenCollateral, collateralBase, borrowBase);
      _validateHealthFactor(healthFactor18);
    }

    return collateralAmountToReturn;
  }

  function _getCollateralTokensToRedeem(
    address cTokenCollateral_,
    address cTokenBorrow_,
    bool closePosition_,
    uint amountToRepay_
  ) internal view returns (uint) {
    (uint error, uint tokenBalance,,) = IHfCToken(cTokenCollateral_).getAccountSnapshot(address(this));
    require(error == 0, AppErrors.CTOKEN_GET_ACCOUNT_SNAPSHOT_FAILED);

    (uint error2,, uint borrowBalance,) = IHfCToken(cTokenBorrow_).getAccountSnapshot(address(this));
    require(error2 == 0, AppErrors.CTOKEN_GET_ACCOUNT_SNAPSHOT_FAILED);
    require(borrowBalance != 0, AppErrors.ZERO_BALANCE);
    if (closePosition_) {
      require(borrowBalance <= amountToRepay_, AppErrors.CLOSE_POSITION_FAILED);
      return tokenBalance;
    } else {
      require(amountToRepay_ <= borrowBalance, AppErrors.WRONG_BORROWED_BALANCE);
    }
    return tokenBalance * amountToRepay_ / borrowBalance;
  }

  function repayToRebalance(
    uint amount_,
    bool isCollateral_
  ) external override returns (
    uint resultHealthFactor18
  ) {
    _onlyUserOrTC();

    uint error;
    address cTokenBorrow = borrowCToken;
    address cTokenCollateral = collateralCToken;

    // ensure that the position is opened
    require(IDebtMonitor(controller.debtMonitor()).isPositionOpened(), AppErrors.BORROW_POSITION_IS_NOT_REGISTERED);

    if (isCollateral_) {
      address assetCollateral = collateralAsset;
      // ensure that we have received expected amount on our balance just before repay was called
      // the correct sequence of calls are following: syncBalance(false); transfer amount-to-repay; repay()
      require(
        amount_ == IERC20(assetCollateral).balanceOf(address(this)) - reserveBalances[assetCollateral],
        AppErrors.WRONG_BORROWED_BALANCE
      );

      _supply(cTokenCollateral, assetCollateral, amount_);
    } else {
      address assetBorrow = borrowAsset;
      // ensure, that amount to repay is less then the total debt
      (, uint outBorrowBalance,,,) = _getStatus(cTokenCollateral, cTokenBorrow);
      require(outBorrowBalance > 0 && amount_ < outBorrowBalance, AppErrors.REPAY_TO_REBALANCE_NOT_ALLOWED);

      // ensure that we have received enough money on our balance just before repay was called
      require(
        amount_ == IERC20(assetBorrow).balanceOf(address(this)) - reserveBalances[assetBorrow]
      , AppErrors.WRONG_BORROWED_BALANCE
      );

      // transfer borrow amount back to the pool
      if (_isMatic(assetBorrow)) {
        require(IERC20(WMATIC).balanceOf(address(this)) >= amount_, AppErrors.MINT_FAILED);
        IWmatic(WMATIC).withdraw(amount_);
        IHfHMatic(payable(cTokenBorrow)).repayBorrow{value : amount_}();
      } else {
        IERC20(assetBorrow).approve(cTokenBorrow, 0);
        IERC20(assetBorrow).approve(cTokenBorrow, amount_);
        error = IHfCToken(cTokenBorrow).repayBorrow(amount_);
        require(error == 0, AppErrors.REPAY_FAILED);
      }
    }

    // validate result status
    (,, uint collateralBase, uint borrowBase,) = _getStatus(cTokenCollateral, cTokenBorrow);
    (, uint healthFactor18) = _getHealthFactor(cTokenCollateral, collateralBase, borrowBase);

    _validateHealthFactor(healthFactor18);

    return healthFactor18;
  }

  ///////////////////////////////////////////////////////
  ///                 Rewards
  ///////////////////////////////////////////////////////
  function hasRewards() external pure override returns (bool) {
    return false; // Currently we don't support rewards on HF (if any)
  }

  function claimRewards(address receiver_) external pure override returns (
    address rewardToken,
    uint amount
  ) {
    receiver_;
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
    bool opened
  ) {
    address cTokenBorrow = borrowCToken;
    address cTokenCollateral = collateralCToken;
    ( uint collateralTokens,
      uint borrowBalance,
      uint collateralBase,
      uint borrowBase,
    ) = _getStatus(cTokenCollateral, cTokenBorrow);

    (, healthFactor18) = _getHealthFactor(
      cTokenCollateral,
      collateralBase,
      borrowBase
    );
    return (
    // Total amount of provided collateral [collateral asset]
      collateralBase * 10 ** IERC20Extended(collateralAsset).decimals() / 10**18,
    // Total amount of borrowed debt in [borrow asset]. 0 - for closed borrow positions.
      borrowBalance,
    // Current health factor, decimals 18
      healthFactor18,
      collateralTokens != 0 || borrowBalance != 0
    );
  }

  /// @return outTokenBalance Count of collateral tokens on balance
  /// @return outBorrowBalance Borrow amount [borrow asset units]
  /// @return outCollateralBase Total collateral in base currency
  /// @return outBorrowBase Total borrow amount in base currency
  function _getStatus(address cTokenCollateral, address cTokenBorrow) internal view returns (
    uint outTokenBalance,
    uint outBorrowBalance,
    uint outCollateralBase,
    uint outBorrowBase,
    uint outPriceCollateral
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

    uint priceCollateral = _priceOracle.getUnderlyingPrice(cTokenCollateral);
    uint priceBorrow = _priceOracle.getUnderlyingPrice(cTokenBorrow);

    (uint256 cError, uint256 tokenBalance,, uint256 cExchangeRateMantissa) = IHfCToken(cTokenCollateral)
      .getAccountSnapshot(address(this));
    require(cError == 0, AppErrors.CTOKEN_GET_ACCOUNT_SNAPSHOT_FAILED);

    (uint256 bError,, uint borrowBalance,) = IHfCToken(cTokenBorrow)
      .getAccountSnapshot(address(this));
    require(bError == 0, AppErrors.CTOKEN_GET_ACCOUNT_SNAPSHOT_FAILED);

    outCollateralBase = (priceCollateral * cExchangeRateMantissa / 10**18) * tokenBalance / 10**18;
    outBorrowBase = priceBorrow * borrowBalance / 10**18;

    return (tokenBalance, borrowBalance, outCollateralBase, outBorrowBase, priceCollateral);
  }

  function getConversionKind() external pure override returns (AppDataTypes.ConversionKind) {
    return AppDataTypes.ConversionKind.BORROW_2;
  }

  /// @notice Compute current cost of the money
  function getAPR18() external view override returns (int) {
    return int(IHfCToken(borrowCToken).borrowRatePerBlock() * controller.blocksPerDay() * 365 * 100);
  }


  ///////////////////////////////////////////////////////
  ///                   Utils
  ///////////////////////////////////////////////////////
  function _getHealthFactor(address cTokenCollateral_, uint sumCollateral_, uint sumBorrowPlusEffects_)
  internal view returns (
    uint sumCollateralSafe,
    uint healthFactor18
  ) {
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