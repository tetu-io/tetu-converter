// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../../../openzeppelin/SafeERC20.sol";
import "../../../openzeppelin/IERC20.sol";
import "../../../interfaces/IPoolAdapter.sol";
import "../../../core/DebtMonitor.sol";
import "../../../core/AppErrors.sol";
import "../../../integrations/aave/IAavePool.sol";
import "../../../integrations/aave/IAavePriceOracle.sol";
import "../../../integrations/aave/IAaveAddressesProvider.sol";
import "../../../interfaces/IPoolAdapterInitializer.sol";
import "../../../integrations/aave/ReserveConfiguration.sol";

/// @notice Implementation of IPoolAdapter for AAVE-protocol, see https://docs.aave.com/hub/
/// @dev Instances of this contract are created using proxy-minimal pattern, so no constructor
abstract contract Aave3PoolAdapterBase is IPoolAdapter, IPoolAdapterInitializer {
  using SafeERC20 for IERC20;
  using ReserveConfiguration for DataTypes.ReserveConfigurationMap;

  /// @notice 1 - stable, 2 - variable
  uint immutable public RATE_MODE = 2;

  address public collateralAsset;
  address public borrowAsset;
  address public user;

  IController public controller;
  IAavePool internal _pool;
  IAavePriceOracle internal _priceOracle;

  /// @notice Last synced amount of given token on the balance of this contract
  mapping(address => uint) public reserveBalances;

  ///////////////////////////////////////////////////////
  ///                Initialization
  ///////////////////////////////////////////////////////

  function initialize(
    address controller_,
    address pool_,
    address user_,
    address collateralAsset_,
    address borrowAsset_
  ) override external {
    require(
      controller_ != address(0)
      && user_ != address(0)
      && collateralAsset_ != address(0)
      && borrowAsset_ != address(0)
    , AppErrors.ZERO_ADDRESS);

    controller = IController(controller_);
    user = user_;
    collateralAsset = collateralAsset_;
    borrowAsset = borrowAsset_;

    _pool = IAavePool(pool_);
    _priceOracle = IAavePriceOracle(IAaveAddressesProvider(_pool.ADDRESSES_PROVIDER()).getPriceOracle());
  }

  function getConversionKind() external pure override returns (AppDataTypes.ConversionKind) {
    return AppDataTypes.ConversionKind.BORROW_2;
  }

  ///////////////////////////////////////////////////////
  ///        Sync balances before borrow/repay
  ///////////////////////////////////////////////////////

  /// @dev TC calls this function before transferring any amounts to balance of this contract
  function syncBalance(bool beforeBorrow_) external override {
    _onlyTC();

    if (beforeBorrow_) {
      reserveBalances[collateralAsset] = IERC20(collateralAsset).balanceOf(address(this));
    }

    reserveBalances[borrowAsset] = IERC20(borrowAsset).balanceOf(address(this));
  }

  ///////////////////////////////////////////////////////
  ///             Adapter customization
  ///////////////////////////////////////////////////////

  /// @notice Enter to E-mode if necessary
  function prepareToBorrow() internal virtual;


  ///////////////////////////////////////////////////////
  ///                 Borrow logic
  ///////////////////////////////////////////////////////

  /// @notice Supply collateral to the pool and borrow {borrowedAmount_}
  /// @dev Caller should call "syncBalance" before transferring borrow amount and call "borrow"
  function borrow(
    uint collateralAmount_,
    uint borrowAmount_,
    address receiver_
  ) external override {
    _onlyTC();
    console.log("Aave3 borrow: collateral=%d borrow=%d receiver=%s", collateralAmount_, borrowAmount_, receiver_);
    console.log("Aave3 borrow: this=%s", address(this));

    address assetCollateral = collateralAsset;
    address assetBorrow = borrowAsset;

    //a-tokens
    DataTypes.ReserveData memory d = _pool.getReserveData(assetCollateral);
    uint aTokensBalanceBeforeSupply = IERC20(d.aTokenAddress).balanceOf(address(this));

    // ensure we have received expected collateral amount
    require(
      collateralAmount_ >= IERC20(assetCollateral).balanceOf(address(this)) - reserveBalances[assetCollateral]
      , AppErrors.WRONG_COLLATERAL_BALANCE
    );

    // Supplies an `amount` of underlying asset into the reserve, receiving in return overlying aTokens.
    // E.g. User supplies 100 USDC and gets in return 100 aUSDC
    IERC20(assetCollateral).approve(address(_pool), collateralAmount_);
    _pool.supply(
      assetCollateral,
      collateralAmount_,
      address(this),
      0 // no referral code
    );
    _pool.setUserUseReserveAsCollateral(assetCollateral, true);

    // ensure that we received a-tokens
    uint aTokensAmount = IERC20(d.aTokenAddress).balanceOf(address(this)) - aTokensBalanceBeforeSupply;
    require(aTokensAmount >= collateralAmount_, AppErrors.WRONG_DERIVATIVE_TOKENS_BALANCE);

    // enter to E-mode if necessary
    prepareToBorrow();

    console.log("Balance before=%d", IERC20(assetBorrow).balanceOf(address(this)));
    // make borrow, send borrowed amount to the receiver
    // we cannot transfer borrowed amount directly to receiver because the debt is incurred by amount receiver
    _pool.borrow(
      assetBorrow,
      borrowAmount_,
      RATE_MODE,
      0, // no referral code
      address(this)
    );

    console.log("Balance after=%d", IERC20(assetBorrow).balanceOf(address(this)));
    // ensure that we have received required borrowed amount, send the amount to the receiver
    require(
      borrowAmount_ == IERC20(assetBorrow).balanceOf(address(this)) - reserveBalances[assetBorrow]
      , AppErrors.WRONG_BORROWED_BALANCE
    );
    console.log("Transfer borrow amount to user: %d", borrowAmount_);
    console.log("user balance before %d", IERC20(assetBorrow).balanceOf(receiver_));
    IERC20(assetBorrow).safeTransfer(receiver_, borrowAmount_);
    console.log("user balance after %d", IERC20(assetBorrow).balanceOf(receiver_));

    // register the borrow in DebtMonitor
    IDebtMonitor(controller.debtMonitor()).onOpenPosition();

    // TODO: send aTokens anywhere?

    // ensure that current health factor is greater than min allowed
    (,,,,, uint256 healthFactor) = _pool.getUserAccountData(address(this));
    require(healthFactor > uint(controller.MIN_HEALTH_FACTOR2())*10**(18-2), AppErrors.WRONG_HEALTH_FACTOR);

    print();
  }

  //TODO: remove
  function print() internal view {
      (uint256 totalCollateralBase,
      uint256 totalDebtBase,
      uint256 availableBorrowsBase,
      uint256 currentLiquidationThreshold,
      uint256 ltv,
      uint256 healthFactor
      ) = _pool.getUserAccountData(address(this));

    console.log("Print user account data: totalCollateralBase=%d totalDebtBase=%d", totalCollateralBase, totalDebtBase);
    console.log("Print user account data: availableBorrowsBase=%d currentLiquidationThreshold=%d", availableBorrowsBase, currentLiquidationThreshold);
    console.log("Print user account data: ltv=%d healthFactor=%d", ltv, healthFactor);
    console.log("Print user account data: this=%s", address(this));
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
    console.log("repay amountToRepay_=%d receiver_=%s closePosition=%d", amountToRepay_, receiver_, closePosition ? 1 : 0);
    address assetBorrow = borrowAsset;

    // ensure that we have received enough money on our balance just before repay was called
    require(
      amountToRepay_ == IERC20(assetBorrow).balanceOf(address(this)) - reserveBalances[assetBorrow]
      , AppErrors.WRONG_BORROWED_BALANCE
    );

    // how much collateral we are going to return
    uint amountCollateralToWithdraw = closePosition
      ? type(uint).max
      : _getCollateralAmountToReturn(amountToRepay_);

    // transfer borrow amount back to the pool
    //TODO amount to be repaid, expressed in wei units.
    IERC20(assetBorrow).approve(address(_pool), amountToRepay_); //TODO: do we need approve(0)?
    _pool.repay(assetBorrow
      , amountToRepay_
      , RATE_MODE
      , address(this)
    );

    // withdraw the collateral
    _pool.withdraw(collateralAsset, amountCollateralToWithdraw, receiver_);

    // validate result status
    (uint totalCollateralBase, uint totalDebtBase,,,, uint256 healthFactor) = _pool.getUserAccountData(address(this));
    if (totalCollateralBase == 0 && totalDebtBase == 0) {
      // update borrow position status in DebtMonitor
      IDebtMonitor(controller.debtMonitor()).onClosePosition();
    } else {
      require(!closePosition, AppErrors.CLOSE_POSITION_FAILED);
      require(healthFactor > uint(controller.MIN_HEALTH_FACTOR2())*10**(18-2), AppErrors.WRONG_HEALTH_FACTOR);
    }
  }

  /// @param amountToRepay_ Amount to be repaid [in borrowed tokens]
  /// @return Amount of collateral [in collateral tokens] to be returned in exchange of {borrowedAmount_}
  function _getCollateralAmountToReturn(uint amountToRepay_) internal view returns (uint) {
    // get total amount of the borrow position
    (uint256 totalCollateralBase, uint256 totalDebtBase,,,,) = _pool.getUserAccountData(address(this));
    require(totalDebtBase != 0, AppErrors.ZERO_BALANCE);

    // how much collateral we have provided?

    // the asset price in the base currency
    address[] memory assets = new address[](2);
    assets[0] = collateralAsset;
    assets[1] = borrowAsset;

    uint[] memory prices = _priceOracle.getAssetsPrices(assets);
    require(prices[0] != 0, AppErrors.ZERO_PRICE);

    uint amountToRepayBase = amountToRepay_ * prices[1] / (10 ** IERC20Extended(borrowAsset).decimals());
    uint part = amountToRepayBase >= totalDebtBase
      ? 10**18 //TODO we need to return the amount in wei units
      : 10**18 * amountToRepayBase / totalDebtBase;

    console.log("totalCollateralBase: %d", totalCollateralBase);
    console.log("_getCollateralAmountToReturn: %d", totalCollateralBase * (10 ** IERC20Extended(collateralAsset).decimals()));
    console.log("prices: %d %d", prices[0], prices[1]);
    console.log("amountToRepayBase: %d", amountToRepayBase );
    console.log("totalDebtBase: %d", totalDebtBase);
    return // == totalCollateral * amountToRepay / totalDebt
      totalCollateralBase * (10 ** IERC20Extended(collateralAsset).decimals())
      * part / 10**18
      / prices[0];
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
    return (address(_pool), user, collateralAsset, borrowAsset);
  }

  function getStatus() external view override returns (
    uint collateralAmount,
    uint amountsToPay,
    uint healthFactor18
  ) {
    (uint256 totalCollateralBase,
     uint256 totalDebtBase,
     ,,,
     uint256 hf
    ) = _pool.getUserAccountData(address(this));

    uint priceBorrow = _priceOracle.getAssetPrice(borrowAsset);
    require(priceBorrow != 0, AppErrors.ZERO_PRICE);

    console.log("getStatus totalCollateralBase=%d totalDebtBase=%d priceBorrow=%d", totalCollateralBase, totalDebtBase, priceBorrow);
    console.log("pool adapter=%s", address(this));
    return (
    // Total amount of provided collateral in Pool adapter's base currency
      totalCollateralBase,
    // Total amount of borrowed debt in [borrow asset]. 0 - for closed borrow positions.
      totalDebtBase * (10 ** _pool.getConfiguration(borrowAsset).getDecimals()) / priceBorrow,
    // Current health factor, decimals 18
      hf
    );
  }

  ///////////////////////////////////////////////////////
  ///                    Utils
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