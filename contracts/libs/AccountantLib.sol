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
    /// @notice pool adapter => info about borrow/repay actions during current period
    mapping(address => AccountantLib.Actions[]) actions;

    /// @notice User of the pool adapter => list of pool adapters with not zero debts in the current period
    mapping(address => EnumerableSet.AddressSet) poolAdaptersPerUser;

    /// @notice pool adapter => checkpoint
    mapping(address => AccountantLib.PoolAdapterCheckpoint) checkpoints;
  }

  /// @notice Borrow or repay action
  struct Actions {
    /// @notice Total amount supplied by the user as a collateral after the action
    uint suppliedAmount;
    /// @notice Total borrowed amount after the action
    uint borrowedAmount;
    /// @notice Amount of collateral registered on the lending platform after the action
    uint totalCollateral;
    /// @notice Amount of debt registered on the lending platform after the action
    uint totalDebt;
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

  struct CheckpointLocal {
    uint totalCollateral;
    uint totalDebt;
    uint actionIndexFrom;
    uint countActions;
    uint borrowedAmount;
    uint suppliedAmount;
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
    uint gain,
    uint losses,
    uint gainInUnderlying,
    uint lossesInUnderlying
  );
  //endregion ----------------------------------------------------- Events

  //region ----------------------------------------------------- Checkpoint logic

  /// @notice Save checkpoint for the given {poolAdapter_} for the current moment
  /// @dev Deltas can be calculated only if there were no repay/borrow actions since previous checkpoint
  function checkpoint(IPoolAdapter poolAdapter_, BaseState storage state_) internal returns (
    uint deltaGain,
    uint deltaLoss
  ) {
    CheckpointLocal memory v;
    (v.totalCollateral, v.totalDebt, , , , ) = poolAdapter_.getStatus();
    PoolAdapterCheckpoint memory c = state_.checkpoints[address(poolAdapter_)];
    Actions[] storage actions = state_.actions[address(poolAdapter_)];

    v.countActions = actions.length;

    // we can calculate deltas only if
    // - there was no liquidation
    // - there were no repay/borrow actions since previous checkpoint
    // otherwise it's safer to assume that the deltas are zero
    if (v.totalDebt >= c.totalDebt && c.countActions == v.countActions ) {
      deltaGain = v.totalCollateral - c.totalCollateral;
      deltaLoss = v.totalDebt - c.totalDebt;
    }

    if (v.countActions != 0) {
      Actions memory action = actions[v.countActions - 1];
      v.borrowedAmount = action.borrowedAmount;
      v.suppliedAmount = action.suppliedAmount;
    }

    state_.checkpoints[address(poolAdapter_)] = PoolAdapterCheckpoint({
      totalDebt: c.totalDebt,
      totalCollateral: c.totalCollateral,
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
    address user_,
    BaseState storage state_,
    address[] memory tokens_
  ) internal returns (
    uint[] memory deltaGains,
    uint[] memory deltaLosses
  ) {
    uint lenTokens = tokens_.length;
    deltaGains = new uint[](lenTokens);
    deltaLosses = new uint[](lenTokens);

    EnumerableSet.AddressSet storage set = state_.poolAdaptersPerUser[user_];
    uint len = set.length();
    for (uint i; i < len; ++i) {
      IPoolAdapter poolAdapter = IPoolAdapter(set.at(i));
      (,, address collateralAsset, address borrowAsset) = poolAdapter.getConfig();
      uint indexCollateral = AppUtils.getAssetIndex(tokens_, collateralAsset, lenTokens);
      uint indexBorrow = AppUtils.getAssetIndex(tokens_, borrowAsset, lenTokens);
      require(indexCollateral != type(uint).max && indexBorrow != type(uint).max, AppErrors.ASSET_NOT_FOUND);

      (uint gain, uint loss) = checkpoint(poolAdapter, state_);
      deltaGains[indexCollateral] += gain;
      deltaLosses[indexBorrow] += loss;
    }
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
//    (, address user, , ) = poolAdapter_.getConfig();
//
//    (uint totalCollateral, uint totalDebt,,,,) = poolAdapter_.getStatus();
//
//    PoolAdapterState memory state = state_.states[msg.sender];
//
//    state_.states[msg.sender] = PoolAdapterState({
//      suppliedAmount: state.suppliedAmount + collateralAmount,
//      borrowedAmount: state.borrowedAmount + borrowedAmount
//    });
//
//    state_.poolAdaptersPerUser[user].add(msg.sender);
//    emit OnBorrow(address(poolAdapter_), collateralAmount, borrowedAmount);
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

