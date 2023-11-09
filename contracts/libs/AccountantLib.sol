// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../openzeppelin/IERC20.sol";
import "../openzeppelin/SafeERC20.sol";
import "../openzeppelin/EnumerableSet.sol";
import "../openzeppelin/Math.sol";
import "../openzeppelin/IERC20Metadata.sol";
import "../interfaces/IAccountant.sol";
import "../libs/AppUtils.sol";
import "hardhat/console.sol";
import "../proxy/ControllableV3.sol";
import "../interfaces/IPoolAdapter.sol";
import "../interfaces/IBorrowManager.sol";
import "../interfaces/IPriceOracle.sol";
import "../libs/AccountantLib.sol";

library AccountantLib {
  using SafeERC20 for IERC20;
  using AppUtils for uint;
  using EnumerableSet for EnumerableSet.AddressSet;

  //region ----------------------------------------------------- Data types
  struct BaseState {
    /// @notice Counter of the periods
    uint period;

    /// @notice pool adapter => current state
    mapping(address => AccountantLib.PoolAdapterState) states;

    /// @notice pool adapter => gains and losses info
    mapping(address => AccountantLib.FixedValues[]) fixedValues;

    /// @notice User of the pool adapter => list of pool adapters with not zero debts in the current period
    mapping(address => EnumerableSet.AddressSet) poolAdaptersPerUser;

    /// @notice pool adapter => checkpoint
    mapping(address => AccountantLib.PoolAdapterCheckpoint) checkpoints;
  }

  /// @notice State of the pool adapter. The state is updated after each borrow/repay
  struct PoolAdapterState {
    /// @notice Current total amount supplied by the user as a collateral
    uint suppliedAmount;
    /// @notice Current total borrowed amount
    uint borrowedAmount;

    /// @notice Current total amount of collateral registered on the lending platform
    uint lastTotalCollateral; // todo remove?
    /// @notice Current total debt registered on the lending platform
    uint lastTotalDebt; // todo remove?
  }

  /// @notice Fixed loss/gain received on repay
  struct FixedValues {
    /// @notice Gain (received for supplied amount) registered in the current period, in terms of collateral asset
    int gain;
    /// @notice Losses (paid for the borrowed amount) registered in the current period, in terms of borrow asset
    int loss;
    /// @notice [price of collateral, price of borrow asset], decimals 18 (USD/Token)
    uint[2] prices;
  }

  /// @notice Checkpoint save current state of user's account on lending platform.
  ///         Difference between checkpoints allow user to calculate increase in debt between checkpoints.
  ///         It allows to separate two kinds of the increase in debt:
  ///         1) increase in debt because some time has passed and debt was increased according borrow rate
  ///         2) increase in debt becuase prices were changed
  struct PoolAdapterCheckpoint {
    /// @notice Total amount supplied by the user as a collateral
    uint suppliedAmount;
    /// @notice Total borrowed amount
    uint borrowedAmount;

    /// @notice Amount of collateral registered on the lending platform
    uint totalCollateral;
    /// @notice Amount of debt registered on the lending platform
    uint totalDebt;

    /// @notice Amount of already received gain during current period, in terms of collateral asset
    int fixedCollateralGain;
    /// @notice Amount of already paid debt-losses during current period, in terms of borrow asset
    int fixedDebtLoss;

    /// @notice Count fixed values at the moment of checkpoint creation
    uint countFixedValues;
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
    address collateralAsset;
    address borrowAsset;
  }
  //endregion ----------------------------------------------------- Data types

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
    int gain,
    int losses,
    int gainInUnderlying,
    int lossesInUnderlying
  );
  //endregion ----------------------------------------------------- Events

  //region ----------------------------------------------------- Checkpoint logic
  /// @notice Save checkpoint for the given {poolAdapter_} for the current moment
  function checkpoint(IPoolAdapter poolAdapter_, BaseState storage state_) internal returns (
    int deltaGain,
    int deltaLoss
  ) {
    (uint totalCollateral, uint totalDebt, , , , ) = poolAdapter_.getStatus();
    PoolAdapterState memory state = state_.states[address(poolAdapter_)];
    PoolAdapterCheckpoint memory c = state_.checkpoints[address(poolAdapter_)];
    FixedValues[] memory ff = state_.fixedValues[address(poolAdapter_)];

    deltaGain = int(totalCollateral) - int(c.totalCollateral);
    deltaLoss = int(totalDebt) - int(c.totalDebt);

    state_.checkpoints[address(poolAdapter_)] = PoolAdapterCheckpoint({
      totalDebt: c.totalDebt,
      totalCollateral: c.totalCollateral,
      borrowedAmount: state.borrowedAmount,
      suppliedAmount: state.suppliedAmount,
      countFixedValues: ff.length,
      fixedDebtLoss: 0, // todo
      fixedCollateralGain: 0 // todo
    });

    return (deltaGain, deltaLoss);
  }
  //endregion ----------------------------------------------------- Checkpoint logic

  //region ----------------------------------------------------- OnBorrow, OnRepay logic
  /// @notice Register a new loan
  /// @param collateralAmount Amount of supplied collateral for the new loan
  /// @param borrowedAmount Borrowed amount provided for the given {collateralAmount}
  function onBorrow(
    BaseState storage state_,
    IConverterController controller_,
    IPoolAdapter poolAdapter_,
    uint collateralAmount,
    uint borrowedAmount
  ) internal {
    (, address user, , ) = poolAdapter_.getConfig();

    (uint totalCollateral, uint totalDebt,,,,) = poolAdapter_.getStatus();

    PoolAdapterState memory state = state_.states[msg.sender];

    state_.states[msg.sender] = PoolAdapterState({
      suppliedAmount: state.suppliedAmount + collateralAmount,
      borrowedAmount: state.borrowedAmount + borrowedAmount,
      lastTotalCollateral: totalCollateral,
      lastTotalDebt: totalDebt
    });

    state_.poolAdaptersPerUser[user].add(msg.sender);
    emit OnBorrow(address(poolAdapter_), collateralAmount, borrowedAmount);
  }

  /// @notice Register loan payment
  /// @param withdrawnCollateral Amount of collateral received by the user during the repaying.
  /// @param paidAmount Amount paid by the user during the repaying.
  function onRepay(BaseState storage state_, IPoolAdapter poolAdapter, uint withdrawnCollateral, uint paidAmount) internal {
//    OnRepayLocal memory v;
//    v.poolAdapter = IPoolAdapter(msg.sender);
//    (, v.user, v.collateralAsset, v.borrowAsset) = v.poolAdapter.getConfig();
//    (v.totalCollateral, v.totalDebt,,,,) = v.poolAdapter.getStatus();
//
//    PoolAdapterState memory state = _states[msg.sender];
//    // todo require debt is not zero ???
//    v.debtRatio = Math.min(1e18, 1e18 * paidAmount / (v.totalDebt + paidAmount));
//    v.collateralRatio = Math.min(1e18, 1e18 * withdrawnCollateral / (v.totalCollateral + withdrawnCollateral));
//
//    v.debt = state.borrowedAmount * v.debtRatio / 1e18;
//    v.collateral = state.suppliedAmount * v.collateralRatio / 1e18;
//
//    _states[msg.sender] = PoolAdapterState({
//      borrowedAmount: state.borrowedAmount - v.debt,
//      suppliedAmount: state.suppliedAmount - v.collateral,
//      lastTotalCollateral: v.totalCollateral,
//      lastTotalDebt: v.totalDebt
//    });
//
//    int gain = int(withdrawnCollateral) - int(v.collateral);
//    int loss = int(paidAmount) - int(v.debt);
//
//    address _underlying = underlying;
//    IPriceOracle priceOracle = IPriceOracle(v.controller.priceOracle());
//    uint priceUnderlying = priceOracle.getAssetPrice(_underlying);
//    int gainInUnderlying = _underlying == v.collateralAsset
//      ? gain
//      : gain * int(priceOracle.getAssetPrice(v.collateralAsset) * 10 ** IERC20Metadata(_underlying).decimals())
//      / int(priceUnderlying * 10 ** IERC20Metadata(v.collateralAsset).decimals());
//    int lossInUnderlying = _underlying == v.borrowAsset
//      ? loss
//      : loss * int(priceOracle.getAssetPrice(v.borrowAsset) * 10 ** IERC20Metadata(_underlying).decimals())
//      / int(priceUnderlying * 10 ** IERC20Metadata(v.borrowAsset).decimals());
//
//    FixedValues memory prev = _fixedValues[v.user];
//    _fixedValues[v.user] = FixedValues({
//      lossInUnderlying: prev.lossInUnderlying + lossInUnderlying,
//      gainInUnderlying: prev.gainInUnderlying + gainInUnderlying
//    });
//
//    _poolAdaptersPerUser[v.user].add(msg.sender);
//    emit OnRepay(address(v.poolAdapter), withdrawnCollateral, paidAmount, gain, loss, gainInUnderlying, lossInUnderlying);
  }
  //endregion ----------------------------------------------------- OnBorrow, OnRepay logic

}

