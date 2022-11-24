// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../core/DebtMonitor.sol";
import "../../core/AppErrors.sol";
import "../../interfaces/IPoolAdapter.sol";
import "../../interfaces/IPoolAdapterInitializer.sol";
import "../../integrations/aaveTwo/IAaveTwoPool.sol";
import "../../integrations/aaveTwo/IAaveTwoPriceOracle.sol";
import "../../integrations/aaveTwo/IAaveTwoLendingPoolAddressesProvider.sol";
import "../../integrations/aaveTwo/AaveTwoReserveConfiguration.sol";
import "../../integrations/aaveTwo/IAaveTwoAToken.sol";
import "../../integrations/dforce/SafeRatioMath.sol";
import "../../openzeppelin/Initializable.sol";

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
  IAaveTwoPriceOracle internal _priceOracle;

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
    _priceOracle = IAaveTwoPriceOracle(IAaveTwoLendingPoolAddressesProvider(_pool.getAddressesProvider()).getPriceOracle());

    // The pool adapter doesn't keep assets on its balance, so it's safe to use infinity approve
    // All approves replaced by infinity-approve were commented in the code below
    IERC20(collateralAsset_).safeApprove(pool_, type(uint).max);
    IERC20(borrowAsset_).safeApprove(pool_, type(uint).max);

    emit OnInitialized(controller_, pool_, user_, collateralAsset_, borrowAsset_, originConverter_);
  }

  ///////////////////////////////////////////////////////
  ///                 Restrictions
  ///////////////////////////////////////////////////////

  /// @notice Ensure that the caller is TetuConverter
  function _onlyTetuConverter() internal view {
    require(controller.tetuConverter() == msg.sender, AppErrors.TETU_CONVERTER_ONLY);
  }

  function updateStatus() external override {
    // nothing to do; getStatus always return actual amounts in AAVE
  }
  ///////////////////////////////////////////////////////
  ///                 Borrow logic
  ///////////////////////////////////////////////////////

  /// @notice Supply collateral to the pool and borrow {borrowedAmount_}
  /// @dev Caller should call "syncBalance" before transferring collateral amount and call "borrow"
  function borrow(
    uint collateralAmount_,
    uint borrowAmount_,
    address receiver_
  ) external override returns (uint) {
    _onlyTetuConverter();

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

  function borrowToRebalance(
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
    // we assume here, that syncBalance(true) is called before the call of this function
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
    address assetCollateral = collateralAsset;
    address assetBorrow = borrowAsset;
    IAaveTwoPool pool = _pool;

    IERC20(assetBorrow).safeTransferFrom(msg.sender, address(this), amountToRepay_);
    DataTypes.ReserveData memory rc = pool.getReserveData(assetCollateral);
    uint aTokensBalanceBeforeSupply = IERC20(rc.aTokenAddress).balanceOf(address(this));

    // how much collateral we are going to return
    uint amountCollateralToWithdraw = _getCollateralAmountToReturn(
      pool,
      amountToRepay_,
      assetCollateral,
      assetBorrow,
      closePosition_
    );

    // transfer borrow amount back to the pool
    // replaced by infinity approve: IERC20(assetBorrow).approve(address(pool), amountToRepay_);

    pool.repay(assetBorrow,
      closePosition_ ? type(uint).max : amountToRepay_,
      RATE_MODE,
      address(this)
    );

    // withdraw the collateral
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
    (uint totalCollateralBase, uint totalDebtBase,,,, uint256 healthFactor) = pool.getUserAccountData(address(this));
    if (totalCollateralBase == 0 && totalDebtBase == 0) {
      IDebtMonitor(controller.debtMonitor()).onClosePosition();
    } else {
      require(!closePosition_, AppErrors.CLOSE_POSITION_FAILED);
      _validateHealthFactor(healthFactor);
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
    bool closePosition_
  ) internal view returns (uint) {
    // get total amount of the borrow position
    (uint256 totalCollateralBase, uint256 totalDebtBase,,,,) = pool_.getUserAccountData(address(this));
    require(totalDebtBase != 0, AppErrors.ZERO_BALANCE);

    // the assets prices in the base currency
    address[] memory assets = new address[](2);
    assets[0] = assetCollateral_;
    assets[1] = assetBorrow_;

    uint[] memory prices = _priceOracle.getAssetsPrices(assets);
    require(prices[0] != 0, AppErrors.ZERO_PRICE);

    uint amountToRepayBase = amountToRepay_ * prices[1] / (10 ** IERC20Metadata(assetBorrow_).decimals());
    require(!closePosition_ || totalDebtBase <= amountToRepayBase, AppErrors.CLOSE_POSITION_FAILED);

    if (closePosition_) {
      return type(uint).max;
    }

    uint part = amountToRepayBase >= totalDebtBase
      ? 10**18
      : 10**18 * amountToRepayBase / totalDebtBase;

    return
      // == totalCollateral * amountToRepay / totalDebt
      totalCollateralBase * (10 ** IERC20Metadata(assetCollateral_).decimals())
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
    address assetBorrow = borrowAsset;
    IAaveTwoPool pool = _pool;

    uint newCollateralBalanceATokens = collateralBalanceATokens;
    if (isCollateral_) {
      newCollateralBalanceATokens = _supply(_pool, collateralAsset, amount_) + newCollateralBalanceATokens;
      collateralBalanceATokens = newCollateralBalanceATokens;
    } else {
      // ensure, that amount to repay is less then the total debt
      (,uint256 totalDebtBase0,,,,) = _pool.getUserAccountData(address(this));
      uint priceBorrowAsset = _priceOracle.getAssetPrice(assetBorrow);
      uint totalAmountToPay = totalDebtBase0 == 0
        ? 0
        : totalDebtBase0 * (10 ** _pool.getConfiguration(assetBorrow).getDecimals()) / priceBorrowAsset;
      require(totalDebtBase0 > 0 && amount_ < totalAmountToPay, AppErrors.REPAY_TO_REBALANCE_NOT_ALLOWED);

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
    _validateHealthFactor(healthFactor);

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

    address assetCollateral = collateralAsset;
    address assetBorrow = borrowAsset;

    address[] memory assets = new address[](2);
    assets[0] = assetCollateral;
    assets[1] = assetBorrow;
    uint[] memory prices = _priceOracle.getAssetsPrices(assets);
    require(prices[1] != 0 && prices[0] != 0, AppErrors.ZERO_PRICE);

    DataTypes.ReserveData memory rc = _pool.getReserveData(assetCollateral);
    uint aTokensBalance = IERC20(rc.aTokenAddress).balanceOf(address(this));

    uint targetDecimals = (10 ** _pool.getConfiguration(assetBorrow).getDecimals());
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

  function _validateHealthFactor(uint hf18) internal view {
    require(hf18 >= uint(controller.minHealthFactor2())*10**(18-2), AppErrors.WRONG_HEALTH_FACTOR);
  }

}
