// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../../../openzeppelin/SafeERC20.sol";
import "../../../openzeppelin/IERC20.sol";
import "../../../interfaces/IPoolAdapter.sol";
import "../../../core/DebtMonitor.sol";
import "../../../core/AppErrors.sol";
import "../../../interfaces/hundred-finance/IPoolAdapterInitializerHF.sol";
import "../../../integrations/hundred-finance/IHfComptroller.sol";
import "../../../interfaces/hundred-finance/IHfCTokenAddressProvider.sol";
import "../../../integrations/hundred-finance/IHfCToken.sol";
import "../../../integrations/hundred-finance/IHfOracle.sol";

/// @notice Implementation of IPoolAdapter for HundredFinance-protocol, see https://docs.hundred.finance/
/// @dev Instances of this contract are created using proxy-minimal pattern, so no constructor
contract HfPoolAdapter is IPoolAdapter, IPoolAdapterInitializerHF {
  using SafeERC20 for IERC20;

  address public collateralAsset;
  address public borrowAsset;
  address public collateralCToken;
  address public borrowCToken;
  address public user;

  IController public controller;
  IHfComptroller private _comptroller;
  /// @notice Implementation of IHfOracle
  IHfOracle private _priceOracle;

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

    (address cTokenCollateral, address cTokenBorrow, address priceOracle) = IHfCTokenAddressProvider(cTokenAddressProvider_)
      .getCTokenByUnderlying(collateralAsset_, borrowAsset_);

    require(cTokenCollateral != address(0), AppErrors.HF_DERIVATIVE_TOKEN_NOT_FOUND);
    require(cTokenBorrow != address(0), AppErrors.HF_DERIVATIVE_TOKEN_NOT_FOUND);
    require(priceOracle != address(0), AppErrors.ZERO_ADDRESS);

    collateralCToken = cTokenCollateral;
    borrowCToken = cTokenBorrow;
    _priceOracle = IHfOracle(priceOracle);

    _comptroller = IHfComptroller(comptroller_);
  }

  ///////////////////////////////////////////////////////
  ///                 Borrow logic
  ///////////////////////////////////////////////////////

  /// @dev TC calls this function before transferring any amounts to balance of this contract
  function syncBalance(bool beforeBorrow_) external override {
    _onlyTC();

    if (beforeBorrow_) {
      reserveBalances[collateralAsset] = IERC20(collateralAsset).balanceOf(address(this));
    }

    reserveBalances[borrowAsset] = IERC20(borrowAsset).balanceOf(address(this));
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
    IERC20 assetBorrow = IERC20(borrowAsset);

    // ensure we have received expected collateral amount
    require(
      collateralAmount_ >= IERC20(assetCollateral).balanceOf(address(this)) - reserveBalances[assetCollateral]
      , AppErrors.WRONG_COLLATERAL_BALANCE
    );

    // enter markets (repeat entering is not a problem)
    address[] memory markets = new address[](2);
    markets[0] = cTokenCollateral;
    markets[1] = cTokenBorrow;
    _comptroller.enterMarkets(markets);

    // supply collateral
    IERC20(assetCollateral).approve(cTokenCollateral, collateralAmount_);
    uint error = IHfCToken(cTokenCollateral).mint(collateralAmount_);
    require(error == 0, AppErrors.MINT_FAILED);

    // make borrow
    error = IHfCToken(cTokenBorrow).borrow(borrowAmount_);
    require(error == 0, AppErrors.BORROW_FAILED);

    // ensure that we have received required borrowed amount, send the amount to the receiver
    require(
      borrowAmount_ == assetBorrow.balanceOf(address(this)) - reserveBalances[address(assetBorrow)]
      , AppErrors.WRONG_BORROWED_BALANCE
    );
    assetBorrow.safeTransfer(receiver_, borrowAmount_);

    // register the borrow in DebtMonitor
    IDebtMonitor(controller.debtMonitor()).onOpenPosition();

    // TODO: send cTokens anywhere?

    // ensure that current health factor is greater than min allowed
    _validateHealthStatusAfterBorrow(cTokenCollateral, cTokenBorrow);
  }

  function _validateHealthStatusAfterBorrow(address cTokenCollateral, address cTokenBorrow) internal view {
    (,, uint collateralBase, uint sumBorrowPlusEffects) = _getStatus(cTokenCollateral, cTokenBorrow);
    (uint sumCollateralSafe, uint healthFactor18) = _getHealthFactor(
      cTokenCollateral,
      collateralBase,
      sumBorrowPlusEffects
    );

    (uint256 dError, uint liquidity,) = _comptroller.getAccountLiquidity(address(this));
    require(dError == 0, AppErrors.CTOKEN_GET_ACCOUNT_LIQUIDITY_FAILED);

    console.log("_validateHealthStatusAfterBorrow");
    console.log("sumCollateralSafe", sumCollateralSafe);
    console.log("sumBorrowPlusEffect", sumBorrowPlusEffects);
    console.log("sumCollateralSafe - sumBorrowPlusEffects", sumCollateralSafe - sumBorrowPlusEffects);
    console.log("liquidity", liquidity);
    console.log("sumCollateralSafe - sumBorrowPlusEffects == liquidity %d, dif=%d"
      , sumCollateralSafe - sumBorrowPlusEffects == liquidity ? 1 : 0
      , liquidity - (sumCollateralSafe - sumBorrowPlusEffects)
    );

    require(
      sumCollateralSafe > sumBorrowPlusEffects
      && sumBorrowPlusEffects > 0
    // here we should have: sumCollateralSafe - sumBorrowPlusEffects == liquidity
    // but it seems like round-error can happen, we can check only sumCollateralSafe - sumBorrowPlusEffects ~ liquidity
    // let's ensure that liquidity has a reasonable value //TODO: remove this check at all?
      && liquidity > (sumCollateralSafe - sumBorrowPlusEffects) / 2
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
    uint error;
    IERC20 assetBorrow = IERC20(borrowAsset);
    IERC20 assetCollateral = IERC20(collateralAsset);
    address cTokenBorrow = borrowCToken;
    address cTokenCollateral = collateralCToken;

    // ensure that we have received enough money on our balance just before repay was called
    require(
      amountToRepay_ == IERC20(assetBorrow).balanceOf(address(this)) - reserveBalances[address(assetBorrow)]
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
    assetBorrow.approve(cTokenBorrow, amountToRepay_); //TODO: do we need approve(0)?
    error = IHfCToken(cTokenBorrow).repayBorrow(amountToRepay_);
    require(error == 0, AppErrors.REPAY_FAILED);

    // withdraw the collateral
    uint balanceCollateralAsset = assetCollateral.balanceOf(address(this));
    error = IHfCToken(cTokenCollateral).redeem(collateralTokensToWithdraw);
    require(error == 0, AppErrors.REDEEM_FAILED);

    // transfer collateral back to the user
    assetCollateral.transfer(receiver_, assetCollateral.balanceOf(address(this)) - balanceCollateralAsset);

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
    (uint error, uint tokenBalance,,) = IHfCToken(cTokenCollateral_).getAccountSnapshot(address(this));
    require(error == 0, AppErrors.CTOKEN_GET_ACCOUNT_SNAPSHOT_FAILED);

    if (closePosition_) {
      return tokenBalance;
    }

    (uint error2,, uint borrowBalance,) = IHfCToken(cTokenBorrow_).getAccountSnapshot(address(this));
    require(error2 == 0, AppErrors.CTOKEN_GET_ACCOUNT_SNAPSHOT_FAILED);
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
    (, uint borrowBalance, uint collateralBase, uint sumBorrowPlusEffects) = _getStatus(cTokenCollateral, cTokenBorrow);
    (, healthFactor18) = _getHealthFactor(
      cTokenCollateral,
      collateralBase,
      sumBorrowPlusEffects
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

  /// @return outTokenBalance Count of collateral tokens on balance
  /// @return outBorrowBalance Borrow amount [borrow asset units]
  /// @return outCollateralAmount Total collateral in base currency
  /// @return sumBorrowPlusEffects Total borrow amount in base currency
  function _getStatus(address cTokenCollateral, address cTokenBorrow) internal view returns (
    uint outTokenBalance,
    uint outBorrowBalance,
    uint outCollateralAmount,
    uint sumBorrowPlusEffects
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
    //  / (10 ** (18 - IERC20Extended(collateralAsset).decimals()));
    uint priceBorrow = _priceOracle.getUnderlyingPrice(cTokenBorrow);
    //  / (10 ** (18 - IERC20Extended(borrowAsset).decimals()));

    (uint256 cError, uint256 tokenBalance,, uint256 cExchangeRateMantissa) = IHfCToken(cTokenCollateral)
      .getAccountSnapshot(address(this));
    require(cError == 0, AppErrors.CTOKEN_GET_ACCOUNT_SNAPSHOT_FAILED);

    (uint256 bError,, uint borrowBalance,) = IHfCToken(cTokenBorrow)
      .getAccountSnapshot(address(this));
    require(bError == 0, AppErrors.CTOKEN_GET_ACCOUNT_SNAPSHOT_FAILED);

    outCollateralAmount = (priceCollateral * cExchangeRateMantissa / 10**18) * tokenBalance / 10**18;
    sumBorrowPlusEffects = priceBorrow * borrowBalance / 10**18;

    return (tokenBalance, borrowBalance, outCollateralAmount, sumBorrowPlusEffects);
  }

  function getConversionKind() external pure override returns (AppDataTypes.ConversionKind) {
    return AppDataTypes.ConversionKind.BORROW_2;
  }

  ///////////////////////////////////////////////////////
  ///         Utils
  ///////////////////////////////////////////////////////
  function _getHealthFactor(address cTokenCollateral, uint sumCollateral, uint sumBorrowPlusEffects)
  internal view returns (
    uint sumCollateralSafe,
    uint healthFactor18
  ) {
    (,uint collateralFactor,) = _comptroller.markets(cTokenCollateral);

    sumCollateralSafe = collateralFactor * sumCollateral / 10**18;
    healthFactor18 = sumBorrowPlusEffects == 0
      ? type(uint).max
      : sumCollateralSafe * 10**18 / sumBorrowPlusEffects;

    console.log("_getHealthFactor", healthFactor18);

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
}