// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "../libs/AppErrors.sol";
import "../libs/AppUtils.sol";
import "../openzeppelin/IERC20Metadata.sol";
import "../openzeppelin/EnumerableSet.sol";
import "../interfaces/IPoolAdapter.sol";
import "../interfaces/IConverterController.sol";
import "../interfaces/IDebtMonitor.sol";
import "../interfaces/IPriceOracle.sol";
import "../interfaces/IBorrowManager.sol";
import "../interfaces/ITetuConverter.sol";
import "../proxy/ControllableV3.sol";
import "../libs/ConverterLogicLib.sol";

/// @notice Manage list of open borrow positions
contract DebtMonitor is IDebtMonitor, ControllableV3 {
  using AppUtils for uint;
  using EnumerableSet for EnumerableSet.AddressSet;

  struct CheckHealthFactorInputParams {
    uint startIndex0;
    uint maxCountToCheck;
    uint maxCountToReturn;
    uint healthFactorThreshold18;
  }

  //region ---------------------------------------------- Constants
  string public constant DEBT_MONITOR_VERSION = "1.0.4";
  /// @notice Allow {closeLiquidatedPosition} to close position with collateral amount less than given value
  /// @dev For simplicity, this value is same for all assets (with any decimals).
  uint public constant CLOSE_POSITION_GAP_TOKENS = 100;
  //endregion ---------------------------------------------- Constants

  //region ---------------------------------------------- Variables. Don't change names or ordering!
  /// @notice Pool adapters with active borrow positions
  /// @dev All these pool adapters should be enumerated during health-checking
  address[] public positions;

  /// @notice Pool adapter => block number of last call of onOpenPosition
  mapping(address => uint) public positionLastAccess;

  /// @notice List of opened positions for the given set (user, collateral, borrowToken)
  /// @dev PoolAdapterKey(== keccak256(user, collateral, borrowToken)) => poolAdapters
  mapping(uint => address[]) public poolAdapters;

  /// @notice List of opened positions for the given user
  /// @dev User => List of pool adapters
  mapping(address => EnumerableSet.AddressSet) private _poolAdaptersForUser;

  /// @notice Template pool adapter => list of ACTIVE pool adapters created on the base of the template
  /// @dev We need it to prevent removing a pool from the borrow manager when the pool is in use
  mapping(address => EnumerableSet.AddressSet) private _poolAdaptersForConverters;

  //endregion ---------------------------------------------- Variables. Don't change names or ordering!

  //region ---------------------------------------------- Events
  event OnOpenPosition(address poolAdapter);
  event OnClosePosition(address poolAdapter);
  event OnCloseLiquidatedPosition(address poolAdapter, uint amountToPay);
  //endregion ---------------------------------------------- Events

  //region ---------------------------------------------- Initialization

  function init(address controller_) external initializer {
    __Controllable_init(controller_);
  }
  //endregion ---------------------------------------------- Initialization

  //region ---------------------------------------------- Operations with positions

  function isPositionOpened() external override view returns (bool) {
    return positionLastAccess[msg.sender] != 0;
  }

  function isPositionOpenedEx(address poolAdapter) external override view returns (bool) {
    return positionLastAccess[poolAdapter] != 0;
  }


  /// @notice Register new borrow position if it's not yet registered
  /// @dev This function is called from a pool adapter after any borrow
  function onOpenPosition() external override {
    IBorrowManager borrowManager = IBorrowManager(IConverterController(controller()).borrowManager());
    require(borrowManager.isPoolAdapter(msg.sender), AppErrors.POOL_ADAPTER_ONLY);

    if (positionLastAccess[msg.sender] == 0) {
      positionLastAccess[msg.sender] = block.number;
      positions.push(msg.sender);

      (address origin,
      address user,
      address collateralAsset,
      address borrowAsset
      ) = IPoolAdapter(msg.sender).getConfig();

      poolAdapters[getPoolAdapterKey(user, collateralAsset, borrowAsset)].push(msg.sender);
      _poolAdaptersForUser[user].add(msg.sender);

      _poolAdaptersForConverters[origin].add(msg.sender);
      emit OnOpenPosition(msg.sender);
    }
  }

  /// @notice Unregister the borrow position if it's completely repaid
  /// @dev This function is called from a pool adapter when the borrow is completely repaid
  function onClosePosition() external override {
    // This method should be called by pool adapters only
    // we check it through positionLastAccess
    require(
      positionLastAccess[msg.sender] != 0,
      AppErrors.BORROW_POSITION_IS_NOT_REGISTERED
    );

    (uint collateralAmount, uint amountToPay,,,,) = IPoolAdapter(msg.sender).getStatus();
    require(collateralAmount == 0 && amountToPay == 0, AppErrors.ATTEMPT_TO_CLOSE_NOT_EMPTY_BORROW_POSITION);

    _closePosition(msg.sender, false);
    emit OnClosePosition(msg.sender);
  }

  /// @notice Remove the pool adapter from all lists of the opened positions
  /// @param poolAdapter_ Pool adapter to be closed
  /// @param markAsDirty_ Mark the pool adapter as "dirty" in borrow manager
  ///                     to exclude the pool adapter from any new borrows
  function _closePosition(address poolAdapter_, bool markAsDirty_) internal {
    positionLastAccess[poolAdapter_] = 0;
    AppUtils.removeItemFromArray(positions, poolAdapter_);
    (address origin, address user, address collateralAsset, address borrowAsset) = IPoolAdapter(poolAdapter_).getConfig();

    AppUtils.removeItemFromArray(poolAdapters[getPoolAdapterKey(user, collateralAsset, borrowAsset)], poolAdapter_);
    _poolAdaptersForUser[user].remove(poolAdapter_);
    _poolAdaptersForConverters[origin].remove(poolAdapter_);

    if (markAsDirty_) {
      IBorrowManager borrowManager = IBorrowManager(IConverterController(controller()).borrowManager());
      // We have dropped away the pool adapter. It cannot be used any more for new borrows
      // Mark the pool adapter as dirty in borrow manager to exclude the pool adapter from any new borrows
      if (poolAdapter_ == borrowManager.getPoolAdapter(origin, user, collateralAsset, borrowAsset)) {
        borrowManager.markPoolAdapterAsDirty(origin, user, collateralAsset, borrowAsset);
      }
    }
  }

  /// @notice Pool adapter has opened borrow, but full liquidation happens and we've lost all collateral
  ///         Close position without paying the debt and never use the pool adapter again.
  function closeLiquidatedPosition(address poolAdapter_) external override {
    require(msg.sender == IConverterController(controller()).tetuConverter(), AppErrors.TETU_CONVERTER_ONLY);

    (uint collateralAmount, uint amountToPay,,,,) = IPoolAdapter(poolAdapter_).getStatus();
    require(collateralAmount < CLOSE_POSITION_GAP_TOKENS, AppErrors.CANNOT_CLOSE_LIVE_POSITION);
    _closePosition(poolAdapter_, true);

    emit OnCloseLiquidatedPosition(poolAdapter_, amountToPay);
  }
  //endregion ---------------------------------------------- Operations with positions

  //region ---------------------------------------------- Detect unhealthy positions

  /// @notice Enumerate {maxCountToCheck} pool adapters starting from {index0} and return unhealthy pool-adapters
  ///         i.e. adapters with health factor below min allowed value
  ///         It calculates two amounts: amount of borrow asset and amount of collateral asset
  ///         To fix the health factor it's necessary to send EITHER one amount OR another one.
  ///         There is special case: a liquidation happens inside the pool adapter.
  ///         It means, that this is "dirty" pool adapter and this position must be closed and never used again.
  ///         In this case, both amounts are zero (we need to make FULL repay)
  /// @return nextIndexToCheck0 Index of next pool-adapter to check; 0: all pool-adapters were checked
  /// @return outPoolAdapters List of pool adapters that should be reconverted
  /// @return outAmountBorrowAsset What borrow-asset amount should be send to pool adapter to fix health factor
  /// @return outAmountCollateralAsset What collateral-asset amount should be send to pool adapter to fix health factor
  function checkHealth(
    uint startIndex0,
    uint maxCountToCheck,
    uint maxCountToReturn
  ) external view override returns (
    uint nextIndexToCheck0,
    address[] memory outPoolAdapters,
    uint[] memory outAmountBorrowAsset,
    uint[] memory outAmountCollateralAsset
  ) {
    return _checkHealthFactor(
      CheckHealthFactorInputParams({
        startIndex0: startIndex0,
        maxCountToCheck: maxCountToCheck,
        maxCountToReturn: maxCountToReturn,
        healthFactorThreshold18: uint(IConverterController(controller()).minHealthFactor2()) * 10 ** (18 - 2)
      })
    );
  }

  function _checkHealthFactor(
    CheckHealthFactorInputParams memory p
  ) internal view returns (
    uint nextIndexToCheck0,
    address[] memory outPoolAdapters,
    uint[] memory outAmountBorrowAsset,
    uint[] memory outAmountCollateralAsset
  ) {
    IBorrowManager borrowManager = IBorrowManager(IConverterController(controller()).borrowManager());
    uint countFoundItems = 0;
    nextIndexToCheck0 = p.startIndex0;

    outPoolAdapters = new address[](p.maxCountToReturn);
    outAmountBorrowAsset = new uint[](p.maxCountToReturn);
    outAmountCollateralAsset = new uint[](p.maxCountToReturn);

    if (p.startIndex0 + p.maxCountToCheck > positions.length) {
      p.maxCountToCheck = positions.length - p.startIndex0;
    }

    // enumerate all pool adapters
    for (uint i = 0; i < p.maxCountToCheck; i = i.uncheckedInc()) {
      nextIndexToCheck0 += 1;

      // check if we need to make reconversion because the health factor is too low/high
      IPoolAdapter pa = IPoolAdapter(positions[p.startIndex0 + i]);

      (uint requiredBorrowAssetAmount,
       uint requiredCollateralAssetAmount
      ) = ConverterLogicLib.checkPositionHealth(pa, borrowManager, p.healthFactorThreshold18);

      if (requiredBorrowAssetAmount != 0 || requiredCollateralAssetAmount != 0) {
        outPoolAdapters[countFoundItems] = positions[p.startIndex0 + i];
        outAmountBorrowAsset[countFoundItems] = requiredBorrowAssetAmount;
        outAmountCollateralAsset[countFoundItems] = requiredCollateralAssetAmount;

        countFoundItems += 1;

        if (countFoundItems == p.maxCountToReturn) {
          break;
        }
      }
    }

    if (nextIndexToCheck0 == positions.length) {
      nextIndexToCheck0 = 0; // all items were checked
    }

    // we need to keep only found items in result array and remove others
    return (nextIndexToCheck0,
      countFoundItems == 0
        ? new address[](0)
        : AppUtils.removeLastItems(outPoolAdapters, countFoundItems),
      countFoundItems == 0
        ? new uint[](0)
        : AppUtils.removeLastItems(outAmountBorrowAsset, countFoundItems),
      countFoundItems == 0
        ? new uint[](0)
        : AppUtils.removeLastItems(outAmountCollateralAsset, countFoundItems)
    );
  }
  //endregion ---------------------------------------------- Detect unhealthy positions

  //region ---------------------------------------------- Views

  /// @notice Get active borrows of the user with given collateral/borrowToken
  /// @return poolAdaptersOut The instances of IPoolAdapter
  function getPositions(
    address user_,
    address collateralToken_,
    address borrowedToken_
  ) external view override returns (
    address[] memory poolAdaptersOut
  ) {
    address[] memory adapters = poolAdapters[getPoolAdapterKey(user_, collateralToken_, borrowedToken_)];
    uint countAdapters = adapters.length;

    poolAdaptersOut = new address[](countAdapters);

    for (uint i = 0; i < countAdapters; i = i.uncheckedInc()) {
      poolAdaptersOut[i] = adapters[i];
    }

    return poolAdaptersOut;
  }

  /// @notice Get active borrows of the given user
  /// @return poolAdaptersOut The instances of IPoolAdapter
  function getPositionsForUser(address user_) external view override returns (
    address[] memory poolAdaptersOut
  ) {
    EnumerableSet.AddressSet storage set = _poolAdaptersForUser[user_];
    uint countAdapters = set.length();

    poolAdaptersOut = new address[](countAdapters);

    for (uint i = 0; i < countAdapters; i = i.uncheckedInc()) {
      poolAdaptersOut[i] = set.at(i);
    }

    return poolAdaptersOut;
  }

  /// @notice Return true if there is a least once active pool adapter created on the base of the {converter_}
  function isConverterInUse(address converter_) external view override returns (bool) {
    return _poolAdaptersForConverters[converter_].length() != 0;
  }
  //endregion ---------------------------------------------- Views

  //region ---------------------------------------------- Utils
  function getPoolAdapterKey(
    address user_,
    address collateral_,
    address borrowToken_
  ) public pure returns (uint){
    return uint(keccak256(abi.encodePacked(user_, collateral_, borrowToken_)));
  }
  //endregion ---------------------------------------------- Utils

  //region ---------------------------------------------- Access to arrays

  /// @notice Get total count of pool adapters with opened positions
  function getCountPositions() external view override returns (uint) {
    return positions.length;
  }

  function poolAdaptersLength(
    address user_,
    address collateral_,
    address borrowToken_
  ) external view returns (uint) {
    return poolAdapters[getPoolAdapterKey(user_, collateral_, borrowToken_)].length;
  }
  //endregion Access to arrays
}