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

/// @notice Implementation of IPoolAdapter for HundredFinance-protocol, see https://docs.hundred.finance/
/// @dev Instances of this contract are created using proxy-minimal pattern, so no constructor
contract HundredFinancePoolAdapter is IPoolAdapter, IPoolAdapterInitializerHF {
  using SafeERC20 for IERC20;

  address public collateralAsset;
  address public borrowAsset;
  address public collateralCToken;
  address public borrowCToken;
  address public user;

  IController public controller;
  IHfComptroller _comptroller;


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
    (address cTokenCollateral, address cTokenBorrow) = IHfCTokenAddressProvider(cTokenAddressProvider_)
      .getCTokenByUnderlying(collateralAsset_, borrowAsset_);
    console.log("HundredFinancePoolAdapter.initialize");
    console.log("collateralAsset_=%s borrowAsset_=%s", collateralAsset_, borrowAsset_);
    console.log("cTokenCollateral=%s cTokenBorrow=%s", cTokenCollateral, cTokenBorrow);

    require(cTokenCollateral != address(0), AppErrors.HF_DERIVATIVE_TOKEN_NOT_FOUND);
    require(cTokenBorrow != address(0), AppErrors.HF_DERIVATIVE_TOKEN_NOT_FOUND);
    collateralCToken = cTokenCollateral;
    borrowCToken = cTokenBorrow;

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

    // supply collateral
    IERC20(assetCollateral).approve(cTokenCollateral, collateralAmount_);
    uint error = IHfCToken(cTokenCollateral).mint(collateralAmount_);
    require(error == 0, AppErrors.CTOKEN_MINT_FAILED);

    // ensure that we received a-tokens
    uint aTokensAmount = IERC20(cTokenCollateral).balanceOf(address(this)) - cTokensBalanceBeforeSupply;
    require(aTokensAmount >= collateralAmount_, AppErrors.WRONG_DERIVATIVE_TOKENS_BALANCE);

    // make borrow
    IHfCToken(cTokenCollateral).borrow(borrowAmount_);

    {
      // ensure that we have received required borrowed amount, send the amount to the receiver
      address assetBorrow = borrowAsset;
      require(borrowAmount_ == IERC20(assetBorrow).balanceOf(address(this)) - reserveBalances[assetBorrow]
      , AppErrors.WRONG_BORROWED_BALANCE);
      IERC20(assetBorrow).safeTransfer(receiver_, borrowAmount_);
    }

    // register the borrow in DebtMonitor
    IDebtMonitor(controller.debtMonitor()).onOpenPosition();

    // TODO: send cTokens anywhere?

    // ensure that health factor is greater than min allowed
    _ensureAccountHealthStatus();
  }

  function _ensureAccountHealthStatus() internal {
    (uint256 error, uint256 liquidity, uint256 shortfall) = _comptroller.getAccountLiquidity(address(this));
    require(error == 0, AppErrors.COMPTROLLER_GET_ACCOUNT_LIQUIDITY_FAILED);
    require(shortfall == 0, AppErrors.COMPTROLLER_GET_ACCOUNT_LIQUIDITY_UNDERWATER);

    address assetCollateral = collateralAsset;
    address assetBorrow = borrowAsset;
    address cTokenBorrow = borrowCToken;
    address cTokenCollateral = collateralCToken;

    IPriceOracle priceOracle = IPriceOracle(controller.priceOracle());
    uint priceCollateral18 = priceOracle.getAssetPrice(assetCollateral);
    uint priceBorrow18 = priceOracle.getAssetPrice(assetBorrow);

    uint256 borrows = IHfCToken(cTokenBorrow).borrowBalanceCurrent(address(this));
    uint256 borrows18 = _toMantissa(borrows, IERC20Extended(cTokenBorrow).decimals(), 18) * priceBorrow18;
    //!TODO: uint256 hf = _toMantissa(borrows, IERC20Extended(cTokenCollateral).decimals(), 18) * priceCollateral18;
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