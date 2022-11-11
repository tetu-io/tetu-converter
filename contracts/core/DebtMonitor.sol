// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../interfaces/IPoolAdapter.sol";
import "../interfaces/IController.sol";
import "../interfaces/IDebtsMonitor.sol";
import "../interfaces/IPriceOracle.sol";
import "../integrations/IERC20Extended.sol";
import "../interfaces/IBorrowManager.sol";
import "../interfaces/ITetuConverter.sol";
import "./AppErrors.sol";
import "../core/AppUtils.sol";
import "../openzeppelin/EnumerableSet.sol";

/// @notice Manage list of open borrow positions
contract DebtMonitor is IDebtMonitor {
  using AppUtils for uint;
  using EnumerableSet for EnumerableSet.AddressSet;

  struct CheckHealthFactorInputParams {
    uint startIndex0;
    uint maxCountToCheck;
    uint maxCountToReturn;
    uint healthFactorThreshold18;
  }

  IController public immutable controller;

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

  /// @notice threshold for APRs difference, i.e. _thresholdApr100 = 20 for (apr0-apr1)/apr0 > 20%
  ///         0 - disable the limitation by value of APR difference
  uint public thresholdAPR;

  /// @notice best-way reconversion is allowed only after passing specified count of blocks since last reconversion
  ///         0 - disable the limitation by count of blocks passed since last onOpenPosition call
  uint public thresholdCountBlocks;

  ///////////////////////////////////////////////////////
  ///       Constructor and initialization
  ///////////////////////////////////////////////////////

  constructor(
    address controller_,
    uint thresholdAPR_,
    uint thresholdCountBlocks_
  ) {
    require(controller_ != address(0), AppErrors.ZERO_ADDRESS);

    controller = IController(controller_);
    thresholdAPR = thresholdAPR_;
    thresholdCountBlocks = thresholdCountBlocks_;
  }

  function setThresholdAPR(uint value100_) external {
    _onlyGovernance();
    require(value100_ < 100, AppErrors.INCORRECT_VALUE);
    thresholdAPR = value100_;
  }

  function setThresholdCountBlocks(uint countBlocks_) external {
    _onlyGovernance();
    thresholdCountBlocks = countBlocks_;
  }

  ///////////////////////////////////////////////////////
  ///               Access rights
  ///////////////////////////////////////////////////////

  /// @notice Ensure that msg.sender is registered pool adapter
  function _onlyPoolAdapter() internal view {
    IBorrowManager bm = IBorrowManager(controller.borrowManager());
    require(bm.isPoolAdapter(msg.sender), AppErrors.POOL_ADAPTER_ONLY);
  }

  /// @notice Ensure that msg.sender is registered pool adapter
  function _onlyGovernance() internal view {
    require(msg.sender == controller.governance(), AppErrors.GOVERNANCE_ONLY);
  }

  ///////////////////////////////////////////////////////
  ///       On-borrow and on-repay logic
  ///////////////////////////////////////////////////////

  /// @dev This function is called from a pool adapter after any borrow
  function onOpenPosition() external override {
    _onlyPoolAdapter();

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
    }
  }

  /// @dev This function is called from a pool adapter when the borrow is completely repaid
  function onClosePosition() external override {
    require(positionLastAccess[msg.sender] != 0, AppErrors.BORROW_POSITION_IS_NOT_REGISTERED);

    (uint collateralAmount, uint amountToPay,,,) = IPoolAdapter(msg.sender).getStatus();
    require(collateralAmount == 0 && amountToPay == 0, AppErrors.ATTEMPT_TO_CLOSE_NOT_EMPTY_BORROW_POSITION);

    positionLastAccess[msg.sender] = 0;
    AppUtils.removeItemFromArray(positions, msg.sender);

    (address origin,
     address user,
     address collateralAsset,
     address borrowAsset
    ) = IPoolAdapter(msg.sender).getConfig();

    AppUtils.removeItemFromArray(poolAdapters[getPoolAdapterKey(user, collateralAsset, borrowAsset)], msg.sender);
    _poolAdaptersForUser[user].remove(msg.sender);
    _poolAdaptersForConverters[origin].remove(msg.sender);
  }

  /// @notice Check if the pool-adapter-caller has an opened position
  function isPositionOpened() external override view returns (bool) {
    _onlyPoolAdapter();

    return positionLastAccess[msg.sender] != 0;
  }

  ///////////////////////////////////////////////////////
  ///           Detect unhealthy positions
  ///////////////////////////////////////////////////////

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
    uint16 minHealthFactor2 = IController(controller).minHealthFactor2();

    return _checkHealthFactor(
      CheckHealthFactorInputParams({
        startIndex0: startIndex0,
        maxCountToCheck: maxCountToCheck,
        maxCountToReturn: maxCountToReturn,
        healthFactorThreshold18: uint(minHealthFactor2) * 10**(18-2)
      })
    );
  }

  function _checkHealthFactor (
    CheckHealthFactorInputParams memory p
  ) internal view returns (
    uint nextIndexToCheck0,
    address[] memory outPoolAdapters,
    uint[] memory outAmountBorrowAsset,
    uint[] memory outAmountCollateralAsset
  ) {
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
      (uint collateralAmount, uint amountToPay, uint healthFactor18,,) = pa.getStatus();
      (,,, address borrowAsset) = pa.getConfig();
      uint healthFactorTarget18 = uint(_borrowManager().getTargetHealthFactor2(borrowAsset)) * 10**(18-2);

      if (
        (p.healthFactorThreshold18 < healthFactorTarget18 && healthFactor18 < p.healthFactorThreshold18) // unhealthy
        || (!(p.healthFactorThreshold18 < healthFactorTarget18) && healthFactor18 > p.healthFactorThreshold18) // too healthy
      ) {
        outPoolAdapters[countFoundItems] = positions[p.startIndex0 + i];
        // Health Factor = Collateral Factor * CollateralAmount * Price_collateral
        //                 -------------------------------------------------
        //                               BorrowAmount * Price_borrow
        // => requiredAmountBorrowAsset = BorrowAmount * (HealthFactorCurrent/HealthFactorTarget - 1)
        // => requiredAmountCollateralAsset = CollateralAmount * (HealthFactorTarget/HealthFactorCurrent - 1)
        outAmountBorrowAsset[countFoundItems] = p.healthFactorThreshold18 < healthFactorTarget18
            ? (amountToPay - amountToPay * healthFactor18 / healthFactorTarget18) // unhealthy
            : (amountToPay * healthFactor18 / healthFactorTarget18 - amountToPay); // too healthy
        outAmountCollateralAsset[countFoundItems] = p.healthFactorThreshold18 < healthFactorTarget18
            ? (collateralAmount * healthFactorTarget18 / healthFactor18 - collateralAmount) // unhealthy
            : (collateralAmount - collateralAmount * healthFactorTarget18 / healthFactor18); // too healthy
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

  ///////////////////////////////////////////////////////
  ///     Features for NEXT versions of the app
  ///         Detect not-optimal positions
  ///         Check too healthy factor
  ///////////////////////////////////////////////////////

//  function checkAdditionalBorrow(
//    uint startIndex0,
//    uint maxCountToCheck,
//    uint maxCountToReturn
//  ) external view override returns (
//    uint nextIndexToCheck0,
//    address[] memory outPoolAdapters,
//    uint[] memory outAmountsToBorrow
//  ) {
//    uint16 maxHealthFactor2 = IController(controller).maxHealthFactor2();
//
//    return _checkHealthFactor(startIndex0
//      , maxCountToCheck
//      , maxCountToReturn
//      , uint(maxHealthFactor2) * 10**(18-2)
//    );
//  }

//  function checkBetterBorrowExists(
//    uint startIndex0,
//    uint maxCountToCheck,
//    uint maxCountToReturn,
//    uint periodInBlocks // TODO: this period is set individually for each borrow...
//  ) external view override returns (
//    uint nextIndexToCheck0,
//    address[] memory outPoolAdapters
//  ) {
//    uint countFoundItems = 0;
//    nextIndexToCheck0 = startIndex0;
//
//    ITetuConverter tc = ITetuConverter(controller.tetuConverter());
//    outPoolAdapters = new address[](maxCountToReturn);
//
//    if (startIndex0 + maxCountToCheck > positions.length) {
//      maxCountToCheck = positions.length - startIndex0;
//    }
//
//    // enumerate all pool adapters
//    for (uint i = 0; i < maxCountToCheck; i = i.uncheckedInc()) {
//      nextIndexToCheck0 += 1;
//
//      // check if we need to make reconversion because a MUCH better borrow way exists
//      IPoolAdapter pa = IPoolAdapter(positions[startIndex0 + i]);
//      (uint collateralAmount,,,) = pa.getStatus();
//
//      if (_findBetterBorrowWay(tc, pa, collateralAmount, periodInBlocks)) {
//        outPoolAdapters[countFoundItems] = positions[startIndex0 + i];
//        countFoundItems += 1;
//        if (countFoundItems == maxCountToReturn) {
//          break;
//        }
//      }
//    }
//
//    if (nextIndexToCheck0 == positions.length) {
//      nextIndexToCheck0 = 0; // all items were checked
//    }
//
//    // we need to keep only found items in result array and remove others
//    return (nextIndexToCheck0
//    , countFoundItems == 0
//      ? new address[](0)
//      : AppUtils.removeLastItems(outPoolAdapters, countFoundItems)
//    );
//  }
//
//  function _findBetterBorrowWay(
//    ITetuConverter tc_,
//    IPoolAdapter pa_,
//    uint sourceAmount_,
//    uint periodInBlocks_
//  ) internal view returns (bool) {
//
//    // check if we can re-borrow the asset in different place with higher profit
//    (address origin,, address sourceToken, address targetToken) = pa_.getConfig();
//    (address converter,, int apr18) = tc_.findConversionStrategy(
//      sourceToken, sourceAmount_, targetToken, periodInBlocks_, ITetuConverter.ConversionMode.AUTO_0
//    );
//    int currentApr18 = pa_.getAPR18() * int(periodInBlocks_);
//
//    // make decision if the new conversion-strategy is worth to be used instead current one
//    if (origin != converter) {
//      //1) threshold for APRs difference exceeds threshold, i.e. (apr0-apr1)/apr0 > 20%
//      if (currentApr18 > apr18
//         && (thresholdAPR == 0 || currentApr18 - apr18 > currentApr18 * int(thresholdAPR) / 100)
//      ) {
//        //2) threshold for block number: count blocks since prev rebalancing should exceed the threshold.
//        if (thresholdCountBlocks == 0 || block.number - positionLastAccess[address(pa_)] > thresholdCountBlocks) {
//          return true;
//        }
//      }
//    }
//    return false;
//  }

  ///////////////////////////////////////////////////////
  ///                   Views
  ///////////////////////////////////////////////////////
  function getPositions (
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

  function getPositionsForUser(address user_) external view override returns(
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

  function isConverterInUse(address converter_) external view override returns (bool) {
    return _poolAdaptersForConverters[converter_].length() != 0;
  }

  ///////////////////////////////////////////////////////
  ///                     Utils
  ///////////////////////////////////////////////////////
  function getPoolAdapterKey(
    address user_,
    address collateral_,
    address borrowToken_
  ) public pure returns (uint){
    return uint(keccak256(abi.encodePacked(user_, collateral_, borrowToken_)));
  }

  ///////////////////////////////////////////////////////
  ///               Access to arrays
  ///////////////////////////////////////////////////////

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

  ///////////////////////////////////////////////////////
  ///          Access to other contracts
  ///////////////////////////////////////////////////////

  function _borrowManager() internal view returns (IBorrowManager) {
    return IBorrowManager(controller.borrowManager());
  }

}
