// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../openzeppelin/Initializable.sol";
import "../../openzeppelin/IERC20Metadata.sol";
import "../../interfaces/IConverterController.sol";
import "../../interfaces/IPoolAdapter.sol";
import "../../interfaces/IDebtMonitor.sol";
import "../../interfaces/IPoolAdapterInitializer.sol";
import "../../interfaces/IBookkeeper.sol";
import "../../integrations/aave3/IAavePool.sol";
import "../../integrations/aave3/IAavePriceOracle.sol";
import "../../integrations/aave3/IAaveAddressesProvider.sol";
import "../../integrations/aave3/Aave3ReserveConfiguration.sol";
import "../../integrations/aave3/IAaveToken.sol";
import "../../integrations/dforce/SafeRatioMath.sol";
import "../aaveShared/AaveSharedLib.sol";
import "../../libs/AppUtils.sol";
import "../../libs/AppErrors.sol";

/// @notice Implementation of IPoolAdapter for AAVE-v3-protocol, see https://docs.aave.com/hub/
/// @dev Instances of this contract are created using proxy-minimal pattern, so no constructor
abstract contract Aave3PoolAdapterBase is IPoolAdapter, IPoolAdapterInitializer, Initializable {
  using SafeERC20 for IERC20;
  using Aave3ReserveConfiguration for Aave3DataTypes.ReserveConfigurationMap;
  using SafeRatioMath for uint;

  //region ----------------------------------------------------- Constants
  /// @notice We allow to receive less atokens then provided collateral on following value
  /// @dev Sometime, we provide collateral=1000000000000000000000 and receive atokens=999999999999999999999
  uint constant public ATOKEN_MAX_DELTA = 10;
  string public constant POOL_ADAPTER_VERSION = "1.0.4";

  /// @notice 1 - stable, 2 - variable
  uint constant public RATE_MODE = 2;
  uint constant public SECONDS_PER_YEAR = 31536000;

  /// @notice repay allows to reduce health factor of following value (decimals 18):
  uint constant public MAX_ALLOWED_HEALTH_FACTOR_REDUCTION = 1e13; // 0.001%

  /// @notice amount of collateral in terms of base currency that cannot be used in any case during partial repayment
  ///         we need such reserve because of SCB-796
  ///         without it health factor can reduce after partial repayment in edge cases because of rounding
  ///         Base currency has 8 decimals, usdc/usdt have 6 decimals.. we need > 100 tokens in reserve
  uint constant internal COLLATERAL_RESERVE_BASE_CURRENCY = 1000;
  //endregion ----------------------------------------------------- Constants

  //region ----------------------------------------------------- Variables
  address public collateralAsset;
  address public borrowAsset;
  address public user;

  IConverterController public controller;
  IAavePool internal _pool;
  /// @notice Address of original PoolAdapter contract that was cloned to make the instance of the pool adapter
  address internal originConverter;

  /// @notice Total amount of all supplied and withdrawn amounts of collateral in ATokens
  uint public collateralBalanceATokens;
  //endregion ----------------------------------------------------- Variables

  //region ----------------------------------------------------- Events
  event OnInitialized(address controller, address pool, address user, address collateralAsset, address borrowAsset, address originConverter);
  event OnBorrow(uint collateralAmount, uint borrowAmount, address receiver, uint resultHealthFactor18, uint collateralBalanceATokens);
  event OnBorrowToRebalance(uint borrowAmount, address receiver, uint resultHealthFactor18);
  event OnRepay(uint amountToRepay, address receiver, bool closePosition, uint resultHealthFactor18, uint collateralBalanceATokens);
  event OnRepayToRebalance(uint amount, bool isCollateral, uint resultHealthFactor18, uint collateralBalanceATokens);
  event OnSalvage(address receiver, address token, uint amount);

  //endregion ----------------------------------------------------- Events

  //region ----------------------------------------------------- Data types
  struct RepayLocal {
    address assetBorrow;
    address assetCollateral;
    IAavePool pool;
    uint aTokensBeforeRepay;
    uint aTokensAfterRepay;
    uint amountCollateralToWithdraw;
    uint healthFactorBefore;
    uint healthFactorAfter;
    uint collateralBalanceATokens;
  }
  //endregion ----------------------------------------------------- Data types

  //region ----------------------------------------------------- Initialization and customization

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

    controller = IConverterController(controller_);
    user = user_;
    collateralAsset = collateralAsset_;
    borrowAsset = borrowAsset_;
    originConverter = originConverter_;

    _pool = IAavePool(pool_);

    // The pool adapter doesn't keep assets on its balance, so it's safe to use infinity approve
    // All approves replaced by infinity-approve were commented in the code below
    IERC20(collateralAsset_).safeApprove(pool_, 2 ** 255); // 2*255 is more gas-efficient than type(uint).max
    IERC20(borrowAsset_).safeApprove(pool_, 2 ** 255);

    emit OnInitialized(controller_, pool_, user_, collateralAsset_, borrowAsset_, originConverter_);
  }

  /// @notice Enter to E-mode if necessary
  function prepareToBorrow() internal virtual;

  /// @notice Save any not aToken from balance to {receiver}
  /// @dev Normally this contract doesn't have any tokens on balance except aTokens
  function salvage(address receiver, address token, uint amount) external {
    require(msg.sender == controller.governance(), AppErrors.GOVERNANCE_ONLY);
    IAavePool __pool = _pool;
    Aave3DataTypes.ReserveData memory rc = __pool.getReserveData(collateralAsset);
    Aave3DataTypes.ReserveData memory rb = __pool.getReserveData(borrowAsset);
    require(token != rc.aTokenAddress && token != rb.aTokenAddress, AppErrors.UNSALVAGEABLE);

    IERC20(token).safeTransfer(receiver, amount);
    emit OnSalvage(receiver, token, amount);
  }
  //endregion ----------------------------------------------------- Initialization and customization

  //region ----------------------------------------------------- Restrictions

  /// @notice Ensure that the caller is TetuConverter
  function _onlyTetuConverter(IConverterController controller_) internal view {
    require(controller_.tetuConverter() == msg.sender, AppErrors.TETU_CONVERTER_ONLY);
  }

  function updateStatus() external override {
    // empty function, no restrictions
    // nothing to do; getStatus always return actual amounts in AAVE
    // there is reserve.updateStatus function, i.e. see SupplyLogic.sol, executeWithdraw but it is internal
  }
  //endregion ----------------------------------------------------- Restrictions

  //region ----------------------------------------------------- Borrow logic

  /// @notice Supply collateral to the pool and borrow specified amount
  /// @dev No re-balancing here; Collateral amount must be approved to the pool adapter before the call of this function
  /// @param collateralAmount_ Amount of collateral, must be approved to the pool adapter before the call of borrow()
  /// @param borrowAmount_ Amount that should be borrowed in result
  /// @param receiver_ Receiver of the borrowed amount
  /// @return Result borrowed amount sent to the {receiver_}
  function borrow(uint collateralAmount_, uint borrowAmount_, address receiver_) external override returns (uint) {
    IConverterController c = controller;
    _onlyTetuConverter(c);

    IAavePool pool = _pool;
    address _borrowAsset = borrowAsset;
    address _collateralAsset = collateralAsset;

    uint newCollateralBalanceATokens = _supply(pool, _collateralAsset, collateralAmount_) + collateralBalanceATokens;
    collateralBalanceATokens = newCollateralBalanceATokens;

    // enter to E-mode if necessary
    prepareToBorrow();

    // make borrow, send borrowed amount to the receiver
    // we cannot transfer borrowed amount directly to receiver because the debt is incurred by amount receiver
    uint balanceBorrowAsset0 = IERC20(_borrowAsset).balanceOf(address(this));
    pool.borrow(_borrowAsset, borrowAmount_, RATE_MODE, 0, address(this));

    // ensure that we have received required borrowed amount, send the amount to the receiver
    require(
      borrowAmount_ + balanceBorrowAsset0 == IERC20(_borrowAsset).balanceOf(address(this)),
      AppErrors.WRONG_BORROWED_BALANCE
    );
    IERC20(_borrowAsset).safeTransfer(receiver_, borrowAmount_);

    // register the borrow in DebtMonitor
    IDebtMonitor(c.debtMonitor()).onOpenPosition();

    // ensure that current health factor is greater than min allowed
    (,,,,, uint256 healthFactor) = pool.getUserAccountData(address(this));
    _validateHealthFactor(c, healthFactor, 0);

    _registerInBookkeeperBorrow(c, collateralAmount_, borrowAmount_);
    emit OnBorrow(collateralAmount_, borrowAmount_, receiver_, healthFactor, newCollateralBalanceATokens);
    return borrowAmount_;
  }

  /// @notice Supply collateral to AAVE-pool
  /// @return Amount of received A-tokens
  function _supply(IAavePool pool_, address assetCollateral_, uint collateralAmount_) internal returns (uint) {
    Aave3DataTypes.ReserveData memory rc = pool_.getReserveData(assetCollateral_);
    uint aTokensBalanceBeforeSupply = IERC20(rc.aTokenAddress).balanceOf(address(this));

    IERC20(assetCollateral_).safeTransferFrom(msg.sender, address(this), collateralAmount_);

    // Supplies an `amount` of underlying asset into the reserve, receiving in return overlying aTokens.
    // E.g. User supplies 100 USDC and gets in return 100 aUSDC

    // replaced by infinity approve: IERC20(assetCollateral_).safeApprove(address(pool_), collateralAmount_);
    pool_.supply(assetCollateral_, collateralAmount_, address(this), 0);
    pool_.setUserUseReserveAsCollateral(assetCollateral_, true);

    // ensure that we received a-tokens; don't transfer them anywhere
    uint aTokensBalanceAfterSupply = IERC20(rc.aTokenAddress).balanceOf(address(this));
    require(aTokensBalanceAfterSupply >= aTokensBalanceBeforeSupply, AppErrors.WEIRD_OVERFLOW);

    uint aTokensAmount = aTokensBalanceAfterSupply - aTokensBalanceBeforeSupply;
    require(aTokensAmount + ATOKEN_MAX_DELTA >= collateralAmount_, AppErrors.WRONG_DERIVATIVE_TOKENS_BALANCE);

    return aTokensAmount;
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

    IAavePool pool = _pool;

    address assetBorrow = borrowAsset;

    // ensure that the position is opened
    require(IDebtMonitor(c.debtMonitor()).isPositionOpened(), AppErrors.BORROW_POSITION_IS_NOT_REGISTERED);

    // enter to E-mode if necessary
    prepareToBorrow();

    // make borrow, send borrowed amount to the receiver
    // we cannot transfer borrowed amount directly to receiver because the debt is incurred by amount receiver
    uint balanceBorrowAsset0 = IERC20(assetBorrow).balanceOf(address(this));
    pool.borrow(assetBorrow, borrowAmount_, RATE_MODE, 0, address(this));

    // ensure that we have received required borrowed amount, send the amount to the receiver
    require(
      borrowAmount_ + balanceBorrowAsset0 == IERC20(assetBorrow).balanceOf(address(this)),
      AppErrors.WRONG_BORROWED_BALANCE
    );
    IERC20(assetBorrow).safeTransfer(receiver_, borrowAmount_);

    // ensure that current health factor is greater than min allowed
    (,,,,, resultHealthFactor18) = pool.getUserAccountData(address(this));
    _validateHealthFactor(c, resultHealthFactor18, 0);

    _registerInBookkeeperBorrow(c, 0, borrowAmount_);
    emit OnBorrowToRebalance(borrowAmount_, receiver_, resultHealthFactor18);
    return (resultHealthFactor18, borrowAmount_);
  }
  //endregion ----------------------------------------------------- Borrow logic

  //region ----------------------------------------------------- Repay logic

  /// @notice Repay borrowed amount, return collateral to the user
  /// @param amountToRepay_ Exact amount of borrow asset that should be repaid
  ///        The amount should be approved for the pool adapter before the call of repay()
  ///        In the case of full repay this amount should be a slighter higher than total amount of debt
  ///        to avoid dust tokens problem. The caller should increase amount-to-repay, returned by getStatus,
  ///        on debt-gap percent (see controller).
  /// @param closePosition_ true to pay full borrowed amount
  /// @param receiver_ Receiver of withdrawn collateral
  /// @return Amount of collateral asset sent to the {receiver_}
  function repay(uint amountToRepay_, address receiver_, bool closePosition_) external override returns (uint) {
    RepayLocal memory v;

    IConverterController c = controller;
    _onlyTetuConverter(c);

    v.assetBorrow = borrowAsset;
    v.assetCollateral = collateralAsset;
    v.pool = _pool;
    IERC20(v.assetBorrow).safeTransferFrom(msg.sender, address(this), amountToRepay_);

    Aave3DataTypes.ReserveData memory rc = v.pool.getReserveData(v.assetCollateral);
    v.aTokensBeforeRepay = IERC20(rc.aTokenAddress).balanceOf(address(this));

    // how much collateral we are going to return
    (v.amountCollateralToWithdraw, v.healthFactorBefore) = _getCollateralAmountToReturn(
      v.pool,
      amountToRepay_,
      v.assetCollateral,
      v.assetBorrow,
      closePosition_,
      rc.configuration.getDecimals(),
      IAavePriceOracle(IAaveAddressesProvider(IAavePool(v.pool).ADDRESSES_PROVIDER()).getPriceOracle())
    );

    // transfer borrow amount back to the pool, infinity approve is assumed
    v.pool.repay(v.assetBorrow, (closePosition_ ? type(uint).max : amountToRepay_), RATE_MODE, address(this));

    // withdraw the collateral; if the borrow was liquidated the collateral is zero and we should have revert here
    // because it's not worth to make repayment in this case
    {
      // in the case of full repay {amountCollateralToWithdraw} contains type(uint).max
      // so, we need to calculate actual amount of returned collateral through balance difference
      uint balanceUserCollateralBefore = IERC20(v.assetCollateral).balanceOf(receiver_);
      v.pool.withdraw(v.assetCollateral, v.amountCollateralToWithdraw, receiver_); // amountCollateralToWithdraw can be equal to type(uint).max
      uint balanceUserCollateralAfter = IERC20(v.assetCollateral).balanceOf(receiver_);
      v.amountCollateralToWithdraw = AppUtils.sub0(balanceUserCollateralAfter, balanceUserCollateralBefore);
    }

    // close position in debt monitor / validate result health factor
    {
      uint totalCollateralBase;
      uint totalDebtBase;
      (totalCollateralBase, totalDebtBase,,,, v.healthFactorAfter) = v.pool.getUserAccountData(address(this));

      if (totalCollateralBase == 0 && totalDebtBase == 0) {
        IDebtMonitor(c.debtMonitor()).onClosePosition();
      } else {
        require(!closePosition_, AppErrors.CLOSE_POSITION_FAILED);
        _validateHealthFactor(c, v.healthFactorAfter, v.healthFactorBefore);
      }
    }

    {
      // user has transferred a little bigger amount than actually need to close position
      // because of the dust-tokens problem. Let's return remain amount back to the user
      uint borrowBalance = IERC20(v.assetBorrow).balanceOf(address(this));
      if (borrowBalance != 0) {
        // we assume here that the pool adapter has balance of 0 in normal case, any leftover should be send to
        IERC20(v.assetBorrow).safeTransfer(receiver_, borrowBalance);
        // adjust amountToRepay_ to returned amount to send correct amount to OnRepay event
        if (amountToRepay_ > borrowBalance) {
          amountToRepay_ -= borrowBalance;
        }
      }
    }

    // update value of internal collateralBalanceATokens
    v.aTokensAfterRepay = IERC20(rc.aTokenAddress).balanceOf(address(this));
    require(v.aTokensBeforeRepay >= v.aTokensAfterRepay, AppErrors.WEIRD_OVERFLOW);

    v.collateralBalanceATokens = AppUtils.sub0(collateralBalanceATokens, v.aTokensBeforeRepay - v.aTokensAfterRepay);
    collateralBalanceATokens = v.collateralBalanceATokens;

    emit OnRepay(amountToRepay_, receiver_, closePosition_, v.healthFactorAfter, v.collateralBalanceATokens);

    _registerInBookkeeperRepay(c, v.amountCollateralToWithdraw, amountToRepay_);
    return v.amountCollateralToWithdraw;
  }

  /// @notice Get a part of collateral safe to return after repaying {amountToRepay_}
  /// @param amountToRepay_ Amount to be repaid [in borrowed tokens]
  /// @return amountCollateralToWithdraw Amount of collateral [in collateral tokens]
  ///         to be returned in exchange of {borrowedAmount_}
  ///         Return type(uint).max if it's full repay and the position should be closed
  /// @return healthFactor18 Current value of the health factor
  function _getCollateralAmountToReturn(
    IAavePool pool_,
    uint amountToRepay_,
    address assetCollateral_,
    address assetBorrow_,
    bool closePosition_,
    uint collateralDecimals,
    IAavePriceOracle priceOracle_
  ) internal view returns (
    uint amountCollateralToWithdraw,
    uint healthFactor18
  ) {
    // ensure that we really have a debt
    uint256 totalCollateralBase;
    uint256 totalDebtBase;
    (totalCollateralBase, totalDebtBase,,,, healthFactor18) = pool_.getUserAccountData(address(this));
    require(totalDebtBase != 0, AppErrors.ZERO_BALANCE);

    uint borrowPrice = priceOracle_.getAssetPrice(assetBorrow_);
    require(borrowPrice != 0, AppErrors.ZERO_PRICE);

    uint amountToRepayBase = amountToRepay_ * borrowPrice / (10 ** IERC20Metadata(assetBorrow_).decimals());

    if (closePosition_ || amountToRepayBase >= totalDebtBase) {
      // we cannot close position and pay the debt only partly
      require(totalDebtBase <= amountToRepayBase, AppErrors.CLOSE_POSITION_PARTIAL);
      return (type(uint).max, healthFactor18);
    } else {
      // the assets prices in the base currency
      uint collateralPrice = priceOracle_.getAssetPrice(assetCollateral_);
      require(collateralPrice != 0, AppErrors.ZERO_PRICE);

      return (
      // SCB-796:
      //   We need to calculate total amount in terms of the collateral asset at first and only then take part of it.
      //   Also we should keep a few tokens untouched as a reserve
      //   to prevent decreasing of health factor in edge cases because of rounding error
      //   (we are going to return 0.000014 usdc, but 0.000015 are returned)
      //
      // totalCollateralBase and collateralPrice have decimals of base current, part has decimals 18
      // in result we have an amount in terms of collateral asset.
      // == totalCollateral * part, part = amountToRepay / totalDebt < 1; "part" is collateral that should be returned
        (
          (totalCollateralBase > COLLATERAL_RESERVE_BASE_CURRENCY
            ? totalCollateralBase - COLLATERAL_RESERVE_BASE_CURRENCY
            : totalCollateralBase
          ) * (10 ** collateralDecimals) / collateralPrice
        ) * amountToRepayBase / totalDebtBase,
        // WRONG: totalCollateralBase * (10 ** collateralDecimals) * part / 1e18 / collateralPrice,

        healthFactor18
      );
    }
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
  function repayToRebalance(uint amount_, bool isCollateral_) external override returns (
    uint resultHealthFactor18
  ) {
    IConverterController c = controller;
    _onlyTetuConverter(c);

    IAavePool pool = _pool;
    IAavePriceOracle priceOracle = IAavePriceOracle(IAaveAddressesProvider(IAavePool(pool).ADDRESSES_PROVIDER()).getPriceOracle());

    (,uint256 totalDebtBase0,,,, uint healthFactorBefore) = pool.getUserAccountData(address(this));
    uint newCollateralBalanceATokens = collateralBalanceATokens;
    if (isCollateral_) {
      newCollateralBalanceATokens = _supply(pool, collateralAsset, amount_) + newCollateralBalanceATokens;
      collateralBalanceATokens = newCollateralBalanceATokens;
      _registerInBookkeeperBorrow(c, amount_, 0);
    } else {
      address assetBorrow = borrowAsset;
      // ensure, that amount to repay is less then the total debt
      uint priceBorrowAsset = priceOracle.getAssetPrice(assetBorrow);
      uint totalAmountToPay = totalDebtBase0 == 0
        ? 0
        : totalDebtBase0 * (10 ** pool.getConfiguration(assetBorrow).getDecimals()) / priceBorrowAsset;
      require(totalDebtBase0 != 0 && amount_ < totalAmountToPay, AppErrors.REPAY_TO_REBALANCE_NOT_ALLOWED);

      IERC20(assetBorrow).safeTransferFrom(msg.sender, address(this), amount_);

      // transfer borrowed amount back to the pool
      // replaced by infinity approve: IERC20(assetBorrow).approve(address(pool), amount_);

      pool.repay(assetBorrow, amount_, RATE_MODE, address(this));
      _registerInBookkeeperRepay(c, 0, amount_);
    }

    // validate result health factor
    (,,,,, uint256 healthFactorAfter) = pool.getUserAccountData(address(this));
    _validateHealthFactor(controller, healthFactorAfter, healthFactorBefore);

    emit OnRepayToRebalance(amount_, isCollateral_, healthFactorAfter, newCollateralBalanceATokens);
    return healthFactorAfter;
  }

  /// @notice If we paid {amountToRepay_}, how much collateral would we receive?
  function getCollateralAmountToReturn(uint amountToRepay_, bool closePosition_) external view override returns (uint) {
    address assetCollateral = collateralAsset;
    IAavePool pool = _pool;
    IAavePriceOracle priceOracle = IAavePriceOracle(IAaveAddressesProvider(IAavePool(pool).ADDRESSES_PROVIDER()).getPriceOracle());

    if (closePosition_) { // full repay
      (uint256 totalCollateralBase,,,,,) = pool.getUserAccountData(address(this));

      uint collateralPrice = priceOracle.getAssetPrice(assetCollateral);
      require(collateralPrice != 0, AppErrors.ZERO_PRICE);

      return totalCollateralBase * (10 ** pool.getConfiguration(assetCollateral).getDecimals()) / collateralPrice;
    } else { // partial repay
      Aave3DataTypes.ReserveData memory rc = pool.getReserveData(assetCollateral);
      (uint amountCollateralToWithdraw,) = _getCollateralAmountToReturn(
        pool,
        amountToRepay_,
        assetCollateral,
        borrowAsset,
        false,
        rc.configuration.getDecimals(),
        priceOracle
      );
      return amountCollateralToWithdraw;
    }
  }
  //endregion ----------------------------------------------------- Repay logic

  //region ----------------------------------------------------- Rewards
  function claimRewards(address receiver_) external pure override returns (address rewardToken, uint amount) {
    //nothing to do, AAVE3 doesn't have rewards on polygon
    receiver_; // hide warning
    return (rewardToken, amount);
  }
  //endregion ----------------------------------------------------- Rewards

  //region ----------------------------------------------------- View current status
  function getConversionKind() external pure override returns (AppDataTypes.ConversionKind) {
    return AppDataTypes.ConversionKind.BORROW_2;
  }

  /// @inheritdoc IPoolAdapter
  function getConfig() external view override returns (address origin, address outUser, address outCollateralAsset, address outBorrowAsset) {
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
    IAavePool __pool = _pool;
    IAavePriceOracle priceOracle = IAavePriceOracle(IAaveAddressesProvider(IAavePool(__pool).ADDRESSES_PROVIDER()).getPriceOracle());

    (uint totalCollateralBase, uint totalDebtBase,,,, uint hf18) = __pool.getUserAccountData(address(this));

    address assetBorrow = borrowAsset;
    address assetCollateral = collateralAsset;

    uint collateralPrice = priceOracle.getAssetPrice(assetCollateral);
    uint borrowPrice = priceOracle.getAssetPrice(assetBorrow);
    require(collateralPrice != 0 && borrowPrice != 0, AppErrors.ZERO_PRICE);

    Aave3DataTypes.ReserveData memory rc = __pool.getReserveData(assetCollateral);
    {
      uint aTokensBalance = IERC20(rc.aTokenAddress).balanceOf(address(this));
      uint collateralBalanceATokensLocal = collateralBalanceATokens;
      collateralAmountLiquidated = aTokensBalance > collateralBalanceATokensLocal
        ? 0
        : (collateralBalanceATokensLocal - aTokensBalance);
    }

    return (
    // Total amount of provided collateral in [collateral asset]
      totalCollateralBase * (10 ** rc.configuration.getDecimals()) / collateralPrice,

    // Total amount of borrowed debt in [borrow asset]. 0 - for closed borrow positions.
      totalDebtBase == 0
        ? 0
        : (totalDebtBase * (10 ** __pool.getConfiguration(assetBorrow).getDecimals())) / borrowPrice,
    // Current health factor, decimals 18
      hf18,
      totalCollateralBase != 0 || totalDebtBase != 0,
      collateralAmountLiquidated, // todo it should return amount of collateral, not amount of a-tokens

    // Debt gap should be used to pay the debt to workaround dust tokens problem.
    // It means that the user should pay slightly higher amount than the current totalDebtBase.
    // It give us a possibility to pass type(uint).max to repay function.
    // see https://docs.aave.com/developers/core-contracts/pool#repay
    // and "Aave_Protocol_Whitepaper_v1_0.pdf", section 3.8.1 "It’s impossible to transfer the whole balance at once"
      true
    );
  }
  //endregion ----------------------------------------------------- View current status

  //region ----------------------------------------------------- Utils

  /// @notice Validate that result health factor is correct, SCB-794
  ///         1) If we make a borrow the health factor is correct if it's greater than the min allowed threshold.
  ///         2) If we make repaying, the health factor is correct if
  ///                   it's greater than the min allowed threshold
  ///                   or it wasn't reduced too much
  /// @param healthFactorAfter Value of health factor after the operation - the value to check
  /// @param healthFactorBefore Value of health factor before the operation. 0 if borrow.
  function _validateHealthFactor(
    IConverterController controller_,
    uint healthFactorAfter,
    uint healthFactorBefore
  ) internal view {
    uint threshold = uint(controller_.minHealthFactor2()) * 10 ** (18 - 2);
    uint reduction = healthFactorBefore > healthFactorAfter
      ? healthFactorBefore - healthFactorAfter
      : 0;
    require(
      healthFactorAfter >= threshold
      || (healthFactorBefore != 0 && reduction < MAX_ALLOWED_HEALTH_FACTOR_REDUCTION),
      AppErrors.WRONG_HEALTH_FACTOR
    );
  }

  /// @notice Register borrow operation in Bookkeeper
  function _registerInBookkeeperBorrow(
    IConverterController controller_,
    uint amountCollateral,
    uint amountBorrow
  ) internal {
    IBookkeeper(controller_.bookkeeper()).onBorrow(amountCollateral, amountBorrow);
  }

  /// @notice Register repay operation in Bookkeeper
  function _registerInBookkeeperRepay(
    IConverterController controller_,
    uint withdrawnCollateral,
    uint paidAmount
  ) internal {
    IBookkeeper(controller_.bookkeeper()).onRepay(withdrawnCollateral, paidAmount);
  }
  //endregion ----------------------------------------------------- Utils

}
