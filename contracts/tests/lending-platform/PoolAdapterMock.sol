// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../interfaces/IPoolAdapter.sol";
import "hardhat/console.sol";
import "../../interfaces/IPriceOracle.sol";
import "../../openzeppelin/IERC20.sol";
import "../mocks/MockERC20.sol";
import "../../openzeppelin/IERC20Metadata.sol";
import "../../interfaces/IDebtMonitor.sol";
import "./PoolStub.sol";
import "../../interfaces/IConverterController.sol";
import "../../libs/AppErrors.sol";
import "../../libs/AppUtils.sol";
import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/Math.sol";

/// @notice It's rather emulator, not mock. Use PoolAdapterMock2 for mock tests
contract PoolAdapterMock is IPoolAdapter {
  using SafeERC20 for IERC20;
  using AppUtils for uint;

  //#region ----------------------------------------------------- Data types
  struct RewardsForUser {
    address rewardToken;
    uint rewardAmount;
  }

  struct BorrowParamsLog {
    uint collateralAmount;
    uint borrowAmount;
    address receiver;
  }
  //#endregion ----------------------------------------------------- Data types

  //#region ----------------------------------------------------- Variables
  address public controller;
  address private _pool;
  address private _user;
  address private _collateralAsset;
  address private _borrowAsset;

  MockERC20 private _cTokenMock;
  /// @notice Collateral factor (liquidation threshold) of the collateral asset
  uint private _collateralFactor;

  uint private _borrowedAmounts;
  /// @notice decimals of the borrow asset
  uint public borrowRate;
  address public priceOracle;

  /// @dev block.number is a number of blocks passed since last borrow/repay; we set it manually
  uint private _passedBlocks;
  address public originConverter;
  bool internal _debtGapRequired;

  mapping(address => RewardsForUser) public rewardsForUsers;
  BorrowParamsLog public borrowParamsLog;
  //#endregion ----------------------------------------------------- Variables

  //#region ----------------------------------------------------- Setup mock behavior
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

  function setDebtGapRequired(bool debtGapRequired_) external {
    console.log("setDebtGapRequired", debtGapRequired_);
    _debtGapRequired = debtGapRequired_;
  }

  /// @notice Imitate closing the debt by resetting collateral and borrow amounts
  function resetTheDebtForcibly() external {
    _borrowedAmounts = 0;
    uint balance = _cTokenMock.balanceOf(address(this));
    if (balance != 0) {
      _cTokenMock.burn(address(this), balance);
    }
  }
  //#endregion ----------------------------------------------------- Setup mock behavior

  //#region ----------------------------------------------------- Initialization
  ///  Constructor is not applicable, because this contract
  ///  is created using minimal-proxy pattern
  //-----------------------------------------------------

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
  //#endregion ----------------------------------------------------- Initialization

  //#region ----------------------------------------------------- Getters

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
    bool opened,
    uint collateralAmountLiquidated,
    bool debtGapRequired
  ) {
    return _getStatus();
  }

  function _getStatus() internal view returns (
    uint collateralAmount,
    uint amountToPay,
    uint healthFactor18,
    bool opened,
    uint collateralAmountLiquidated,
    bool debtGapRequired_
  ) {
    uint priceCollateral = getPrice18(_collateralAsset);
    uint priceBorrowedUSD = getPrice18(_borrowAsset);

    collateralAmount = _cTokenMock.balanceOf(address(this));
    amountToPay = _getAmountToRepay();

    uint8 decimalsCollateral = IERC20Metadata(_collateralAsset).decimals();
    uint8 decimalsBorrow = IERC20Metadata(_borrowAsset).decimals();

    healthFactor18 = amountToPay == 0
        ? type(uint).max
        : _collateralFactor
      * collateralAmount.toMantissa(decimalsCollateral, 18) * priceCollateral
      / (amountToPay.toMantissa(decimalsBorrow, 18) * priceBorrowedUSD);

//    console.log("_getStatus.this", address(this));
    console.log("_getStatus.collateralAmount = %d", collateralAmount);
    console.log("_getStatus.amountToPay = %d", amountToPay);
    console.log("_getStatus.priceBorrowedUSD = %d", priceBorrowedUSD);
    console.log("_getStatus.priceCollateral = %d", priceCollateral);
    console.log("getStatus.healthFactor18=%d", healthFactor18);

    return (
      collateralAmount,
      amountToPay,
      healthFactor18,
      collateralAmount != 0 || amountToPay != 0,
      0, // !TODO
      _debtGapRequired
    );
  }

  function getConversionKind() external pure override returns (AppDataTypes.ConversionKind) {
    return AppDataTypes.ConversionKind.BORROW_2;
  }

  function updateStatus() external override {
    //_accumulateDebt(_getAmountToRepay() - _borrowedAmounts);
  }
  //#endregion ----------------------------------------------------- Getters

  //#region ----------------------------------------------------- Borrow emulation

  function borrow(
    uint collateralAmount_,
    uint borrowAmount_,
    address receiver_
  ) external override returns (uint) {
    console.log("PoolAdapterMock.borrow.borrowAmount_", borrowAmount_);
    console.log("PoolAdapterMock.borrow.collateralAmount_", collateralAmount_);
    borrowParamsLog = BorrowParamsLog({
      collateralAmount: collateralAmount_,
      borrowAmount: borrowAmount_,
      receiver: receiver_
    });

    IERC20(_collateralAsset).safeTransferFrom(msg.sender, address(this), collateralAmount_);
    console.log("PoolAdapterMock.borrow.1");
    // send the collateral to the pool
    IERC20(_collateralAsset).transfer(_pool, collateralAmount_);
    console.log("PoolAdapterMock.borrow.2");

    // mint ctokens and keep them on our balance
    uint amountCTokens = collateralAmount_; //TODO: exchange rate 1:1, it's not always true
    _cTokenMock.mint(address(this), amountCTokens);
    console.log("mint ctokens %s amount=%d to=%s", address(_cTokenMock), amountCTokens, address(this));

    // price of the collateral and borrowed token in USD
    uint priceCollateral = getPrice18(_collateralAsset);
    uint priceBorrowedUSD = getPrice18(_borrowAsset);

    // ensure that we can borrow allowed amount
    uint maxAmountToBorrowUSD = _collateralFactor
      * (collateralAmount_.toMantissa(IERC20Metadata(_collateralAsset).decimals(), 18) * priceCollateral)
      / 1e18
      / 1e18;

    uint claimedAmount = borrowAmount_.toMantissa(IERC20Metadata(_borrowAsset).decimals(), 18) * priceBorrowedUSD / 1e18;
    console.log("claimedAmount", claimedAmount);
    console.log("maxAmountToBorrowUSD", maxAmountToBorrowUSD);
    console.log("_collateralFactor", _collateralFactor);
    console.log("collateralAmount_", collateralAmount_);

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
    (,, resultHealthFactor18,,,) = _getStatus();
    uint minAllowedHealthFactor18 = uint(IConverterController(controller).minHealthFactor2()) * 10**(18-2);
    require(minAllowedHealthFactor18 < resultHealthFactor18, AppErrors.WRONG_HEALTH_FACTOR);

    return (resultHealthFactor18, borrowAmount_);
  }

  function _addBorrow(uint borrowedAmount_) internal {
    _accumulateDebt(borrowedAmount_);
    // send notification to the debt monitor
    IDebtMonitor dm = IDebtMonitor(IConverterController(controller).debtMonitor());
    dm.onOpenPosition();
    console.log("_borrowedAmounts", _borrowedAmounts);
  }

  function _accumulateDebt(uint borrowedAmount_) internal {
    // accumulate exist debt and clear number of the passed blocks
    console.log("_accumulateDebt.1 to=%d add=%d + %d", _borrowedAmounts, _getAmountToRepay(), borrowedAmount_);
    _borrowedAmounts = _getAmountToRepay() + borrowedAmount_;
    _passedBlocks = 0;
  }
  //#endregion ----------------------------------------------------- Borrow emulation

  //#region ----------------------------------------------------- Repay emulation

  function repay(
    uint amountToRepay_,
    address receiver_,
    bool closePosition_
  ) external override returns (uint) {
    console.log("repay", amountToRepay_, _borrowedAmounts);
    require(amountToRepay_ > 0, "nothing to repay");

    // add debts to the borrowed amount
    _accumulateDebt(0);
    // require(_borrowedAmounts >= amountToRepay_, "try to repay too much");
    console.log("_borrowedAmounts", _borrowedAmounts);

    IERC20(_borrowAsset).safeTransferFrom(msg.sender, address(this), amountToRepay_);

    // transfer borrow amount back to the pool
    uint amountToRepay = Math.min(amountToRepay_, _borrowedAmounts);
    IERC20(_borrowAsset).transfer(_pool, amountToRepay);

    //return collateral
    console.log("_borrowedAmounts %s", _borrowedAmounts);
    uint collateralBalance = _cTokenMock.balanceOf(address(this));
    uint collateralToReturn = _borrowedAmounts == amountToRepay
      ? collateralBalance
      : collateralBalance * amountToRepay / _borrowedAmounts;

    console.log("collateralBalance %d", collateralBalance);
    console.log("collateralToReturn %d", collateralToReturn);
    uint amountCTokens = collateralToReturn;
    console.log("amountCTokens %d", amountCTokens);
    _cTokenMock.burn(address(this), amountCTokens);

    PoolStub thePool = PoolStub(_pool);
    thePool.transferToReceiver(_collateralAsset, collateralToReturn, receiver_);

    // update status
    _borrowedAmounts -= amountToRepay;

    uint balanceAfter = IERC20(_borrowAsset).balanceOf(address(this));
    if (balanceAfter != 0) {
      IERC20(_borrowAsset).transfer(msg.sender, balanceAfter);
    }

    if (closePosition_) {
      IDebtMonitor dm = IDebtMonitor(IConverterController(controller).debtMonitor());
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
    console.log("repayToRebalance.amount", amount_);
    console.log("repayToRebalance.ctoken.balance", _cTokenMock.balanceOf(address(this)));
    require(amount_ > 0, "nothing to transfer");
    // add debts to the borrowed amount
    _accumulateDebt(0);
    require(isCollateral_ || _borrowedAmounts >= amount_, "try to repay too much");

    if (isCollateral_) {
      IERC20(_collateralAsset).safeTransferFrom(msg.sender, address(this), amount_);
      IERC20(_collateralAsset).transfer(_pool, amount_);
      // mint ctokens and keep them on our balance
      uint amountCTokens = amount_; //TODO: exchange rate 1:1, it's not always true
      _cTokenMock.mint(address(this), amountCTokens);
      console.log("mint ctokens %s amount=%d to=%s", address(_cTokenMock), amountCTokens, address(this));
      console.log("repayToRebalance.ctoken.balance", _cTokenMock.balanceOf(address(this)));
    } else {
      IERC20(_borrowAsset).safeTransferFrom(msg.sender, address(this), amount_);
      IERC20(_borrowAsset).transfer(_pool, amount_);

      // update status
      _borrowedAmounts -= amount_;
    }

    (,,uint healthFactor18,,,) = _getStatus();
    return healthFactor18;
  }

  function getCollateralAmountToReturn(uint amountToRepay_, bool closePosition_) external view override returns (uint) {
    closePosition_;
    uint collateralBalance = _cTokenMock.balanceOf(address(this));
    return _borrowedAmounts == amountToRepay_
      ? collateralBalance
      : collateralBalance * amountToRepay_ / _borrowedAmounts;
  }
  //#endregion ----------------------------------------------------- Repay emulation

  //#region ----------------------------------------------------- Get-state functions

  function _getAmountToRepay() internal view returns (uint) {
    console.log("_getAmountToRepay _borrowedAmounts=%d _borrowRates=%d _passedBlocks=%d", _borrowedAmounts, borrowRate, _passedBlocks);
    return _borrowedAmounts + borrowRate * _passedBlocks;
  }
  //#endregion ----------------------------------------------------- Get-state functions


  //#region ----------------------------------------------------- Utils

  function getPrice18(address asset) internal view returns (uint) {
    // console.log("getPrice18");
    IPriceOracle p = IPriceOracle(priceOracle);

    uint price18 = p.getAssetPrice(asset);
    // console.log("getPrice18 %d", price18);
    return price18;
  }

//  /// @notice Compute current cost of the money
//  function getAPR18() external view override returns (int) {
//    console.log("PoolAdapterMock address=", address(this));
//    console.log("PoolAdapterMock br=", borrowRate);
//    console.log("APR18 =", borrowRate);
//    return int(borrowRate * 10**18 / IERC20Metadata(_borrowAsset).decimals());
//  }
  //#endregion ----------------------------------------------------- Utils

  //#region ----------------------------------------------------- Rewards
  function claimRewards(address receiver_) external override returns (
    address rewardTokenOut,
    uint amountOut
  ) {
    console.log("PoolAdapterMock.claimRewards user, receiver", _user, receiver_);
    if (rewardsForUsers[_user].rewardToken != address(0)) {
      console.log("PoolAdapterMock.rewards balance of mock", IERC20(rewardsForUsers[_user].rewardToken).balanceOf(address(this)));
      console.log("PoolAdapterMock.rewardToken", rewardsForUsers[_user].rewardToken);
      console.log("PoolAdapterMock.rewardAmount", rewardsForUsers[_user].rewardAmount);

      IERC20(rewardsForUsers[_user].rewardToken).transfer(
        receiver_,
        rewardsForUsers[_user].rewardAmount
      );
    }
    return (
      rewardsForUsers[_user].rewardToken,
      rewardsForUsers[_user].rewardAmount
    );
  }
  //#endregion ----------------------------------------------------- Rewards

}
