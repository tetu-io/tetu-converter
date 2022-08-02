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
      , AppErrors.ZERO_ADDRESS
    );

    controller = IController(controller_);
    user = user_;
    collateralAsset = collateralAsset_;
    borrowAsset = borrowAsset_;

    console.log("cTokenAddressProvider_=%s", cTokenAddressProvider_);
    (address cTokenCollateral, address cTokenBorrow, address priceOracle) = IHfCTokenAddressProvider(cTokenAddressProvider_)
      .getCTokenByUnderlying(collateralAsset_, borrowAsset_);
    console.log("HundredFinancePoolAdapter.initialize");
    console.log("collateralAsset_=%s borrowAsset_=%s", collateralAsset_, borrowAsset_);
    console.log("cTokenCollateral=%s cTokenBorrow=%s", cTokenCollateral, cTokenBorrow);

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
  /// @dev Caller should call "sync" before "borrow"
  function borrow(
    uint collateralAmount_,
    uint borrowAmount_,
    address receiver_
  ) external override {
    _onlyTC();
    address cTokenCollateral = collateralCToken;
    address cTokenBorrow = borrowCToken;
    address assetCollateral = collateralAsset;

    // get current balance of cTokens - to know later how much tokens we receive for collateral
    uint cTokensBalanceBeforeSupply = IERC20(cTokenCollateral).balanceOf(address(this));

    // ensure we have received expected collateral amount
    require(collateralAmount_ >= IERC20(assetCollateral).balanceOf(address(this)) - reserveBalances[assetCollateral]
      , AppErrors.WRONG_COLLATERAL_BALANCE);

    // enter markets
    address[] memory markets = new address[](2);
    markets[0] = cTokenCollateral;
    markets[1] = cTokenBorrow;
    _comptroller.enterMarkets(markets);

    console.log("cTokenCollateral balance=%d", IERC20(cTokenCollateral).balanceOf(address(this)));
    console.log("Collateral balance=%d", IERC20(collateralAsset).balanceOf(address(this)));
    console.log("cTokenCollateral decimals=%d", IERC20Extended(cTokenCollateral).decimals());
    console.log("Collateral decimals=%d", IERC20Extended(collateralAsset).decimals());

    // supply collateral
    IERC20(assetCollateral).approve(cTokenCollateral, collateralAmount_);
    uint error = IHfCToken(cTokenCollateral).mint(collateralAmount_);
    require(error == 0, AppErrors.CTOKEN_MINT_FAILED);

    console.log("cTokenCollateral balance=%d", IERC20(cTokenCollateral).balanceOf(address(this)));
    console.log("Collateral balance=%d", IERC20(collateralAsset).balanceOf(address(this)));

    // make borrow
    error = IHfCToken(cTokenBorrow).borrow(borrowAmount_);
    require(error == 0, AppErrors.CTOKEN_BORROW_FAILED);

    {
      // ensure that we have received required borrowed amount, send the amount to the receiver
      address assetBorrow = borrowAsset;
      require(borrowAmount_ == IERC20(assetBorrow).balanceOf(address(this)) - reserveBalances[assetBorrow]
      , AppErrors.WRONG_BORROWED_BALANCE);
      IERC20(assetBorrow).safeTransfer(receiver_, borrowAmount_);
    }

    console.log("debtMonitor=%d", controller.debtMonitor());
    // register the borrow in DebtMonitor
    IDebtMonitor(controller.debtMonitor()).onOpenPosition();
    console.log("borrow.2");

    // TODO: send cTokens anywhere?

    // ensure that health factor is greater than min allowed
    _ensureAccountHealthStatus();
  }

  function _ensureAccountHealthStatus() internal {
    // we need to repeat Comptroller.getHypotheticalAccountLiquidityInternal
    // but for single collateral and single borrow only
    // Collateral factor = CF, exchange rate = ER, price = P
    // Liquidity = sumCollateral - sumBorrowPlusEffects
    // where sumCollateral = tokenToDenom * Collateral::TokenBalance
    //       sumBorrowPlusEffects = Borrow::P * Borrow::BorrowBalance
    //       tokenToDenom = Collateral::CF * Collateral::ER * Collateral::P
    // TokenBalance and BorrowBalance can be received through Token.getAccountSnapshot
    // Liquidity - through Comptroller.getAccountLiquidity
    //
    // Health factor = sumCollateral / sumBorrowPlusEffects
    //               = (Liquidity + sumBorrowPlusEffects) / sumBorrowPlusEffects

    address cTokenBorrow = borrowCToken;
    address cTokenCollateral = collateralCToken;

    uint priceCollateral = _priceOracle.getUnderlyingPrice(cTokenCollateral);
    uint priceBorrow = _priceOracle.getUnderlyingPrice(cTokenBorrow);

    (uint256 cError, uint256 tokenBalance,, uint256 cExchangeRateMantissa) = IHfCToken(cTokenCollateral)
      .getAccountSnapshot(address(this));
    require(cError == 0, AppErrors.CTOKEN_GET_ACCOUNT_SNAPSHOT_FAILED);
    (uint256 bError,, uint borrowBalance,) = IHfCToken(cTokenBorrow)
      .getAccountSnapshot(address(this));
    require(bError == 0, AppErrors.CTOKEN_GET_ACCOUNT_SNAPSHOT_FAILED);

    (,uint ccf,) = _comptroller.markets(cTokenCollateral);

    uint sumCollateral = (ccf * priceCollateral / 10**18 * cExchangeRateMantissa / 10**18) * tokenBalance / 10**18;
    uint sumBorrowPlusEffects = priceBorrow * borrowBalance / 10**18;

    (uint256 dError, uint256 liquidity,) = _comptroller.getAccountLiquidity(address(this));
    require(dError == 0, AppErrors.CTOKEN_GET_ACCOUNT_LIQUIDITY_FAILED);

    console.log("sumCollateral=%d", sumCollateral);
    console.log("sumBorrowPlusEffects=%d", sumBorrowPlusEffects);
    console.log("liquidity=%d", liquidity);
    require(
      sumCollateral > sumBorrowPlusEffects
      && sumBorrowPlusEffects > 0
      && sumCollateral - sumBorrowPlusEffects == liquidity //TODO: probably this additional check is not necessary
      , AppErrors.HF_INCORRECT_RESULT_LIQUIDITY
    );

    uint hf = sumCollateral * 100 / sumBorrowPlusEffects;
    require(hf > controller.MIN_HEALTH_FACTOR2(), AppErrors.WRONG_HEALTH_FACTOR);
  }

  ///////////////////////////////////////////////////////
  ///                 Repay logic
  ///////////////////////////////////////////////////////

  /// @notice Repay borrowed amount, return collateral to the user
  /// @dev Caller should call "sync" before "repay"
  function repay(
    uint amountToRepay_,
    address receiver_,
    bool closePosition
  ) external override {
    // ensure that we have received enough money on our balance just before repay was called
    // TODO dust tokens are possible, what if we need to repay all debts completely? borrowedAmount_ == -1 ?

    // transfer borrow amount back to the pool

    // withdraw the collateral

    // update borrow position status in DebtMonitor
    //TODO IDebtMonitor(controller.debtMonitor()).onRepay(d.aTokenAddress, aTokensAmount, borrowedToken_);

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
    uint healthFactor
  ) {
    return (
      collateralAmount, //TODO: units
      amountsToPay, //TODO: units
      healthFactor //TODO
    );
  }

  function getConversionKind() external pure override returns (AppDataTypes.ConversionKind) {
    return AppDataTypes.ConversionKind.BORROW_2;
  }

  ///////////////////////////////////////////////////////
  ///         Utils
  ///////////////////////////////////////////////////////

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