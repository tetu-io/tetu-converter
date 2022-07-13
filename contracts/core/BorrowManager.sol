// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "./BorrowManagerStorage.sol";
import "./DataTypes.sol";
import "../interfaces/ILendingPlatform.sol";
import "../third_party/market/ICErc20.sol";
import "../third_party/IERC20Extended.sol";
import "hardhat/console.sol";

/// @notice Contains list of lending pools. Allow to select most efficient pool and delegate borrow-request there
contract BorrowManager is BorrowManagerStorage {

  constructor(address priceOracle_) {
    require(priceOracle_ != address(0), "price oracle not assigned");
    priceOracle = IPriceOracle(priceOracle_);
  }

  /*****************************************************/
  /*               Configurator                        */
  /*****************************************************/

  function addPlatform(string calldata title, address decorator) external override {
    uint newPlatformUid = platformsCount + 1;
    platformsCount = newPlatformUid;

    platforms[newPlatformUid].lendingPlatformUid = newPlatformUid;
    platforms[newPlatformUid].decorator = decorator;
    platforms[newPlatformUid].title = title;

    console.log("addPlatform platformsCount=%d newPlatformUid=%d", platformsCount, newPlatformUid);
  }

  /// @param assets Assets supported by the pool. Any asset can be source, any asset can be target asset.
  function addPool(uint platformUid, address poolAddress, address[] calldata assets) external override {
    console.log("addPool: platform=%d pool = %s", platformUid, poolAddress);
    uint lenAssets = assets.length;

    require(poolToPlatform[poolAddress] == 0, "Pool is already registered");
    poolToPlatform[poolAddress] = platformUid;

    for (uint i = 0; i < lenAssets; i = _uncheckedInc(i)) {
      for (uint j = i + 1; j < lenAssets; j = _uncheckedInc(j)) {
        bool inputFirst = assets[i] > assets[j];
        address tokenIn = inputFirst ? assets[i] : assets[j];
        address tokenOut = inputFirst ? assets[j] : assets[i];

        require(platforms[platformUid].lendingPlatformUid == platformUid, "Unknown platform");
        require(!assignedPoolsForAssets[tokenIn][tokenOut][poolAddress], "Pair is already registered");

        poolsForAssets[tokenIn][tokenOut].push(poolAddress);
        assignedPoolsForAssets[tokenIn][tokenOut][poolAddress] = true;
        console.log("New pool = %s platformUid=%d", poolAddress, platformUid);
        console.log("New tokenIn = %s", tokenIn);
        console.log("New tokenOut = %s", tokenOut);
      }
    }
  }

//  function addAssetToPool() external;
//  function removeAssetFromPool() external;
//  function setActivePoolPairAssets() external;

  /*****************************************************/
  /*               Borrow logic                        */
  /*****************************************************/

  /// @notice Find lending pool with best normalized borrow rate per ethereum block
  /// @dev Normalized borrow rate can include borrow-rate-per-block + any additional fees
  function getBestPool (
    address sourceToken,
    address targetToken
  ) external view override returns (address outPool, uint outBorrowRate) {
    // The borrow interest rate per block, scaled by 1e18
    address[] memory pools = poolsForAssets
      [sourceToken < targetToken ? sourceToken : targetToken]
      [sourceToken < targetToken ? targetToken : sourceToken];
    uint lenPools = pools.length;
    if (lenPools != 0) {
      for (uint i = 0; i < lenPools; i = _uncheckedInc(i)) {
        uint rate = ICErc20(pools[i]).borrowRatePerBlock();
        if (outPool == address(0) || rate < outBorrowRate) {
          outPool = pools[i];
          outBorrowRate = rate;
        }
      }
    }

    return (outPool, outBorrowRate);
  }

  /// @notice Calculate a collateral required to borrow {targetAmount} from the pool and get initial {healthFactor}
  function estimateSourceAmount (
    address pool,
    address sourceToken,
    address targetToken,
    uint targetAmount,
    uint96 healthFactor
  ) external view override returns (
    uint outSourceAmount
  ) {
    // Target amount = TA [TA], Health factor = HF [-], Collateral factor = CF [-]
    // Borrow amount = BS [USD], Source amount = SA [SA}, Price of source amount = PS [USD]
    // Price of target amount = PT [USD], Collateral amount = C [USD]
    // SA = PS * C,  C = CM * HF,  CM = BS / CF
    // Example: TA = 100[TA], PT = $2, PS = $5, CF = 0.8, HF = 2.0
    //          SA = (50 / 0.8) * 2.0 * 5 = 625 [SA] == $125
    //          We can borrow 100[TA] == $50, minimal collateral is $62.5, collateral with HF=2.0 is $125 == 625 [SA]

    console.log("pool = %s", pool);

    // take collateral factor of the pool
    uint platformUid = poolToPlatform[pool];
    require(platformUid != 0, "Pool not found");
    uint cf18 = ILendingPlatform(platforms[platformUid].decorator).getPoolInfo(pool, targetToken);

    // get prices of source and target assets
    uint ps18 = priceOracle.getAssetPrice(sourceToken);
    uint pt18 = priceOracle.getAssetPrice(targetToken);

    // get target amount with decimals 18
    uint targetDecimals = IERC20Extended(targetToken).decimals();
    uint ta18 = targetDecimals == 18
      ? targetAmount
      : toMantissa(targetAmount, targetDecimals, 18);

    console.log("4 ta=%d", ta18);
    console.log("ps18=%d", ps18);
    console.log("pt18=%d", pt18);
    console.log("healthFactor=%d", healthFactor);
    console.log("cf18=%d", cf18);

    // get required source amount
    require(pt18 != 0, "Zero target token price");
    require(cf18 != 0, "Zero collateral factor");

    uint sa18 = ps18 * (ta18 / pt18) * healthFactor / cf18;
    uint sourceDecimals = IERC20Extended(sourceToken).decimals();

    outSourceAmount = sourceDecimals == 18
      ? sa18
      : toMantissa(sa18, 18, sourceDecimals);
  }

  /// @notice Calculate a target amount that can be borrowed from the pool using {sourceAmount} as collateral
  ///         with initial {healthFactor}
  function estimateTargetAmount (
    address pool,
    address sourceToken,
    uint sourceAmount,
    address targetToken,
    uint96 healthFactor
  ) external view override returns (
    uint outTargetAmount
  ) {
    return outTargetAmount;
  }

  /// @notice Estimate result health factor after borrowing {targetAmount} from the pool
  ///         using {sourceAmount} as collateral
  function estimateHealthFactor (
    address pool,
    address sourceToken,
    uint sourceAmount,
    address targetToken,
    uint targetAmount
  ) external view override returns (
    uint96 outHealthFactor
  ) {
    return outHealthFactor;
  }

  /// @notice Borrow {targetAmount} from the pool using {sourceAmount} as collateral.
  /// @dev Result health factor cannot be less the default health factor specified for the target asset by governance.
  /// @param sourceToken Asset to be used as collateral
  /// @param sourceAmount Max available amount of collateral
  /// @param targetToken Asset to borrow
  /// @param targetAmount Required amount to borrow
  function borrow (
    address pool,
    address sourceToken,
    uint sourceAmount,
    address targetToken,
    uint targetAmount
  ) external override {
    uint platform = poolToPlatform[pool];
    require(platform != 0, "Pool not found");

    //TODO ILendingPlatform(platforms[platform].decorator).borrow()
  }

//  function borrow() external;
//  function borrowWithPool() external;
//
//  function getHealthFactor() external;
//  function getCollateralFactor() external;


  /*****************************************************/
  /*               Helper utils                        */
  /*****************************************************/

  function _uncheckedInc(uint i) internal pure returns (uint) {
    unchecked {
      return i + 1;
    }
  }

  /// @notice Convert {amount} with [sourceDecimals} to new amount with {targetDecimals}
  function toMantissa(uint amount, uint sourceDecimals, uint targetDecimals) public pure returns (uint) {
    return amount * (10 ** targetDecimals) / (10 ** sourceDecimals);
  }
}