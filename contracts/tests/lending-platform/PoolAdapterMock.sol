// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../../interfaces/IPoolAdapter.sol";
import "hardhat/console.sol";
import "../../interfaces/IPriceOracle.sol";
import "../../openzeppelin/IERC20.sol";
import "../tokens/MockERC20.sol";
import "../../integrations/IERC20Extended.sol";
import "../../interfaces/IDebtsMonitor.sol";
import "./PoolStub.sol";
import "../../interfaces/IController.sol";
import "../../core/AppErrors.sol";
import "../../core/AppUtils.sol";

contract PoolAdapterMock is IPoolAdapter {
  using AppUtils for uint;

  address public controller;
  address private _pool;
  address private _user;
  address private _collateralAsset;
  address private _borrowAsset;

  MockERC20 private _cTokenMock;
  /** Collateral factor (liquidation threshold) of the collateral asset */
  uint private _collateralFactor;

  uint private _borrowedAmounts;
  /// @notice decimals of the borrow asset
  uint public borrowRate;
  address public priceOracle;

  /// @dev block.number is a number of blocks passed since last borrow/repay
  ///      we set it manually
  uint private _passedBlocks;

  address public originConverter;

  /// @notice Last synced amount of given token on the balance of this contract
  mapping(address => uint) public reserveBalances;

  struct RewardsForUser {
    address rewardToken;
    uint rewardAmount;
  }
  mapping(address => RewardsForUser) public rewardsForUsers;

  ///////////////////////////////////////////////////////
  //  Check sequence of calls: syncBalance, borrow
  enum BorrowLogStates {
    DISABLED_0,
    ENABLED_1,
    SYNC_BALANCE_TRUE_TRUE_2,
    FINAL_BORROW_3
  }
  struct BorrowParamsLog {
    uint collateralAmount;
    uint borrowAmount;
    address receiver;
    uint collateralAmountTransferredToPoolAdapter;
  }
  BorrowLogStates public borrowLog;
  BorrowParamsLog public borrowParamsLog;



  ///////////////////////////////////////////////////////
  ///           Setup mock behavior
  ///////////////////////////////////////////////////////
  function setPassedBlocks(uint countPassedBlocks_) external {
    console.log("PoolAdapterMock.setPassedBlocks", _passedBlocks, countPassedBlocks_);
    _passedBlocks = countPassedBlocks_;
  }

  function changeCollateralFactor(uint collateralFactor_) external {
    console.log("PoolAdapterMock.changeCollateralFactor", _collateralFactor, collateralFactor_);
    _collateralFactor = collateralFactor_;
  }

  function changeBorrowRate(uint amountBorrowAsset_) external {
    console.log("PoolAdapterMock.changeBorrowRate", address(this), borrowRate, amountBorrowAsset_);
    borrowRate = amountBorrowAsset_;
  }

  /// @notice Start to record sequence of calls: syncBalance, borrow
  function enableBorrowLog(bool setEnabled_) external {
    borrowLog = setEnabled_
      ? BorrowLogStates.DISABLED_0
      : BorrowLogStates.ENABLED_1;
    delete borrowParamsLog;
  }

  function setRewards(address rewardToken_, uint amount_) external {
    console.log("PoolAdapterMock.setRewards _user", _user);
    console.log("PoolAdapterMock.setRewards rewardToken, amount", rewardToken_, amount_);
    rewardsForUsers[_user] = RewardsForUser({
      rewardToken: rewardToken_,
      rewardAmount: amount_
    });

    require(
      IERC20(rewardToken_).balanceOf(address(this)) == amount_,
      "Reward token wasn't transferred to pool-adapter-mock"
    );
  }

  ///////////////////////////////////////////////////////
  ///           Initialization
  ///  Constructor is not applicable, because this contract
  ///  is created using minimal-proxy pattern
  ///////////////////////////////////////////////////////

  function initialize(
    address controller_,
    address pool_,
    address user_,
    address collateralAsset_,
    address borrowAsset_,
    address originConverter_,
    address cTokenMock_,
    uint collateralFactor_,
    uint borrowRatePerBlockInBorrowTokens_,
    address priceOracle_
  ) external {
    console.log("PoolAdapterMock is initialized:", address(this));
    console.log("PoolAdapterMock.initialize controller=%s pool=%s user=%s", controller_, pool_, user_);
    controller = controller_;
    _pool = pool_;
    _user = user_;
    _collateralAsset = collateralAsset_;
    _borrowAsset = borrowAsset_;
    _cTokenMock = MockERC20(cTokenMock_);
    _collateralFactor = collateralFactor_;
    borrowRate = borrowRatePerBlockInBorrowTokens_;
    priceOracle = priceOracle_;
    originConverter = originConverter_;
  }

  ///////////////////////////////////////////////////////
  ///           Getters
  ///////////////////////////////////////////////////////
  function getConfig() external view override returns (
    address origin,
    address user,
    address collateralAsset,
    address borrowAsset
  ) {
    return (originConverter, _user, _collateralAsset, _borrowAsset);
  }

  function getStatus() external view override returns (
    uint collateralAmount,
    uint amountToPay,
    uint healthFactor18,
    bool opened
  ) {
    return _getStatus();
  }

  function _getStatus() internal view returns (
    uint collateralAmount,
    uint amountToPay,
    uint healthFactor18,
    bool opened
  ) {
    uint priceCollateral = getPrice18(_collateralAsset);
    uint priceBorrowedUSD = getPrice18(_borrowAsset);

    collateralAmount = _cTokenMock.balanceOf(address(this));
    amountToPay = _getAmountToRepay();

    uint8 decimalsCollateral = IERC20Extended(_collateralAsset).decimals();
    uint8 decimalsBorrow = IERC20Extended(_borrowAsset).decimals();

    console.log("amountToPay = %d", amountToPay);
    console.log("priceBorrowedUSD = %d", priceBorrowedUSD);

    healthFactor18 = amountToPay == 0
        ? type(uint).max
        : _collateralFactor
      * collateralAmount.toMantissa(decimalsCollateral, 18) * priceCollateral
      / (amountToPay.toMantissa(decimalsBorrow, 18) * priceBorrowedUSD);

    console.log("getStatus:");
    console.log("collateralAmount=%d", collateralAmount);
    console.log("amountToPay=%d", amountToPay);
    console.log("healthFactor18=%d", healthFactor18);

    return (
      collateralAmount,
      amountToPay,
      healthFactor18,
      collateralAmount != 0 || amountToPay != 0
    );
  }

  function getConversionKind() external pure override returns (AppDataTypes.ConversionKind) {
    return AppDataTypes.ConversionKind.BORROW_2;
  }

  function syncBalance(bool beforeBorrow, bool updateStatus_) external override {
    console.log("syncBalance beforeBorrow=%d", beforeBorrow ? 1 : 0);
    uint collateralBalance = IERC20(_collateralAsset).balanceOf(address(this));
    uint borrowBalance = IERC20(_borrowAsset).balanceOf(address(this));
    console.log("Pool adapter balances: collateral=%d, borrow=%d", collateralBalance, borrowBalance);

    reserveBalances[_collateralAsset] = collateralBalance;
    if (!beforeBorrow) {
      reserveBalances[_borrowAsset] = borrowBalance;
    }

    // ensure, that syncBalance(true, true) is called before the borrow
    if (borrowLog == BorrowLogStates.DISABLED_0) {
      if (beforeBorrow && updateStatus_) {
        borrowLog = BorrowLogStates.SYNC_BALANCE_TRUE_TRUE_2;
      }
    }
  }

  function updateStatus() external override {
    //_accumulateDebt(_getAmountToRepay() - _borrowedAmounts);
  }

  ///////////////////////////////////////////////////////
  ///           Borrow emulation
  ///////////////////////////////////////////////////////

  function borrow(
    uint collateralAmount_,
    uint borrowAmount_,
    address receiver_
  ) external override returns (uint) {
    // ensure, that borrow() is called after syncBalance(true, true) and after transferring given amount to the balance
    if (borrowLog == BorrowLogStates.SYNC_BALANCE_TRUE_TRUE_2) {
      uint collateralAmountTransferredToPoolAdapter =
        IERC20(_collateralAsset).balanceOf(address(this)) - reserveBalances[_collateralAsset];
      if (collateralAmount_ == collateralAmountTransferredToPoolAdapter) {
        borrowLog = BorrowLogStates.FINAL_BORROW_3;
      }
      borrowParamsLog = BorrowParamsLog({
        collateralAmount: collateralAmount_,
        borrowAmount: borrowAmount_,
        receiver: receiver_,
        collateralAmountTransferredToPoolAdapter: collateralAmountTransferredToPoolAdapter
      });
    }

    // ensure we have received expected collateral amount
    require(
      collateralAmount_ >= IERC20(_collateralAsset).balanceOf(address(this)) - reserveBalances[_collateralAsset],
      AppErrors.WRONG_COLLATERAL_BALANCE
    );

    // send the collateral to the pool
    IERC20(_collateralAsset).transfer(_pool, collateralAmount_);

    // mint ctokens and keep them on our balance
    uint amountCTokens = collateralAmount_; //TODO: exchange rate 1:1, it's not always true
    _cTokenMock.mint(address(this), amountCTokens);
    console.log("mint ctokens %s amount=%d to=%s", address(_cTokenMock), amountCTokens, address(this));

    // price of the collateral and borrowed token in USD
    uint priceCollateral = getPrice18(_collateralAsset);
    uint priceBorrowedUSD = getPrice18(_borrowAsset);

    // ensure that we can borrow allowed amount
    uint maxAmountToBorrowUSD = _collateralFactor
      * (collateralAmount_.toMantissa(IERC20Extended(_collateralAsset).decimals(), 18) * priceCollateral)
      / 1e18
      / 1e18;

    uint claimedAmount = borrowAmount_.toMantissa(IERC20Extended(_borrowAsset).decimals(), 18) * priceBorrowedUSD / 1e18;
    require(maxAmountToBorrowUSD >= claimedAmount, "borrow amount is too big");

    // send the borrow amount to the receiver
    PoolStub thePool = PoolStub(_pool);
    thePool.transferToReceiver(_borrowAsset, borrowAmount_, receiver_);
    _addBorrow(borrowAmount_);

    return borrowAmount_;
  }

  function borrowToRebalance(
    uint borrowAmount_,
    address receiver_
  ) external override returns (
    uint resultHealthFactor18,
    uint borrowedAmountOut
  ) {
    // let's assume here, that the pool always has enough borrow tokens

    // send the borrow amount to the receiver
    PoolStub thePool = PoolStub(_pool);
    thePool.transferToReceiver(_borrowAsset, borrowAmount_, receiver_);

    // increment the debt
    _addBorrow(borrowAmount_);

    // ensure that result health factor exceeds min allowed value
    (,, resultHealthFactor18,) = _getStatus();
    uint minAllowedHealthFactor18 = uint(IController(controller).minHealthFactor2()) * 10**(18-2);
    require(minAllowedHealthFactor18 < resultHealthFactor18, AppErrors.WRONG_HEALTH_FACTOR);

    return (resultHealthFactor18, borrowAmount_);
  }

  function _addBorrow(uint borrowedAmount_) internal {
    _accumulateDebt(borrowedAmount_);
    // send notification to the debt monitor
    IDebtMonitor dm = IDebtMonitor(IController(controller).debtMonitor());
    dm.onOpenPosition();
    console.log("_borrowedAmounts", _borrowedAmounts);
  }

  function _accumulateDebt(uint borrowedAmount_) internal {
    // accumulate exist debt and clear number of the passed blocks
    console.log("_accumulateDebt.1 to=%d add=%d + %d", _borrowedAmounts, _getAmountToRepay(), borrowedAmount_);
    _borrowedAmounts = _getAmountToRepay() + borrowedAmount_;
    _passedBlocks = 0;
  }

  ///////////////////////////////////////////////////////
  ///           Repay emulation
  ///////////////////////////////////////////////////////

  function repay(
    uint amountToRepay_,
    address receiver_,
    bool closePosition_
  ) external override returns (uint) {
    console.log("repay", amountToRepay_, _borrowedAmounts);
    require(amountToRepay_ > 0, "nothing to repay");
    // add debts to the borrowed amount
    _accumulateDebt(0);
    require(_borrowedAmounts >= amountToRepay_, "try to repay too much");
    console.log("_borrowedAmounts", _borrowedAmounts);

    // ensure that we have received enough money on our balance just before repay was called
    uint borrowAmountReceived = IERC20(_borrowAsset).balanceOf(address(this)) - reserveBalances[_borrowAsset];
    require(borrowAmountReceived == amountToRepay_, "not enough money received");

    // transfer borrow amount back to the pool
    IERC20(_borrowAsset).transfer(_pool, amountToRepay_);

    //return collateral
    console.log("_borrowedAmounts %s", _borrowedAmounts);
    console.log("amountReceivedBT %s", borrowAmountReceived);
    uint collateralBalance = _cTokenMock.balanceOf(address(this));
    uint collateralToReturn = _borrowedAmounts == borrowAmountReceived
      ? collateralBalance
      : collateralBalance * borrowAmountReceived / _borrowedAmounts;

    console.log("collateralBalance %d", collateralBalance);
    console.log("collateralToReturn %d", collateralToReturn);
    uint amountCTokens = collateralToReturn;
    console.log("amountCTokens %d", amountCTokens);
    _cTokenMock.burn(address(this), amountCTokens);

    PoolStub thePool = PoolStub(_pool);
    thePool.transferToReceiver(_collateralAsset, collateralToReturn, receiver_);

    // update status
    _borrowedAmounts -= borrowAmountReceived;

    if (closePosition_) {
      IDebtMonitor dm = IDebtMonitor(IController(controller).debtMonitor());
      dm.onClosePosition();
    }

    console.log("repay.done collateralToReturn=", collateralToReturn);
    return collateralToReturn;
  }

  function repayToRebalance(
    uint amount_,
    bool isCollateral_
  ) external override returns (
    uint resultHealthFactor18
  ) {
    require(amount_ > 0, "nothing to transfer");
    // add debts to the borrowed amount
    _accumulateDebt(0);
    require(isCollateral_ || _borrowedAmounts >= amount_, "try to repay too much");

    if (isCollateral_) {
      // ensure that we have received enough money on our balance just before repay was called
      uint collateralAssetBalance = IERC20(_collateralAsset).balanceOf(address(this));
      require(
        collateralAssetBalance == amount_,
        AppErrors.WRONG_AMOUNT_RECEIVED // same error as in the real pool adapters
      );

      // transfer additional collateral amount to the pool
      IERC20(_collateralAsset).transfer(_pool, amount_);
      // mint ctokens and keep them on our balance
      uint amountCTokens = amount_; //TODO: exchange rate 1:1, it's not always true
      _cTokenMock.mint(address(this), amountCTokens);
      console.log("mint ctokens %s amount=%d to=%s", address(_cTokenMock), amountCTokens, address(this));
    } else {
      // ensure that we have received enough money on our balance just before repay was called
      uint borrowAssetBalance = IERC20(_borrowAsset).balanceOf(address(this));
      require(
        borrowAssetBalance == amount_,
        AppErrors.WRONG_AMOUNT_RECEIVED // same error as in the real pool adapters
      );

      // transfer borrow amount back to the pool
      IERC20(_borrowAsset).transfer(_pool, amount_);

      // update status
      _borrowedAmounts -= borrowAssetBalance;
    }

    (,,uint healthFactor18,) = _getStatus();
    return healthFactor18;
  }

  ///////////////////////////////////////////////////////
  ///           Get-state functions
  ///////////////////////////////////////////////////////

  function _getAmountToRepay() internal view returns (uint) {
    console.log("_getAmountToRepay _borrowedAmounts=%d _borrowRates=%d _passedBlocks=%d", _borrowedAmounts, borrowRate, _passedBlocks);
    return _borrowedAmounts + borrowRate * _passedBlocks;
  }


  ///////////////////////////////////////////////////////
  ///           Utils
  ///////////////////////////////////////////////////////

  function getPrice18(address asset) internal view returns (uint) {
    console.log("getPrice18");
    IPriceOracle p = IPriceOracle(priceOracle);

    uint price18 = p.getAssetPrice(asset);
    console.log("getPrice18 %d", price18);
    return price18;
  }

  /// @notice Compute current cost of the money
  function getAPR18() external view override returns (int) {
    console.log("PoolAdapterMock address=", address(this));
    console.log("PoolAdapterMock br=", borrowRate);
    console.log("APR18 =", borrowRate);
    return int(borrowRate * 10**18 / IERC20Extended(_borrowAsset).decimals());
  }

  ///////////////////////////////////////////////////////
  ///                 Rewards
  ///////////////////////////////////////////////////////
  function hasRewards() external view override returns (bool ret) {
    ret = rewardsForUsers[_user].rewardToken != address(0);
    console.log("PoolAdapterMock.hasRewards sender", _user, ret);
    return ret;
  }

  function claimRewards(address receiver_) external override returns (
    address rewardTokenOut,
    uint amountOut
  ) {
    console.log("PoolAdapterMock.claimRewards user, receiver", _user, receiver_);
    console.log("PoolAdapterMock.rewardToken", rewardsForUsers[_user].rewardToken);
    console.log("PoolAdapterMock.rewardAmount", rewardsForUsers[_user].rewardAmount);

    IERC20(rewardsForUsers[_user].rewardToken).transfer(
      receiver_,
      rewardsForUsers[_user].rewardAmount
    );
    return (
      rewardsForUsers[_user].rewardToken,
      rewardsForUsers[_user].rewardAmount
    );
  }
}