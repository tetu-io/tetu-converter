// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../openzeppelin/IERC20.sol";
import "../openzeppelin/SafeERC20.sol";
import "../openzeppelin/EnumerableSet.sol";
import "../openzeppelin/Math.sol";
import "../openzeppelin/IERC20Metadata.sol";
import "../proxy/ControllableV3.sol";
import "../interfaces/IBookkeeper.sol";
import "../interfaces/IPoolAdapter.sol";
import "../interfaces/IBorrowManager.sol";
import "../interfaces/IPriceOracle.sol";
import "../libs/AppUtils.sol";
import "../libs/BookkeeperLib.sol";
import "../interfaces/IDebtMonitor.sol";

library BookkeeperLib {
  using SafeERC20 for IERC20;
  using AppUtils for uint;
  using EnumerableSet for EnumerableSet.AddressSet;

  //region ----------------------------------------------------- Data types
  enum ActionKind {
    /// @notice Pool adapter has made a new borrow
    BORROW_0,
    /// @notice Pool adapter has made a partial or full repayment
    REPAY_1
  }

  struct BaseState {
    /// @notice pool adapter => info about borrow/repay actions
    mapping(address => BookkeeperLib.Action[]) actions;

    /// @notice User of the pool adapter => list of pool adapters with not zero debts in the current period
    mapping(address => EnumerableSet.AddressSet) poolAdaptersPerUser;

    /// @notice pool adapter => checkpoint
    mapping(address => BookkeeperLib.PoolAdapterCheckpoint) checkpoints;

    /// @notice pool adapter => index of the repay-action in actions => RepayInfo
    mapping(address => mapping(uint => RepayInfo)) repayInfo;

    /// @notice pool adapter => length of actions array at the moment of start of the period
    mapping(address => uint[]) periods;
  }

  /// @notice Borrow or repay action
  struct Action {
    /// @notice Action kind. There is additional info for repays in {repayInfo}
    ActionKind actionKind;
    /// @notice Total amount supplied by the user as a collateral after the action
    uint suppliedAmount;
    /// @notice Total borrowed amount after the action
    uint borrowedAmount;
  }

  /// @notice Received gain and paid debt-loss amounts for the given repay-action together with current prices
  struct RepayInfo {
    /// @notice Gain (received for supplied amount) received at the current action, in terms of collateral asset
    uint gain;
    /// @notice Losses (paid for the borrowed amount) paid in the current action, in terms of borrow asset
    ///         Pool adapter has debt. Debt is increased in time. The amount by which a debt increases is a loss
    uint loss;
    /// @notice [price of collateral, price of borrow asset] for the moment of the action, decimals 18 (USD/Token)
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

    /// @notice Count actions performed at the moment of checkpoint creation
    uint countActions;
  }

  struct OnRepayLocal {
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

  struct CheckpointLocal {
    uint totalCollateral;
    uint totalDebt;
    uint countActions;
    uint borrowedAmount;
    uint suppliedAmount;
  }

  struct CheckpointForUserLocal {
    uint lenTokens;
    uint indexCollateral;
    uint indexBorrow;
    uint gain;
    uint loss;
  }

  struct StartPeriodLocal {
    uint[] decs;
    uint len;
    address collateralAsset;
    address borrowAsset;
    uint gain;
    uint loss;
    uint countActions;
  }
  //endregion ----------------------------------------------------- Data types

  //region ----------------------------------------------------- Events
  event OnBorrow(
    address poolAdapter,
    uint collateralAmount,
    uint borrowedAmount
  );

  /// @param gain Gain in terms of collateral
  /// @param losses Debt-losses in terms of borrow asset
  event OnRepay(
    address poolAdapter,
    uint withdrawnCollateral,
    uint paidAmount,
    uint gain,
    uint losses,
    uint[2] prices
  );
  //endregion ----------------------------------------------------- Events

  //region ----------------------------------------------------- Checkpoint logic

  /// @notice Calculate gain and debt-loss for period between current moment and stored checkpoint
  /// @dev Deltas can be calculated only if there were no repay/borrow actions since previous checkpoint
  function previewCheckpointForPoolAdapter(BaseState storage state_, IPoolAdapter poolAdapter_) internal view returns (
    uint deltaGain,
    uint deltaLoss
  ) {
    CheckpointLocal memory v;
    (v.totalCollateral, v.totalDebt, , , , ) = poolAdapter_.getStatus();
    PoolAdapterCheckpoint memory c = state_.checkpoints[address(poolAdapter_)];
    Action[] storage actions = state_.actions[address(poolAdapter_)];

    v.countActions = actions.length;

    // we can calculate deltas only if
    // - there was no liquidation
    // - there were no repay/borrow actions since previous checkpoint
    // otherwise it's safer to assume that the deltas are zero
    if (v.totalDebt >= c.totalDebt && c.countActions == v.countActions ) {
      deltaGain = v.totalCollateral - c.totalCollateral;
      deltaLoss = v.totalDebt - c.totalDebt;
    }

    return (deltaGain, deltaLoss);
  }

  /// @notice Save checkpoint for the given {poolAdapter_} for the current moment
  /// @dev Deltas can be calculated only if there were no repay/borrow actions since previous checkpoint
  function checkpointForPoolAdapter(BaseState storage state_, IPoolAdapter poolAdapter_) internal returns (
    uint deltaGain,
    uint deltaLoss
  ) {
    CheckpointLocal memory v;
    (v.totalCollateral, v.totalDebt, , , , ) = poolAdapter_.getStatus();
    PoolAdapterCheckpoint memory c = state_.checkpoints[address(poolAdapter_)];
    Action[] storage actions = state_.actions[address(poolAdapter_)];

    v.countActions = actions.length;

    // we can calculate deltas only if
    // - there was no liquidation
    // - there were no repay/borrow actions since previous checkpoint
    // - this is not a first checkpoint
    // otherwise it's safer to assume that the deltas are zero
    if (v.totalDebt >= c.totalDebt && c.countActions == v.countActions && c.totalDebt != 0) {
      deltaGain = v.totalCollateral - c.totalCollateral;
      deltaLoss = v.totalDebt - c.totalDebt;
    }

    if (v.countActions != 0) {
      Action memory action = actions[v.countActions - 1];
      v.borrowedAmount = action.borrowedAmount;
      v.suppliedAmount = action.suppliedAmount;
    }

    state_.checkpoints[address(poolAdapter_)] = PoolAdapterCheckpoint({
      totalDebt: v.totalDebt,
      totalCollateral: v.totalCollateral,
      borrowedAmount: v.borrowedAmount,
      suppliedAmount: v.suppliedAmount,
      countActions: v.countActions
    });

    return (deltaGain, deltaLoss);
  }

  /// @notice Make new checkpoint in all pool adapters of the {user_}, calculate total gains and losses for all assets
  /// @param user_ User (strategy)
  /// @param tokens_ List of all possible collateral and borrow assets.
  /// @return deltaGains Collateral gains for {tokens_}. Gain is a profit that appears because of supply rates.
  /// @return deltaLosses Increases in debts for {tokens_}. Such losses appears because of borrow rates.
  function checkpointForUser(
    BaseState storage state_,
    address user_,
    address[] memory tokens_
  ) internal returns (
    uint[] memory deltaGains,
    uint[] memory deltaLosses
  ) {
    CheckpointForUserLocal memory v;

    v.lenTokens = tokens_.length;
    deltaGains = new uint[](v.lenTokens);
    deltaLosses = new uint[](v.lenTokens);

    EnumerableSet.AddressSet storage set = state_.poolAdaptersPerUser[user_];
    uint len = set.length();
    for (uint i; i < len; ++i) {
      IPoolAdapter poolAdapter = IPoolAdapter(set.at(i));
      (,, address collateralAsset, address borrowAsset) = poolAdapter.getConfig();
      v.indexCollateral = AppUtils.getAssetIndex(tokens_, collateralAsset, v.lenTokens);
      v.indexBorrow = AppUtils.getAssetIndex(tokens_, borrowAsset, v.lenTokens);
      require(v.indexCollateral != type(uint).max && v.indexBorrow != type(uint).max, AppErrors.ASSET_NOT_FOUND);

      (v.gain, v.loss) = checkpointForPoolAdapter(state_, poolAdapter);
      deltaGains[v.indexCollateral] += v.gain;
      deltaLosses[v.indexBorrow] += v.loss;
    }
  }

  /// @notice Calculate gain and debt-loss for all user's pool adapter
  ///         for period between current moment and stored checkpoint
  /// @param user_ User (strategy)
  /// @param tokens_ List of all possible collateral and borrow assets.
  /// @return deltaGains Collateral gains for {tokens_}. Gain is a profit that appears because of supply rates.
  /// @return deltaLosses Increases in debts for {tokens_}. Such losses appears because of borrow rates.
  function previewCheckpointForUser(
    BaseState storage state_,
    address user_,
    address[] memory tokens_
  ) internal view returns (
    uint[] memory deltaGains,
    uint[] memory deltaLosses
  ) {
    CheckpointForUserLocal memory v;

    v.lenTokens = tokens_.length;
    deltaGains = new uint[](v.lenTokens);
    deltaLosses = new uint[](v.lenTokens);

    EnumerableSet.AddressSet storage set = state_.poolAdaptersPerUser[user_];
    uint len = set.length();
    for (uint i; i < len; ++i) {
      IPoolAdapter poolAdapter = IPoolAdapter(set.at(i));
      (,, address collateralAsset, address borrowAsset) = poolAdapter.getConfig();
      v.indexCollateral = AppUtils.getAssetIndex(tokens_, collateralAsset, v.lenTokens);
      v.indexBorrow = AppUtils.getAssetIndex(tokens_, borrowAsset, v.lenTokens);
      require(v.indexCollateral != type(uint).max && v.indexBorrow != type(uint).max, AppErrors.ASSET_NOT_FOUND);

      (v.gain, v.loss) = previewCheckpointForPoolAdapter(state_, poolAdapter);
      deltaGains[v.indexCollateral] += v.gain;
      deltaLosses[v.indexBorrow] += v.loss;
    }
  }
  //endregion ----------------------------------------------------- Checkpoint logic

  //region ----------------------------------------------------- OnBorrow, OnRepay logic
  /// @notice Register a new loan
  /// @param collateralAmount Amount of supplied collateral for the new loan
  /// @param borrowedAmount Borrowed amount provided for the given {collateralAmount}
  function onBorrow(
    BaseState storage state,
    IPoolAdapter poolAdapter,
    uint collateralAmount,
    uint borrowedAmount
  ) internal {
    (, address user, , ) = poolAdapter.getConfig();

    (uint totalSuppliedAmount, uint totalBorrowedAmount) = _getLastStoredAmounts(state, address(poolAdapter));

    state.actions[address(poolAdapter)].push(Action({
      suppliedAmount: totalSuppliedAmount + collateralAmount,
      borrowedAmount: totalBorrowedAmount + borrowedAmount,
      actionKind: ActionKind.BORROW_0
    }));

    state.poolAdaptersPerUser[user].add(address(poolAdapter));
    emit OnBorrow(address(poolAdapter), collateralAmount, borrowedAmount);
  }

  /// @notice Register loan payment
  /// @param withdrawnCollateral Amount of collateral received by the user during the repaying.
  /// @param paidAmount Amount paid by the user during the repaying.
  function onRepay(
    BaseState storage state,
    IConverterController controller,
    IPoolAdapter poolAdapter,
    uint withdrawnCollateral,
    uint paidAmount
  ) internal {
    OnRepayLocal memory v;
    (, v.user, v.collateralAsset, v.borrowAsset) = poolAdapter.getConfig();
    (v.totalCollateral, v.totalDebt,,,,) = poolAdapter.getStatus();
    IPriceOracle priceOracle = IPriceOracle(controller.priceOracle());

    (uint totalSuppliedAmount, uint totalBorrowedAmount) = _getLastStoredAmounts(state, address(poolAdapter));

    // register new repay action, calculate received gain and paid debt-loss amounts
    v.collateralRatio = Math.min(1e18, 1e18 * withdrawnCollateral / (v.totalCollateral + withdrawnCollateral));
    v.debtRatio = Math.min(1e18, 1e18 * paidAmount / (v.totalDebt + paidAmount));

    uint gain = AppUtils.sub0(v.totalCollateral + withdrawnCollateral, totalSuppliedAmount) * v.collateralRatio / 1e18;
    uint loss = AppUtils.sub0(v.totalDebt + paidAmount, totalBorrowedAmount) * v.debtRatio / 1e18;

    // register new repay-action
    state.actions[address(poolAdapter)].push(Action({
      suppliedAmount: totalSuppliedAmount * (1e18 - v.collateralRatio) / 1e18,
      borrowedAmount: totalBorrowedAmount * (1e18 - v.debtRatio) / 1e18,
      actionKind: ActionKind.REPAY_1
    }));

    uint[2] memory prices = [
      priceOracle.getAssetPrice(v.collateralAsset),
      priceOracle.getAssetPrice(v.borrowAsset)
    ];
    state.repayInfo[address(poolAdapter)][state.actions[address(poolAdapter)].length - 1] = RepayInfo({
      gain: gain,
      loss: loss,
      prices: prices
    });

    state.poolAdaptersPerUser[v.user].add(address(poolAdapter));
    emit OnRepay(address(poolAdapter), withdrawnCollateral, paidAmount, gain, loss, prices);
  }

  function _getLastStoredAmounts(BaseState storage state, address poolAdapter) internal view returns (
    uint suppliedAmount,
    uint borrowedAmount
  ) {
    Action[] memory actions = state.actions[poolAdapter];
    uint countActions = actions.length;
    if (countActions != 0) {
      // get last stored supplied and borrowed amount
      Action memory lastAction = actions[countActions - 1];
      suppliedAmount = lastAction.suppliedAmount;
      borrowedAmount = lastAction.borrowedAmount;
    }

    return (suppliedAmount, borrowedAmount);
  }
  //endregion ----------------------------------------------------- OnBorrow, OnRepay logic

  //region ----------------------------------------------------- Logic for period
  /// @notice Calculate total amount of gains and looses in underlying by all pool adapters of the user
  ///         for the current period, start new period.
  /// @param underlying_ Asset in which we calculate gains and loss. Assume that it's either collateral or borrow asset.
  /// @return gains Total amount of gains (supply-profit) of the {user_} by all user's pool adapters
  /// @return losses Total amount of losses (paid increases to debt) of the {user_} by all user's pool adapters
  function startPeriod(
    BaseState storage state_,
    IDebtMonitor debtMonitor,
    address user_,
    address underlying_
  ) internal returns (
    uint gains,
    uint losses
  ) {
    StartPeriodLocal memory v;

    EnumerableSet.AddressSet storage set = state_.poolAdaptersPerUser[user_];
    v.len = set.length();
    v.decs = new uint[](2);
    for (uint i = v.len; i > 0; i--) {
      IPoolAdapter poolAdapter = IPoolAdapter(set.at(i - 1));
      (,, v.collateralAsset, v.borrowAsset) = poolAdapter.getConfig();
      v.decs[0] = 10 ** IERC20Metadata(v.collateralAsset).decimals();
      v.decs[1] = 10 ** IERC20Metadata(v.borrowAsset).decimals();

      (v.gain, v.loss, v.countActions) = onHardwork(state_, poolAdapter, underlying_ == v.collateralAsset, v.decs);
      gains += v.gain;
      losses += v.loss;

      state_.periods[address(poolAdapter)].push(v.countActions);

      // remove pool adapters without any debts from the set
      if (! debtMonitor.isPositionOpenedEx(address(poolAdapter))) {
        set.remove(address(poolAdapter));
      }
    }

    return (gains, losses);
  }

  /// @notice Calculate total amount of gains and looses in underlying by all pool adapters of the user
  ///         for the current period, DON'T start new period.
  /// @param underlying_ Asset in which we calculate gains and loss. Assume that it's either collateral or borrow asset.
  /// @return gains Total amount of gains (supply-profit) of the {user_} by all user's pool adapters
  /// @return losses Total amount of losses (paid increases to debt) of the {user_} by all user's pool adapters
  function previewPeriod(BaseState storage state_, address user_, address underlying_) internal view returns (
    uint gains,
    uint losses
  ) {
    StartPeriodLocal memory v;

    EnumerableSet.AddressSet storage set = state_.poolAdaptersPerUser[user_];
    v.len = set.length();
    v.decs = new uint[](2);
    for (uint i = v.len; i > 0; i--) {
      IPoolAdapter poolAdapter = IPoolAdapter(set.at(i - 1));
      (,, v.collateralAsset, v.borrowAsset) = poolAdapter.getConfig();
      v.decs[0] = 10 ** IERC20Metadata(v.collateralAsset).decimals();
      v.decs[1] = 10 ** IERC20Metadata(v.borrowAsset).decimals();

      (v.gain, v.loss, v.countActions) = onHardwork(state_, poolAdapter, underlying_ == v.collateralAsset, v.decs);
      gains += v.gain;
      losses += v.loss;
    }

    return (gains, losses);
  }

  /// @notice Calculate gains and losses of the {poolAdapter_} for the current period
  /// @param isCollateralUnderlying_ True if collateral is underlying (assume that otherwise borrow asset is underlying)
  /// @param decs 10**decimals for [collateral, borrow asset]
  /// @return gains Total amount of gains (supply-profit) for all repay-actions made in the current period
  /// @return loss Total amount of losses (paid increases to debt) for all repay-actions made in the current period
  /// @return countActions Current count of actions
  function onHardwork(
    BaseState storage state_,
    IPoolAdapter poolAdapter_,
    bool isCollateralUnderlying_,
    uint[] memory decs
  ) internal view returns (
    uint gains,
    uint loss,
    uint countActions
  ) {
    BookkeeperLib.Action[] storage actions = state_.actions[address(poolAdapter_)];
    countActions = actions.length;

    uint[] storage periods = state_.periods[address(poolAdapter_)];
    uint countPeriods = periods.length;
    // count of the actions at the moment of the beginning of the period
    uint countActionsStart = countPeriods == 0
      ? 0
      : periods[countPeriods - 1];
    for (uint i = countActions; i > countActionsStart; i--) {
      ActionKind actionKind = actions[i - 1].actionKind;
      if (actionKind == ActionKind.BORROW_0) continue;
      if (actionKind == ActionKind.REPAY_1) {
        // let's calculate received gains and losses in terms of given asset
        RepayInfo memory repayInfo = state_.repayInfo[address(poolAdapter_)][i - 1];
        if (isCollateralUnderlying_) {
          gains += repayInfo.gain;
          loss += repayInfo.loss * repayInfo.prices[1] * decs[0] / repayInfo.prices[0] / decs[1];
        } else {
          loss += repayInfo.loss;
          gains += repayInfo.gain * repayInfo.prices[0] * decs[1] / repayInfo.prices[1] / decs[0];
        }
      } else {
        // we have reached moment of starting of the current period
        break;
      }
    }

    return (gains, loss, countActions);
  }
  //endregion ----------------------------------------------------- Logic for period

}

