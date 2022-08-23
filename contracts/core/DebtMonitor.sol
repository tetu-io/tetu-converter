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

/// @notice Manage list of open borrow positions
contract DebtMonitor is IDebtMonitor {
  using AppUtils for uint;

  IController public immutable controller;

  /// @notice Pool adapters with active borrow positions
  /// @dev All these pool adapters should be enumerated during health-checking
  address[] public positions;

  /// @notice Pool adapter => block number of last call of onOpenPosition
  mapping(address => uint) public positionsRegistered;

  /// @notice user => collateral => borrowToken => poolAdapters
  mapping(address => mapping(address => mapping(address => address[]))) public poolAdapters;

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

    if (positionsRegistered[msg.sender] == 0) {
      positionsRegistered[msg.sender] = block.number;
      positions.push(msg.sender);

      (, address user, address collateralAsset, address borrowAsset) = IPoolAdapter(msg.sender).getConfig();
      poolAdapters[user][collateralAsset][borrowAsset].push(msg.sender);
    }
  }

  /// @dev This function is called from a pool adapter when the borrow is completely repaid
  function onClosePosition() external override {
    require(positionsRegistered[msg.sender] != 0, AppErrors.BORROW_POSITION_IS_NOT_REGISTERED);

    (uint collateralAmount, uint amountToPay,,) = IPoolAdapter(msg.sender).getStatus();
    require(collateralAmount == 0 && amountToPay == 0, AppErrors.ATTEMPT_TO_CLOSE_NOT_EMPTY_BORROW_POSITION);

    positionsRegistered[msg.sender] = 0;
    AppUtils.removeItemFromArray(positions, msg.sender);

    (, address user, address collateralAsset, address borrowAsset) = IPoolAdapter(msg.sender).getConfig();
    AppUtils.removeItemFromArray(poolAdapters[user][collateralAsset][borrowAsset], msg.sender);
  }

  ///////////////////////////////////////////////////////
  ///           Detect unhealthy positions
  ///////////////////////////////////////////////////////

  function checkForReconversion(
    uint startIndex0,
    uint maxCountToCheck,
    uint maxCountToReturn,
    uint16 healthFactor2,
    uint periodInBlocks
  ) external view override returns (
    uint nextIndexToCheck0,
    uint countFoundItems,
    address[] memory outPoolAdapters
  ) {
    ITetuConverter tc = ITetuConverter(controller.tetuConverter());
    outPoolAdapters = new address[](maxCountToReturn);

    if (startIndex0 + maxCountToCheck > positions.length) {
      maxCountToCheck = positions.length - startIndex0;
    }

    uint minAllowedHealthFactor = uint(IController(controller).getMinHealthFactor2()) * 10**(18-2);

    // enumerate all pool adapters
    for (uint i = 0; i < maxCountToCheck; i = i.uncheckedInc()) {
      nextIndexToCheck0 += 1;

      // check if we need to make reconversion because the health factor is too low or a better borrow way exists
      IPoolAdapter pa = IPoolAdapter(positions[startIndex0 + i]);
      (uint collateralAmount,, uint healthFactor18,) = pa.getStatus();

      if (healthFactor18 < minAllowedHealthFactor
        || _findBetterBorrowWay(tc, pa, collateralAmount, healthFactor2, periodInBlocks)
      ) {
        outPoolAdapters[countFoundItems] = positions[startIndex0 + i];
        countFoundItems += 1;
        if (countFoundItems == maxCountToReturn) {
          break;
        }
      }
    }

    if (nextIndexToCheck0 == positions.length) {
      nextIndexToCheck0 = 0; // all items were checked
    }

    return (nextIndexToCheck0, countFoundItems, outPoolAdapters);
  }

  function _findBetterBorrowWay(
    ITetuConverter tc_,
    IPoolAdapter pa_,
    uint sourceAmount_,
    uint16 healthFactor2_,
    uint periodInBlocks_
  ) internal view returns (bool) {
    // check if we can re-borrow the asset in different place with higher profit
    (address origin,, address sourceToken, address targetToken) = pa_.getConfig();
    (address converter,, uint aprForPeriod18) = tc_.findConversionStrategy(
      sourceToken, sourceAmount_, targetToken, healthFactor2_, periodInBlocks_
    );
    uint currentApr18 = pa_.getAPR18() * periodInBlocks_;

    // make decision if the new conversion-strategy is worth to be used instead current one
    if (origin != converter) {
      //1) threshold for APRs difference exceeds threshold, i.e. (apr0-apr1)/apr0 > 20%
      if (thresholdAPR != 0
        && currentApr18 - aprForPeriod18 > currentApr18 * thresholdAPR / 100
      ) {
        //2) threshold for block number: count blocks since prev rebalancing should exceed the threshold.
        if (block.number - positionsRegistered[address(pa_)] > thresholdCountBlocks) {
          return true;
        }
      }
    }
    return false;
  }

  ///////////////////////////////////////////////////////
  ///      Get active borrows of the given user
  ///////////////////////////////////////////////////////
  function getPositions (
    address user_,
    address collateralToken_,
    address borrowedToken_
  ) external view override returns (
    address[] memory outPoolAdapters
  ) {
    address[] memory adapters = poolAdapters[user_][collateralToken_][borrowedToken_];
    uint countAdapters = adapters.length;

    outPoolAdapters = new address[](countAdapters);

    for (uint i = 0; i < countAdapters; i = i.uncheckedInc()) {
      outPoolAdapters[i] = adapters[i];
    }

    return outPoolAdapters;
  }

  ///////////////////////////////////////////////////////
  ///               Arrays lengths
  ///////////////////////////////////////////////////////

  /// @notice Get total count of pool adapters with opened positions
  function getCountPositions() external view override returns (uint) {
    return positions.length;
  }

  function poolAdaptersLength(
    address user_,
    address collateralToken_,
    address borrowedToken_
  ) external view returns (uint) {
    return poolAdapters[user_][collateralToken_][borrowedToken_].length;
  }
}
