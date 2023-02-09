// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../openzeppelin/Initializable.sol";
import "../../openzeppelin/IERC20Metadata.sol";
import "../../libs/AppErrors.sol";
import "../../interfaces/IPoolAdapter.sol";
import "../../interfaces/IPoolAdapterInitializer.sol";
import "../../interfaces/IController.sol";
import "../../interfaces/IDebtMonitor.sol";
import "../../integrations/aaveTwo/IAaveTwoPool.sol";
import "../../integrations/aaveTwo/IAaveTwoPriceOracle.sol";
import "../../integrations/aaveTwo/IAaveTwoLendingPoolAddressesProvider.sol";
import "../../integrations/aaveTwo/AaveTwoReserveConfiguration.sol";
import "../../integrations/aaveTwo/IAaveTwoAToken.sol";
import "../../integrations/dforce/SafeRatioMath.sol";

import "hardhat/console.sol";

/// @notice Implementation of IPoolAdapter for AAVE-v2-protocol, see https://docs.aave.com/hub/
/// @dev Instances of this contract are created using proxy-minimal pattern, so no constructor
contract AaveTwoPoolAdapter is IPoolAdapter, IPoolAdapterInitializer, Initializable {
  using SafeERC20 for IERC20;
  using AaveTwoReserveConfiguration for DataTypes.ReserveConfigurationMap;
  using SafeRatioMath for uint;

  /// @notice We allow to receive less atokens then provided collateral on following value
  /// @dev Sometime, we provide collateral=1000000000000000000000 and receive atokens=999999999999999999999
  uint constant public ATOKEN_MAX_DELTA = 10;

  /// @notice 1 - stable, 2 - variable
  uint constant public RATE_MODE = 2;

  address public collateralAsset;
  address public borrowAsset;
  address public user;

  IController public controller;
  IAaveTwoPool internal _pool;

  /// @notice Address of original PoolAdapter contract that was cloned to make the instance of the pool adapter
  address originConverter;

  /// @notice Total amount of all supplied and withdrawn amounts of collateral in A-tokens
  uint public collateralBalanceATokens;

  ///////////////////////////////////////////////////////
  ///                Events
  ///////////////////////////////////////////////////////
  event OnInitialized(
    address controller,
    address pool,
    address user,
    address collateralAsset,
    address borrowAsset,
    address originConverter
  );
  event OnBorrow(uint collateralAmount, uint borrowAmount, address receiver, uint resultHealthFactor18, uint collateralBalanceATokens);
  event OnBorrowToRebalance(uint borrowAmount, address receiver, uint resultHealthFactor18);
  event OnRepay(uint amountToRepay, address receiver, bool closePosition, uint resultHealthFactor18, uint collateralBalanceATokens);
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
      && user_ != address(0)
      && pool_ != address(0)
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

    _pool = IAaveTwoPool(pool_);

    // The pool adapter doesn't keep assets on its balance, so it's safe to use infinity approve
    // All approves replaced by infinity-approve were commented in the code below
    IERC20(collateralAsset_).safeApprove(pool_, 2**255); // 2*255 is more gas-efficient than type(uint).max
    IERC20(borrowAsset_).safeApprove(pool_, 2**255); // 2*255 is more gas-efficient than type(uint).max

    emit OnInitialized(controller_, pool_, user_, collateralAsset_, borrowAsset_, originConverter_);
  }

  ///////////////////////////////////////////////////////
  ///                 Restrictions
  ///////////////////////////////////////////////////////

  /// @notice Ensure that the caller is TetuConverter
  function _onlyTetuConverter(IController controller_) internal view {
    require(controller_.tetuConverter() == msg.sender, AppErrors.TETU_CONVERTER_ONLY);
  }

  function updateStatus() external override {
    // nothing to do; getStatus always return actual amounts in AAVE
  }
  ///////////////////////////////////////////////////////
  ///                 Borrow logic
  ///////////////////////////////////////////////////////

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
    IController c = controller;
    _onlyTetuConverter(c);

    IAaveTwoPool pool = _pool;
    address assetBorrow = borrowAsset;

    uint newCollateralBalanceATokens = _supply(pool, collateralAsset, collateralAmount_) + collateralBalanceATokens;
    collateralBalanceATokens = newCollateralBalanceATokens;

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
    IDebtMonitor(c.debtMonitor()).onOpenPosition();

    // ensure that current health factor is greater than min allowed
    (,,,,, uint256 healthFactor) = pool.getUserAccountData(address(this));
    _validateHealthFactor(c, healthFactor);

    emit OnBorrow(collateralAmount_, borrowAmount_, receiver_, healthFactor, newCollateralBalanceATokens);
    return borrowAmount_;
  }

  /// @notice Supply collateral to AAVE-pool
  /// @return Amount of received A-tokens
  function _supply(
    IAaveTwoPool pool_,
    address assetCollateral_,
    uint collateralAmount_
  ) internal returns (uint) {
    //a-tokens
    DataTypes.ReserveData memory d = pool_.getReserveData(assetCollateral_);
    uint aTokensBalanceBeforeSupply = IERC20(d.aTokenAddress).balanceOf(address(this));

    IERC20(assetCollateral_).safeTransferFrom(msg.sender, address(this), collateralAmount_);

    // Supplies an `amount` of underlying asset into the reserve, receiving in return overlying aTokens.
    // E.g. User supplies 100 USDC and gets in return 100 aUSDC
    // replaced by infinity approve: IERC20(assetCollateral_).safeApprove(address(pool_), collateralAmount_);
    pool_.deposit(
      assetCollateral_,
      collateralAmount_,
      address(this),
      0 // no referral code
    );
    pool_.setUserUseReserveAsCollateral(assetCollateral_, true);

    uint aTokensBalanceAfterSupply = IERC20(d.aTokenAddress).balanceOf(address(this));

    // deposit() shouldn't reduce balance..
    // but let's check it to avoid even possibility of the overflow in aTokensAmount calculation
    require(aTokensBalanceAfterSupply >= aTokensBalanceBeforeSupply, AppErrors.WEIRD_OVERFLOW);

    uint aTokensAmount = aTokensBalanceAfterSupply - aTokensBalanceBeforeSupply;
    require(aTokensAmount + ATOKEN_MAX_DELTA >= collateralAmount_, AppErrors.WRONG_DERIVATIVE_TOKENS_BALANCE);

    return aTokensAmount;
  }

  /// @notice Borrow additional amount {borrowAmount_} using exist collateral and send it to {receiver_}
  /// @dev Re-balance: too big health factor => target health factor
  /// @return resultHealthFactor18 Result health factor after borrow
  /// @return borrowedAmountOut Exact amount sent to the borrower
  function borrowToRebalance(
    uint borrowAmount_,
    address receiver_
  ) external override returns (
    uint resultHealthFactor18,
    uint borrowedAmountOut
  ) {
    IController c = controller;
    _onlyTetuConverter(c);

    IAaveTwoPool pool = _pool;
    address assetBorrow = borrowAsset;

    // ensure that the position is opened
    require(IDebtMonitor(c.debtMonitor()).isPositionOpened(), AppErrors.BORROW_POSITION_IS_NOT_REGISTERED);

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
    // we assume here, that syncBalance(true) is called before the call of this function
    require(
      borrowAmount_ + balanceBorrowAsset0 == IERC20(assetBorrow).balanceOf(address(this)),
      AppErrors.WRONG_BORROWED_BALANCE
    );
    IERC20(assetBorrow).safeTransfer(receiver_, borrowAmount_);

    // ensure that current health factor is greater than min allowed
    (,,,,, resultHealthFactor18) = pool.getUserAccountData(address(this));
    _validateHealthFactor(c, resultHealthFactor18);

    emit OnBorrowToRebalance(borrowAmount_, receiver_, resultHealthFactor18);
    return (resultHealthFactor18, borrowAmount_);
  }

  ///////////////////////////////////////////////////////
  ///                 Repay logic
  ///////////////////////////////////////////////////////

  /// @notice Repay borrowed amount, return collateral to the user
  /// @param amountToRepay_ Exact amount of borrow asset that should be repaid
  ///                       The amount should be approved for the pool adapter before the call of repay()
  /// @param closePosition_ true to pay full borrowed amount
  /// @param receiver_ Receiver of withdrawn collateral
  /// @return Amount of collateral asset sent to the {receiver_}
  function repay(
    uint amountToRepay_,
    address receiver_,
    bool closePosition_
  ) external override returns (uint) {
    IController c = controller;
    _onlyTetuConverter(c);

    address assetCollateral = collateralAsset;
    address assetBorrow = borrowAsset;
    IAaveTwoPool pool = _pool;
    IAaveTwoPriceOracle priceOracle = IAaveTwoPriceOracle(
      IAaveTwoLendingPoolAddressesProvider(IAaveTwoPool(pool).getAddressesProvider()).getPriceOracle()
    );

    IERC20(assetBorrow).safeTransferFrom(msg.sender, address(this), amountToRepay_);
    DataTypes.ReserveData memory rc = pool.getReserveData(assetCollateral);
    uint aTokensBalanceBeforeSupply = IERC20(rc.aTokenAddress).balanceOf(address(this));

    // how much collateral we are going to return
    uint amountCollateralToWithdraw = _getCollateralAmountToReturn(
      pool,
      amountToRepay_,
      assetCollateral,
      assetBorrow,
      closePosition_,
      priceOracle
    );

    // transfer borrow amount back to the pool
    // replaced by infinity approve: IERC20(assetBorrow).approve(address(pool), amountToRepay_);

    console.log("AaveTwoPoolAdapter.repay amountToRepay_ closePosition_", amountToRepay_, closePosition_);
    pool.repay(assetBorrow,
      closePosition_ ? type(uint).max : amountToRepay_,
      RATE_MODE,
      address(this)
    );

    // withdraw the collateral
    if (closePosition_) {
      // if the position is closed, amountCollateralToWithdraw contains type(uint).max
      // so, we need to calculate actual amount of returned collateral through balance difference
      uint balanceUserCollateralBefore = IERC20(assetCollateral).balanceOf(receiver_);
      pool.withdraw(assetCollateral, amountCollateralToWithdraw, receiver_); // amountCollateralToWithdraw == type(uint).max
      uint balanceUserCollateralAfter = IERC20(assetCollateral).balanceOf(receiver_);
      amountCollateralToWithdraw = balanceUserCollateralAfter < balanceUserCollateralBefore
        ? 0
        : balanceUserCollateralAfter - balanceUserCollateralBefore;
    } else {
      pool.withdraw(assetCollateral, amountCollateralToWithdraw, receiver_);
    }

    if (closePosition_) {
      // user has transferred a little bigger amount than actually need to close position
      // because of the dust-tokens problem. Let's return remain amount back to the user
      uint borrowBalance = IERC20(assetBorrow).balanceOf(address(this));
      if (borrowBalance != 0) {
        IERC20(assetBorrow).safeTransfer(receiver_, borrowBalance);
      }
    }

    // validate result status
    uint256 healthFactor;
    {
      uint totalCollateralBase;
      uint totalDebtBase;
      (totalCollateralBase, totalDebtBase,,,, healthFactor) = pool.getUserAccountData(address(this));
      if (totalCollateralBase == 0 && totalDebtBase == 0) {
        IDebtMonitor(c.debtMonitor()).onClosePosition();
      } else {
        require(!closePosition_, AppErrors.CLOSE_POSITION_FAILED);
        _validateHealthFactor(c, healthFactor);
      }
    }

    uint aTokensBalanceAfterSupply = IERC20(rc.aTokenAddress).balanceOf(address(this));

    require(aTokensBalanceBeforeSupply >= aTokensBalanceAfterSupply, AppErrors.WEIRD_OVERFLOW);
    uint localCollateralBalanceATokens = collateralBalanceATokens;
    localCollateralBalanceATokens = aTokensBalanceBeforeSupply - aTokensBalanceAfterSupply > localCollateralBalanceATokens
      ? 0
      : localCollateralBalanceATokens - (aTokensBalanceBeforeSupply - aTokensBalanceAfterSupply);
    collateralBalanceATokens = localCollateralBalanceATokens;

    emit OnRepay(amountToRepay_, receiver_, closePosition_, healthFactor, localCollateralBalanceATokens);
    return amountCollateralToWithdraw;
  }

  /// @notice Get a part of collateral safe to return after repaying {amountToRepay_}
  /// @param amountToRepay_ Amount to be repaid [in borrowed tokens]
  /// @return Amount of collateral [in collateral tokens] to be returned in exchange of {borrowedAmount_}
  ///         Return type(uint).max if it's full repay and the position should be closed
  function _getCollateralAmountToReturn(
    IAaveTwoPool pool_,
    uint amountToRepay_,
    address assetCollateral_,
    address assetBorrow_,
    bool closePosition_,
    IAaveTwoPriceOracle priceOracle_
  ) internal view returns (uint) {
    // get total amount of the borrow position
    (uint256 totalCollateralBase, uint256 totalDebtBase,,,,) = pool_.getUserAccountData(address(this));
    require(totalDebtBase != 0, AppErrors.ZERO_BALANCE);

    uint borrowPrice =  priceOracle_.getAssetPrice(assetBorrow_);
    require(borrowPrice != 0, AppErrors.ZERO_PRICE);

    uint amountToRepayBase = amountToRepay_ * borrowPrice / (10 ** IERC20Metadata(assetBorrow_).decimals());

    if (closePosition_) {
      // we cannot close position and pay the debt only partly
      require(totalDebtBase <= amountToRepayBase, AppErrors.CLOSE_POSITION_PARTIAL);

      return type(uint).max;
    } else {
      // the assets prices in the base currency
      uint collateralPrice = priceOracle_.getAssetPrice(assetCollateral_);
      require(collateralPrice != 0, AppErrors.ZERO_PRICE);

      uint part = amountToRepayBase >= totalDebtBase
        ? 10**18
        : 10**18 * amountToRepayBase / totalDebtBase;

      return
        // == totalCollateral * amountToRepay / totalDebt
        totalCollateralBase * (10 ** IERC20Metadata(assetCollateral_).decimals())
        * part / 10**18
        / collateralPrice;
    }
  }

  /// @notice If we paid {amountToRepay_}, how much collateral would we receive?
  function getCollateralAmountToReturn(uint amountToRepay_, bool closePosition_) external view override returns (uint) {
    address assetCollateral = collateralAsset;
    IAaveTwoPool pool = _pool;
    IAaveTwoPriceOracle priceOracle = IAaveTwoPriceOracle(
      IAaveTwoLendingPoolAddressesProvider(IAaveTwoPool(pool).getAddressesProvider()).getPriceOracle()
    );

    if (closePosition_) {
      // full repay
      (uint256 totalCollateralBase,,,,,) = pool.getUserAccountData(address(this));

      uint collateralPrice = priceOracle.getAssetPrice(assetCollateral);
      require(collateralPrice != 0, AppErrors.ZERO_PRICE);

      return totalCollateralBase * (10 ** pool.getConfiguration(assetCollateral).getDecimals()) / collateralPrice;
    } else {
      // partial repay
      return _getCollateralAmountToReturn(
        pool,
        amountToRepay_,
        assetCollateral,
        borrowAsset,
        false,
        priceOracle
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
  function repayToRebalance(
    uint amount_,
    bool isCollateral_
  ) external override returns (
    uint resultHealthFactor18
  ) {
    IController c = controller;
    _onlyTetuConverter(c);

    address assetBorrow = borrowAsset;
    IAaveTwoPool pool = _pool;
    IAaveTwoPriceOracle priceOracle = IAaveTwoPriceOracle(
      IAaveTwoLendingPoolAddressesProvider(IAaveTwoPool(pool).getAddressesProvider()).getPriceOracle()
    );

    uint newCollateralBalanceATokens = collateralBalanceATokens;
    if (isCollateral_) {
      newCollateralBalanceATokens = _supply(pool, collateralAsset, amount_) + newCollateralBalanceATokens;
      collateralBalanceATokens = newCollateralBalanceATokens;
    } else {
      // ensure, that amount to repay is less then the total debt
      (,uint256 totalDebtBase0,,,,) = pool.getUserAccountData(address(this));
      uint priceBorrowAsset = priceOracle.getAssetPrice(assetBorrow);
      uint totalAmountToPay = totalDebtBase0 == 0
        ? 0
        : totalDebtBase0 * (10 ** pool.getConfiguration(assetBorrow).getDecimals()) / priceBorrowAsset;
      require(totalDebtBase0 != 0 && amount_ < totalAmountToPay, AppErrors.REPAY_TO_REBALANCE_NOT_ALLOWED);

      IERC20(assetBorrow).safeTransferFrom(msg.sender, address(this), amount_);

      // transfer borrow amount back to the pool
      // replaced by infinity approve: IERC20(assetBorrow).safeApprove(address(pool), amount_);

      pool.repay(assetBorrow,
        amount_,
        RATE_MODE,
        address(this)
      );
    }

    // validate result status
    (,,,,, uint256 healthFactor) = pool.getUserAccountData(address(this));
    _validateHealthFactor(c, healthFactor);

    emit OnRepayToRebalance(amount_, isCollateral_, healthFactor, newCollateralBalanceATokens);
    return healthFactor;
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

  /// @notice Get current status of the borrow position
  /// @dev It returns STORED status. To get current status it's necessary to call updateStatus
  ///      at first to update interest and recalculate status.
  /// @return collateralAmount Total amount of provided collateral, collateral currency
  /// @return amountToPay Total amount of borrowed debt in [borrow asset]. 0 - for closed borrow positions.
  /// @return healthFactor18 Current health factor, decimals 18
  /// @return opened The position is opened (there is not empty collateral/borrow balance)
  /// @return collateralAmountLiquidated How much collateral was liquidated
  function getStatus() external view override returns (
    uint collateralAmount,
    uint amountToPay,
    uint healthFactor18,
    bool opened,
    uint collateralAmountLiquidated
  ) {
    IAaveTwoPool pool = _pool;

    (uint256 totalCollateralBase, uint256 totalDebtBase,,,, uint256 hf18) = pool.getUserAccountData(address(this));

    address assetCollateral = collateralAsset;
    address assetBorrow = borrowAsset;

    uint collateralPrice;
    uint borrowPrice;
    {
      IAaveTwoPriceOracle priceOracle = IAaveTwoPriceOracle(
        IAaveTwoLendingPoolAddressesProvider(IAaveTwoPool(pool).getAddressesProvider()).getPriceOracle()
      );
      collateralPrice = priceOracle.getAssetPrice(assetCollateral);
      borrowPrice = priceOracle.getAssetPrice(assetBorrow);
      require(collateralPrice != 0 && borrowPrice != 0, AppErrors.ZERO_PRICE);
    }

    DataTypes.ReserveData memory rc = pool.getReserveData(assetCollateral);
    uint aTokensBalance = IERC20(rc.aTokenAddress).balanceOf(address(this));

    uint targetDecimals = (10 ** pool.getConfiguration(assetBorrow).getDecimals());
    console.log("targetDecimals", targetDecimals);
    console.log("borrowPrice", borrowPrice);
    console.log("totalDebtBase", totalDebtBase);
    return (
    // Total amount of provided collateral in [collateral asset]
      totalCollateralBase * (10 ** pool.getConfiguration(assetCollateral).getDecimals()) / collateralPrice,
    // Total amount of borrowed debt in [borrow asset]. 0 - for closed borrow positions.
      totalDebtBase == 0
        ? 0
        : totalDebtBase * targetDecimals / borrowPrice
        // We ask to pay slightly higher amount than current borrowed amount to exclude dust tokens problem.
        // See https://docs.aave.com/developers/core-contracts/pool#repay
        // we assume here, that 100 cents (in USD) should cover all possible dust
        // and give us a possibility to pass type(uint).max to repay function
        // Ensure, that required debt exceeds totalDebtBase by at least token
          + (targetDecimals > borrowPrice * 1
            ? targetDecimals / borrowPrice / 1 // it's not valid for WBTC
            : 1),
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
//    DataTypes.ReserveData memory rb = _pool.getReserveData(borrowAsset);
//    return int(uint(rb.currentVariableBorrowRate) * 10**18 * 100 / 10**27);
//  }

  ///////////////////////////////////////////////////////
  ///                 Rewards
  ///////////////////////////////////////////////////////
  function claimRewards(address receiver_) external pure override returns (
    address rewardToken,
    uint amount
  ) {
    //nothing to do, AAVE v2 doesn't have rewards on polygon anymore
    receiver_; // hide warning
    return (rewardToken, amount);
  }


  ///////////////////////////////////////////////////////
  ///               Utils to inline
  ///////////////////////////////////////////////////////

  function _validateHealthFactor(IController controller_, uint hf18) internal view {
    require(hf18 >= uint(controller_.minHealthFactor2())*10**(18-2), AppErrors.WRONG_HEALTH_FACTOR);
  }

}
