// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../core/DebtMonitor.sol";
import "../../core/AppErrors.sol";
import "../../interfaces/IPoolAdapter.sol";
import "../../interfaces/IPoolAdapterInitializer.sol";
import "../../integrations/aave3/IAavePool.sol";
import "../../integrations/aave3/IAavePriceOracle.sol";
import "../../integrations/aave3/IAaveAddressesProvider.sol";
import "../../integrations/aave3/Aave3ReserveConfiguration.sol";
import "../../integrations/aave3/IAaveToken.sol";
import "../../integrations/dforce/SafeRatioMath.sol";
import "../../openzeppelin/Initializable.sol";
import "hardhat/console.sol";

/// @notice Implementation of IPoolAdapter for AAVE-v3-protocol, see https://docs.aave.com/hub/
/// @dev Instances of this contract are created using proxy-minimal pattern, so no constructor
abstract contract Aave3PoolAdapterBase is IPoolAdapter, IPoolAdapterInitializer, Initializable {
  using SafeERC20 for IERC20;
  using Aave3ReserveConfiguration for Aave3DataTypes.ReserveConfigurationMap;
  using SafeRatioMath for uint;

  /// @notice We allow to receive less atokens then provided collateral on following value
  /// @dev Sometime, we provide collateral=1000000000000000000000 and receive atokens=999999999999999999999
  uint constant public ATOKEN_MAX_DELTA = 10;

  /// @notice 1 - stable, 2 - variable
  uint constant public RATE_MODE = 2;
  uint constant public SECONDS_PER_YEAR = 31536000;

  address public collateralAsset;
  address public borrowAsset;
  address public user;

  IController public controller;
  IAavePool internal _pool;
  IAavePriceOracle internal _priceOracle;
  /// @notice Address of original PoolAdapter contract that was cloned to make the instance of the pool adapter
  address originConverter;

  /// @notice Total amount of all supplied and withdrawn amounts of collateral in ATokens
  uint public collateralBalanceATokens;

  ///////////////////////////////////////////////////////
  ///                Events
  ///////////////////////////////////////////////////////
  event OnInitialized(address controller, address pool, address user, address collateralAsset, address borrowAsset, address originConverter);
  event OnBorrow(uint collateralAmount, uint borrowAmount, address receiver, uint resultHealthFactor18,
    uint collateralBalanceATokens);
  event OnBorrowToRebalance(uint borrowAmount, address receiver, uint resultHealthFactor18);
  event OnRepay(uint amountToRepay, address receiver, bool closePosition, uint resultHealthFactor18,
    uint collateralBalanceATokens);
  event OnRepayToRebalance(uint amount, bool isCollateral, uint resultHealthFactor18, uint collateralBalanceATokens);

  ///////////////////////////////////////////////////////
  ///                Initialization
  ///////////////////////////////////////////////////////

  function initialize(
    address controller_,
    address pool_,
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
      && pool_ != address(0)
      && user_ != address(0)
      && collateralAsset_ != address(0)
      && borrowAsset_ != address(0)
      && originConverter_ != address(0),
      AppErrors.ZERO_ADDRESS
    );

    controller = IController(controller_);
    user = user_;
    collateralAsset = collateralAsset_;
    borrowAsset = borrowAsset_;
    originConverter = originConverter_;

    _pool = IAavePool(pool_);
    _priceOracle = IAavePriceOracle(IAaveAddressesProvider(IAavePool(pool_).ADDRESSES_PROVIDER()).getPriceOracle());

    // The pool adapter doesn't keep assets on its balance, so it's safe to use infinity approve
    // All approves replaced by infinity-approve were commented in the code below
    IERC20(collateralAsset_).safeApprove(pool_, type(uint).max);
    IERC20(borrowAsset_).safeApprove(pool_, type(uint).max);

    console.log("OnInitialized event", address(this));
    emit OnInitialized(controller_, pool_, user_, collateralAsset_, borrowAsset_, originConverter_);
  }

  ///////////////////////////////////////////////////////
  ///               Restrictions
  ///////////////////////////////////////////////////////

  /// @notice Ensure that the caller is TetuConverter
  function _onlyTetuConverter() internal view {
    require(controller.tetuConverter() == msg.sender, AppErrors.TETU_CONVERTER_ONLY);
  }

  function updateStatus() external override {
    // nothing to do; getStatus always return actual amounts in AAVE
  }

  ///////////////////////////////////////////////////////
  ///             Adapter customization
  ///////////////////////////////////////////////////////

  /// @notice Enter to E-mode if necessary
  function prepareToBorrow() internal virtual;


  ///////////////////////////////////////////////////////
  ///                 Borrow logic
  ///////////////////////////////////////////////////////

  /// @notice Supply collateral to the pool and borrow {borrowedAmount_}, no rebalancing here
  /// @dev Caller should call "syncBalance" before transferring collateral amount and call "borrow"
  function borrow(
    uint collateralAmount_,
    uint borrowAmount_,
    address receiver_
  ) external override returns (uint) {
    _onlyTetuConverter();
    IAavePool pool = _pool;
    address assetBorrow = borrowAsset;

    uint newCollateralBalanceATokens = _supply(pool, collateralAsset, collateralAmount_) + collateralBalanceATokens;
    collateralBalanceATokens = newCollateralBalanceATokens;
    console.log("0");
    // enter to E-mode if necessary
    prepareToBorrow();

    // make borrow, send borrowed amount to the receiver
    // we cannot transfer borrowed amount directly to receiver because the debt is incurred by amount receiver
    uint balanceBorrowAsset0 = IERC20(assetBorrow).balanceOf(address(this));

    pool.borrow(
      assetBorrow,
      borrowAmount_,
      RATE_MODE,
      0, // no referral code
      address(this)
    );

    // ensure that we have received required borrowed amount, send the amount to the receiver
    require(
      borrowAmount_ + balanceBorrowAsset0 == IERC20(assetBorrow).balanceOf(address(this)),
      AppErrors.WRONG_BORROWED_BALANCE
    );
    IERC20(assetBorrow).safeTransfer(receiver_, borrowAmount_);

    // register the borrow in DebtMonitor
    IDebtMonitor(controller.debtMonitor()).onOpenPosition();

    // ensure that current health factor is greater than min allowed
    (,,,,, uint256 healthFactor) = pool.getUserAccountData(address(this));
    _validateHealthFactor(healthFactor);

    emit OnBorrow(collateralAmount_, borrowAmount_, receiver_, healthFactor, newCollateralBalanceATokens);
    return borrowAmount_;
  }

  /// @notice Supply collateral to AAVE-pool
  /// @return Amount of received A-tokens
  function _supply(
    IAavePool pool_,
    address assetCollateral_,
    uint collateralAmount_
  ) internal returns (uint) {
    //a-tokens
    Aave3DataTypes.ReserveData memory d = pool_.getReserveData(assetCollateral_);
    uint aTokensBalanceBeforeSupply = IERC20(d.aTokenAddress).balanceOf(address(this));

    IERC20(assetCollateral_).safeTransferFrom(msg.sender, address(this), collateralAmount_);

    // Supplies an `amount` of underlying asset into the reserve, receiving in return overlying aTokens.
    // E.g. User supplies 100 USDC and gets in return 100 aUSDC

    // replaced by infinity approve: IERC20(assetCollateral_).safeApprove(address(pool_), collateralAmount_);
    pool_.supply(
      assetCollateral_,
      collateralAmount_,
      address(this),
      0 // no referral code
    );
    pool_.setUserUseReserveAsCollateral(assetCollateral_, true);
    // ensure that we received a-tokens; don't transfer them anywhere
    uint aTokensBalanceAfterSupply = IERC20(d.aTokenAddress).balanceOf(address(this));
    require(aTokensBalanceAfterSupply >= aTokensBalanceBeforeSupply, AppErrors.WEIRD_OVERFLOW);

    uint aTokensAmount = aTokensBalanceAfterSupply - aTokensBalanceBeforeSupply;
    require(aTokensAmount + ATOKEN_MAX_DELTA >= collateralAmount_, AppErrors.WRONG_DERIVATIVE_TOKENS_BALANCE);

    return aTokensAmount;
  }

  /// @notice Borrow {borrowedAmount_} using exist collateral to make rebalancing
  function borrowToRebalance (
    uint borrowAmount_,
    address receiver_
  ) external override returns (
    uint resultHealthFactor18,
    uint borrowedAmountOut
  ) {
    _onlyTetuConverter();

    address assetBorrow = borrowAsset;

    // ensure that the position is opened
    require(IDebtMonitor(controller.debtMonitor()).isPositionOpened(), AppErrors.BORROW_POSITION_IS_NOT_REGISTERED);

    // enter to E-mode if necessary
    prepareToBorrow();

    // make borrow, send borrowed amount to the receiver
    // we cannot transfer borrowed amount directly to receiver because the debt is incurred by amount receiver
    uint balanceBorrowAsset0 = IERC20(assetBorrow).balanceOf(address(this));
    _pool.borrow(
      assetBorrow,
      borrowAmount_,
      RATE_MODE,
      0, // no referral code
      address(this)
    );

    // ensure that we have received required borrowed amount, send the amount to the receiver
    require(
      borrowAmount_ + balanceBorrowAsset0 == IERC20(assetBorrow).balanceOf(address(this)),
      AppErrors.WRONG_BORROWED_BALANCE
    );
    IERC20(assetBorrow).safeTransfer(receiver_, borrowAmount_);

    // ensure that current health factor is greater than min allowed
    (,,,,, resultHealthFactor18) = _pool.getUserAccountData(address(this));
    _validateHealthFactor(resultHealthFactor18);

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
    address assetBorrow = borrowAsset;
    address assetCollateral = collateralAsset;
    IAavePool pool = _pool;
    IERC20(assetBorrow).safeTransferFrom(msg.sender, address(this), amountToRepay_);

    Aave3DataTypes.ReserveData memory rc = pool.getReserveData(assetCollateral);
    uint aTokensBalanceBeforeRepay = IERC20(rc.aTokenAddress).balanceOf(address(this));
    // how much collateral we are going to return
    uint amountCollateralToWithdraw = _getCollateralAmountToReturn(
        pool,
        amountToRepay_,
        assetCollateral,
        assetBorrow,
        closePosition_
    );
    // transfer borrow amount back to the pool
    // replaced by infinity approve: IERC20(assetBorrow).safeApprove(address(pool), amountToRepay_);
    pool.repay(assetBorrow,
      closePosition_ ? type(uint).max : amountToRepay_,
      RATE_MODE,
      address(this)
    );

    // withdraw the collateral
    // if the borrow was liquidated the collateral is zero and we will have revert here
    pool.withdraw(collateralAsset, amountCollateralToWithdraw, receiver_);

    if (closePosition_) {
      // user has transferred a little bigger amount than actually need to close position
      // because of the dust-tokens problem. Let's return remain amount back to the user
      uint borrowBalance = IERC20(assetBorrow).balanceOf(address(this));
      if (borrowBalance > 0) {
        IERC20(assetBorrow).safeTransfer(receiver_, borrowBalance);
      }
    }

    // validate result status
    (uint totalCollateralBase, uint totalDebtBase,,,, uint healthFactor) = pool.getUserAccountData(address(this));
    if (totalCollateralBase == 0 && totalDebtBase == 0) {
      IDebtMonitor(controller.debtMonitor()).onClosePosition();
    } else {
      require(!closePosition_, AppErrors.CLOSE_POSITION_FAILED);
      _validateHealthFactor(healthFactor);
    }

    uint aTokensBalanceAfterRepay = IERC20(rc.aTokenAddress).balanceOf(address(this));
    require(aTokensBalanceBeforeRepay >= aTokensBalanceAfterRepay, AppErrors.WEIRD_OVERFLOW);

    uint localCollateralBalanceATokens = collateralBalanceATokens;
    localCollateralBalanceATokens = aTokensBalanceBeforeRepay - aTokensBalanceAfterRepay > localCollateralBalanceATokens
      ? 0
      : localCollateralBalanceATokens - (aTokensBalanceBeforeRepay - aTokensBalanceAfterRepay);
    collateralBalanceATokens = localCollateralBalanceATokens;

    emit OnRepay(amountToRepay_, receiver_, closePosition_, healthFactor, localCollateralBalanceATokens);
    return amountCollateralToWithdraw;
  }

  /// @notice Get a part of collateral safe to return after repaying {amountToRepay_}
  /// @param amountToRepay_ Amount to be repaid [in borrowed tokens]
  /// @return Amount of collateral [in collateral tokens] to be returned in exchange of {borrowedAmount_}
  ///         Return type(uint).max if it's full repay and the position should be closed
  function _getCollateralAmountToReturn(
    IAavePool pool_,
    uint amountToRepay_,
    address assetCollateral_,
    address assetBorrow_,
    bool closePosition_
  ) internal view returns (uint) {
    // ensure that we really have a debt
    (uint256 totalCollateralBase, uint256 totalDebtBase,,,,) = pool_.getUserAccountData(address(this));
    require(totalDebtBase != 0, AppErrors.ZERO_BALANCE);

    // the assets prices in the base currency
    address[] memory assets = new address[](2);
    assets[0] = assetCollateral_;
    assets[1] = assetBorrow_;

    uint[] memory prices = _priceOracle.getAssetsPrices(assets);
    require(prices[0] != 0, AppErrors.ZERO_PRICE);

    // we cannot close position if the debt is repaying only partly
    uint amountToRepayBase = amountToRepay_ * prices[1] / (10 ** IERC20Extended(assetBorrow_).decimals());
    require(!closePosition_ || totalDebtBase <= amountToRepayBase, AppErrors.CLOSE_POSITION_FAILED);

    if (closePosition_) {
      return type(uint).max;
    }

    uint part = amountToRepayBase >= totalDebtBase
      ? 10**18
      : 10**18 * amountToRepayBase / totalDebtBase;

    return
      // == totalCollateral * amountToRepay / totalDebt
      totalCollateralBase * (10 ** IERC20Extended(assetCollateral_).decimals())
      * part / 10**18
      / prices[0];
  }

  function repayToRebalance(
    uint amount_,
    bool isCollateral_
  ) external override returns (
    uint resultHealthFactor18
  ) {
    _onlyTetuConverter();
    IAavePool pool = _pool;

    uint newCollateralBalanceATokens = collateralBalanceATokens;
    if (isCollateral_) {
      newCollateralBalanceATokens = _supply(_pool, collateralAsset, amount_) + newCollateralBalanceATokens;
      collateralBalanceATokens = newCollateralBalanceATokens;
    } else {
      address assetBorrow = borrowAsset;
      // ensure, that amount to repay is less then the total debt
      (,uint256 totalDebtBase0,,,,) = _pool.getUserAccountData(address(this));
      uint priceBorrowAsset = _priceOracle.getAssetPrice(assetBorrow);
      uint totalAmountToPay = totalDebtBase0 == 0
        ? 0
        : totalDebtBase0 * (10 ** _pool.getConfiguration(assetBorrow).getDecimals()) / priceBorrowAsset;
      require(totalDebtBase0 > 0 && amount_ < totalAmountToPay, AppErrors.REPAY_TO_REBALANCE_NOT_ALLOWED);

      IERC20(assetBorrow).safeTransferFrom(msg.sender, address(this), amount_);

      // transfer borrowed amount back to the pool
      // replaced by infinity approve: IERC20(assetBorrow).approve(address(pool), amount_);

      pool.repay(assetBorrow,
        amount_,
        RATE_MODE,
        address(this)
      );
    }

    // validate result health factor
    (,,,,, uint256 healthFactor) = pool.getUserAccountData(address(this));
    _validateHealthFactor(healthFactor);

    emit OnRepayToRebalance(amount_, isCollateral_, healthFactor, newCollateralBalanceATokens);
    return healthFactor;
  }

  ///////////////////////////////////////////////////////
  ///                 Rewards
  ///////////////////////////////////////////////////////
  function claimRewards(address receiver_) external pure override returns (
    address rewardToken,
    uint amount
  ) {
    //nothing to do, AAVE3 doesn't have rewards on polygon
    receiver_; // hide warning
    return (rewardToken, amount);
  }

  ///////////////////////////////////////////////////////
  ///         View current status
  ///////////////////////////////////////////////////////

  function getConversionKind() external pure override returns (AppDataTypes.ConversionKind) {
    return AppDataTypes.ConversionKind.BORROW_2;
  }

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
    (uint256 totalCollateralBase,
     uint256 totalDebtBase,
     ,,,
     uint256 hf18
    ) = _pool.getUserAccountData(address(this));

    address assetBorrow = borrowAsset;
    address assetCollateral = collateralAsset;

    address[] memory assets = new address[](2);
    assets[0] = assetCollateral;
    assets[1] = assetBorrow;
    uint[] memory prices = _priceOracle.getAssetsPrices(assets);
    require(prices[1] != 0 && prices[0] != 0, AppErrors.ZERO_PRICE);

    uint targetDecimals = (10 ** _pool.getConfiguration(assetBorrow).getDecimals());

    Aave3DataTypes.ReserveData memory rc = _pool.getReserveData(assetCollateral);
    uint aTokensBalance = IERC20(rc.aTokenAddress).balanceOf(address(this));

    return (
    // Total amount of provided collateral in [collateral asset]
      totalCollateralBase * (10 ** _pool.getConfiguration(assetCollateral).getDecimals()) / prices[0],
      // Total amount of borrowed debt in [borrow asset]. 0 - for closed borrow positions.
      totalDebtBase == 0
        ? 0
        : totalDebtBase * targetDecimals / prices[1]
      // we ask to pay a bit more amount to exclude dust tokens
      // i.e. for USD we need to pay only 1 cent
      // this amount allows us to pass type(uint).max to repay function
          + targetDecimals / 100,
      // Current health factor, decimals 18
      hf18,
      totalCollateralBase != 0 || totalDebtBase != 0,
      aTokensBalance > collateralBalanceATokens
        ? 0
        : (collateralBalanceATokens - aTokensBalance)
    );
  }

//  /// @notice Compute current cost of the money
//  function getAPR18() external view override returns (int) {
//    Aave3DataTypes.ReserveData memory rb = _pool.getReserveData(borrowAsset);
//    return int(uint(rb.currentVariableBorrowRate) * 10**18 * 100 / 10**27);
//  }


  ///////////////////////////////////////////////////////
  ///                    Utils
  ///////////////////////////////////////////////////////

  function _validateHealthFactor(uint hf18) internal view {
    require(hf18 >= uint(controller.minHealthFactor2())*10**(18-2), AppErrors.WRONG_HEALTH_FACTOR);
  }


}
