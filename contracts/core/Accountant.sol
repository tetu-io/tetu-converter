// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../openzeppelin/IERC20.sol";
import "../openzeppelin/SafeERC20.sol";
import "../openzeppelin/EnumerableSet.sol";
import "../openzeppelin/Math.sol";
import "../interfaces/IAccountant.sol";
import "../libs/AppUtils.sol";
import "hardhat/console.sol";
import "../proxy/ControllableV3.sol";
import "../interfaces/IPoolAdapter.sol";
import "../interfaces/IBorrowManager.sol";

/// @notice Calculate amounts of losses and gains for debts/supply for all pool adapters
contract Accountant is IAccountant, ControllableV3 {
  using SafeERC20 for IERC20;
  using AppUtils for uint;
  using EnumerableSet for EnumerableSet.AddressSet;

  //region ----------------------------------------------------- Constants
  string public constant ACCOUNTANT_VERSION = "1.0.0";
  //endregion ----------------------------------------------------- Constants

  //region ----------------------------------------------------- Data types
  struct PoolAdapterState {
    /// @notice Current total amount supplied by the user as a collateral
    uint suppliedAmount;
    /// @notice Current total borrowed amount
    uint borrowedAmount;

    /// @notice Current total amount of collateral registered on the lending platform
    uint lastTotalCollateral;
    /// @notice Current total debt registered on the lending platform
    uint lastTotalDebt;
  }

  struct GainLossInfo {
    /// @notice Gain (received for supplied amount) registered in the current period, in terms of underlying
    int gain;
    /// @notice Losses (paid for the borrowed amount) registered in the current period, in terms of underlying
    int losses;
  }

  struct OnRepayLocal {
    IConverterController controller;
    IBorrowManager borrowManager;
    IPoolAdapter poolAdapter;
    address user;
    uint totalCollateral;
    uint totalDebt;
    uint debtRatio;
    uint collateralRatio;
    uint debt;
    uint collateral;
  }
  //endregion ----------------------------------------------------- Data types

  //region ----------------------------------------------------- Variables
  /// @notice Counter of the periods
  uint public period;

  /// @notice pool adapter => current state
  mapping(address => PoolAdapterState) internal _states;

  /// @notice pool adapter => gains and losses info
  mapping(address => GainLossInfo) internal _losses;

  /// @notice User of the pool adapter => list of pool adapters with not zero debts in the current period
  mapping(address => EnumerableSet.AddressSet) private _poolAdaptersPerUser;
  //endregion ----------------------------------------------------- Variables

  //region ----------------------------------------------------- Events
  event OnBorrow(address poolAdapter, uint collateralAmount, uint borrowedAmount);

  /// @param gain Gain in terms of collateral
  /// @param losses Losses in terms of borrow asset
  /// @param gainInUnderlying Gain in terms of underlying
  /// @param lossesInUnderlying Losses in terms of underlying
  event OnRepay(
    address poolAdapter,
    uint withdrawnCollateral,
    uint paidAmount,
    uint gain,
    uint losses,
    uint gainInUnderlying,
    uint lossesInUnderlying
  );
  //endregion ----------------------------------------------------- Events

  //region ----------------------------------------------------- Initialization
  function init(address controller_) external initializer {
    __Controllable_init(controller_);
  }
  //endregion ----------------------------------------------------- Initialization

  //region ----------------------------------------------------- OnBorrow, OnRepay
  /// @notice Register a new loan
  /// @param collateralAmount Amount of supplied collateral for the new loan
  /// @param borrowedAmount Borrowed amount provided for the given {collateralAmount}
  function onBorrow(uint collateralAmount, uint borrowedAmount) external {
    IConverterController _controller = IConverterController(controller());
    IBorrowManager borrowManager = IBorrowManager(_controller.borrowManager());
    require(borrowManager.isPoolAdapter(msg.sender), AppErrors.POOL_ADAPTER_NOT_FOUND);

    IPoolAdapter pa = IPoolAdapter(msg.sender);
    (, address user, , ) = pa.getConfig();

    (uint totalCollateral, uint totalDebt,,,,) = pa.getStatus();

    console.log("onBorrow");

    PoolAdapterState memory state = _states[msg.sender];
    console.log("onBorrow.state.suppliedAmount", state.suppliedAmount);
    console.log("onBorrow.state.borrowedAmount", state.borrowedAmount);
    console.log("onBorrow.state.lastTotalCollateral", state.lastTotalCollateral);
    console.log("onBorrow.state.lastTotalDebt", state.lastTotalDebt);

    _states[msg.sender] = PoolAdapterState({
      suppliedAmount: state.suppliedAmount + collateralAmount,
      borrowedAmount: state.borrowedAmount + borrowedAmount,
      lastTotalCollateral: totalCollateral,
      lastTotalDebt: totalDebt
    });

    console.log("onBorrow.2.state.suppliedAmount", _states[msg.sender].suppliedAmount);
    console.log("onBorrow.2.state.borrowedAmount", _states[msg.sender].borrowedAmount);
    console.log("onBorrow.2.state.lastTotalCollateral", _states[msg.sender].lastTotalCollateral);
    console.log("onBorrow.2.state.lastTotalDebt", _states[msg.sender].lastTotalDebt);

    _poolAdaptersPerUser[user].add(msg.sender);
  }

  /// @notice Register loan payment
  /// @param withdrawnCollateral Amount of collateral received by the user during the repaying.
  /// @param paidAmount Amount paid by the user during the repaying.
  function onRepay(uint withdrawnCollateral, uint paidAmount) external {
    OnRepayLocal memory v;

    v.controller = IConverterController(controller());
    v.borrowManager = IBorrowManager(v.controller.borrowManager());

    // onRepay is allowed for registered platform adapters only
    // if some dirty (de-registered) pool adapter will try to call onRepay
    // we shouldn't prevent its attempt to make repay but
    // it's too dangerous to take results into account here because a malicious contract can try to give us wrong data
    // so, no revert, silent ignore

    if (v.borrowManager.isPoolAdapter(msg.sender)) {
      v.poolAdapter = IPoolAdapter(msg.sender);
      (, v.user, , ) = v.poolAdapter.getConfig();
      (v.totalCollateral, v.totalDebt,,,,) = v.poolAdapter.getStatus();

      PoolAdapterState memory state = _states[msg.sender];
      // todo require debt is not zero ???
      console.log("onRepay.1.state.suppliedAmount", state.suppliedAmount);
      console.log("onRepay.1.state.borrowedAmount", state.borrowedAmount);
      console.log("onRepay.1.state.lastTotalCollateral", state.lastTotalCollateral);
      console.log("onRepay.1.state.lastTotalDebt", state.lastTotalDebt);

      v.debtRatio = Math.min(1e18, 1e18 * paidAmount / (v.totalDebt + paidAmount));
      v.collateralRatio = Math.min(1e18, 1e18 * withdrawnCollateral / (v.totalCollateral + withdrawnCollateral));

      v.debt = state.borrowedAmount * v.debtRatio / 1e18;
      v.collateral = state.suppliedAmount * v.collateralRatio / 1e18;

      console.log("onRepay.debtRatio", v.debtRatio);
      console.log("onRepay.collateralRatio", v.collateralRatio);
      console.log("onRepay.debt", v.debt);
      console.log("onRepay.collateral", v.collateral);

      _states[msg.sender] = PoolAdapterState({
        borrowedAmount: state.borrowedAmount - v.debt,
        suppliedAmount: state.suppliedAmount - v.collateral,
        lastTotalCollateral: v.totalCollateral,
        lastTotalDebt: v.totalDebt
      });

      int gain = int(withdrawnCollateral) - int(v.collateral);
      int losses = int(paidAmount) - int(v.debt);

      int gainInUnderlying = gain; // todo
      int lossesInUnderlying = losses; // todo

      GainLossInfo memory prev = _losses[v.user];
      _losses[v.user] = GainLossInfo({
        losses: prev.losses + losses,
        gain: prev.gain + gain
      });

      console.log("onRepay.gain");console.logInt(gain);
      console.log("onRepay.losses");console.logInt(losses);

      console.log("onRepay.2.state.suppliedAmount", _states[msg.sender].suppliedAmount);
      console.log("onRepay.2.state.borrowedAmount", _states[msg.sender].borrowedAmount);
      console.log("onRepay.2.state.lastTotalCollateral", _states[msg.sender].lastTotalCollateral);
      console.log("onRepay.2.state.lastTotalDebt", _states[msg.sender].lastTotalDebt);

      _poolAdaptersPerUser[v.user].add(msg.sender);
    }
  }
  //endregion ----------------------------------------------------- OnBorrow, OnRepay

  //region ----------------------------------------------------- Logic for period
  /// @notice Start new period of collecting of gains and losses.
  ///         Set current total gains and total losses for each pool adapter to zero.
  ///         Remove pool adapters with zero debts from the user.
  /// @return totalGain Total amount of collateral earned by the pool adapters in the previous period,
  ///                   in terms of underlying
  /// @return totalLosses Total loan repayment losses in terms of borrowed amount in the previous period,
  ///                     in terms of underlying
  function startNewPeriod(address user) external returns (int totalGain, int totalLosses) {
    period += 1;

    uint countPoolAdapters = _poolAdaptersPerUser[user].length();
    for (uint i = countPoolAdapters; i > 0; i--) {
      address poolAdapter = _poolAdaptersPerUser[user].at(i - 1);
      GainLossInfo memory lossInfo = _losses[poolAdapter];
      totalGain += lossInfo.gain;
      totalLosses += lossInfo.losses;
      (,,, bool opened, ,) = IPoolAdapter(poolAdapter).getStatus();
      if (! opened) {
        delete _losses[poolAdapter];
        delete _states[poolAdapter];
        _poolAdaptersPerUser[user].remove(poolAdapter);
      }
    }
    return (totalGain, totalLosses);
  }

  /// @notice Get current state of the given pool adapter
  /// @return totalGain Total amount of collateral earned by the loan in the current period, in terms of underlying.
  ///                   Positive means profit.
  /// @return totalLosses Total loan repayment losses in the current period, in terms of underlying.
  ///                     Positive means losses.
  /// @return suppliedAmount Current total amount supplied by the user as a collateral
  /// @return borrowedAmount Current total borrowed amount
  /// @return lastTotalCollateral Current total amount of collateral registered on the lending platform
  /// @return lastTotalDebt Current total debt registered on the lending platform
  function getPoolAdapterState(address poolAdapter) external view returns (
    int totalGain,
    int totalLosses,
    uint suppliedAmount,
    uint borrowedAmount,
    uint lastTotalCollateral,
    uint lastTotalDebt
  ) {
    PoolAdapterState memory state = _states[poolAdapter];
    GainLossInfo memory lossInfo = _losses[poolAdapter];

    return (
      lossInfo.gain,
      lossInfo.losses,
      state.suppliedAmount,
      state.borrowedAmount,
      state.lastTotalCollateral,
      state.lastTotalDebt
    );
  }

  /// @notice Get current state of the given user (== strategy, the user of pool adapters)
  /// @return countPoolAdapters Current count of pool adapters
  /// @return totalGain Total amount of collateral earned by the pool adapters in the current period,
  ///                   in terms of underlying
  /// @return totalLosses Total loan repayment losses in terms of borrowed amount in the current period,
  ///                     in terms of underlying
  function getStateForPeriod(address user) external view returns (
    uint countPoolAdapters,
    int totalGain,
    int totalLosses
  ) {
    countPoolAdapters = _poolAdaptersPerUser[user].length();
    for (uint i; i < countPoolAdapters; ++i) {
      address poolAdapter = _poolAdaptersPerUser[user].at(i);
      GainLossInfo memory lossInfo = _losses[poolAdapter];
      totalGain += lossInfo.gain;
      totalLosses += lossInfo.losses;
    }
    return (countPoolAdapters, totalGain, totalLosses);
  }
  //endregion ----------------------------------------------------- Logic for period

  //region ----------------------------------------------------- Utils
  function poolAdaptersPerUserLength(address user) external view returns (uint) {
    return _poolAdaptersPerUser[user].length();
  }
  function poolAdaptersPerUserAt(address user, uint index) external view returns (address) {
    return _poolAdaptersPerUser[user].at(index);
  }
  //endregion ----------------------------------------------------- View

}