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
        bool inputFirst = assets[i] < assets[j];
        address tokenIn = inputFirst ? assets[i] : assets[j];
        address tokenOut = inputFirst ? assets[j] : assets[i];

        require(platforms[platformUid].lendingPlatformUid == platformUid, "Unknown platform");
        require(!assignedPoolsForAssets[tokenIn][tokenOut][poolAddress], "Pair is already registered");

        poolsForAssets[tokenIn][tokenOut].push(poolAddress);
        assignedPoolsForAssets[tokenIn][tokenOut][poolAddress] = true;
        console.log("New pool = %s platformUid=%d", poolAddress, platformUid);
        console.log("New tokenIn = %s", tokenIn);
        console.log("New tokenOut = %s", tokenOut);
        console.log("New length = %s", poolsForAssets[tokenIn][tokenOut].length);
      }
    }
  }

//  function addAssetToPool() external;
//  function removeAssetFromPool() external;
//  function setActivePoolPairAssets() external;

  /*****************************************************/
  /*               Estimate logic                        */
  /*****************************************************/

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
    // Borrow amount = BS [USD], Source amount = SA [SA], Price of source amount = PS [USD/SA] (1 [SA] = PS[USD])
    // Price of target amount = PT [USD/TA] (1[TA] = PT[USD]), Collateral amount = C [USD]
    // SA = C / PS,  C = CM * HF,  CM = BS / CF
    // Example: TA = 100[TA], PT = 2[USD/TA], PS = 5[USD/SA], CF = 0.8, HF = 1.5
    //          BS = 100 * 2 = $200, SA = (200 / 0.8) * 1.5 / 5 = 75 [SA] == $375
    //          We can borrow 100[TA] == $200, minimal collateral is $250, collateral with HF=1.5 is $375 == 75 [SA]

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

    // get required source amount
    require(ps18 != 0, "Zero source token price");
    require(cf18 != 0, "Zero collateral factor");

    uint sa18 = (ta18 * pt18) / ps18 * healthFactor / cf18;
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
    // Source amount = SA [SA], Health factor = HF [-], Collateral factor = CF [-]
    // Borrow amount = BS [USD], Source amount = SA [SA], Price of source amount = PS [USD/SA] (1 [SA] = PS[USD])
    // Price of target amount = PT [USD/TA] (1[TA] = PT[USD]), Collateral amount = C [USD]
    // C = SA * PS, CM = C / HF, BS = CM * CF, TA = BS / PT
    // Example:
    //   SA = 1000[SA], PT = 2[USD/TA], PS = 5[USD/SA], CF = 0.8, HF = 2.5
    //   C = 1000[SA] * 5[$/SA] = $5000, CM = $5000/2.5 = $2000,  BS = $2000*0.8 = $1600, TA = $1600/2[$/ST] = 800 TA
    //   We can borrow 800[TA] == $1600, minimal collateral is $2000, collateral with HF=1.5 is $5000 == 1000 [SA]

    // take collateral factor of the pool
    uint platformUid = poolToPlatform[pool];
    require(platformUid != 0, "Pool not found");
    uint cf18 = ILendingPlatform(platforms[platformUid].decorator).getPoolInfo(pool, targetToken);

    // get prices of source and target assets
    uint ps18 = priceOracle.getAssetPrice(sourceToken);
    uint pt18 = priceOracle.getAssetPrice(targetToken);

    // get source amount with decimals 18
    uint sourceDecimals = IERC20Extended(sourceToken).decimals();

    uint sa18 = sourceDecimals == 18
      ? sourceAmount
      : toMantissa(sourceAmount, sourceDecimals, 18);

    // get required source amount
    require(pt18 != 0, "Zero target token price");
    require(cf18 != 0, "Zero collateral factor");

    uint ta18 = (sa18 * ps18) / pt18 * cf18 / healthFactor;

    uint targetDecimals = IERC20Extended(targetToken).decimals();
    outTargetAmount = targetDecimals == 18
      ? ta18
      : toMantissa(ta18, 18, targetDecimals);
  }

  /// @notice Estimate result health factor after borrowing {targetAmount} from the pool
  ///         using {sourceAmount} as collateral
  /// @return outHealthFactor Result health factor, decimals 18
  function estimateHealthFactor (
    address pool,
    address sourceToken,
    uint sourceAmount,
    address targetToken,
    uint targetAmount
  ) external view override returns (
    uint96 outHealthFactor
  ) {
    // Source amount = SA [SA], Target amount = TA [TA], Collateral factor = CF [-]
    // Borrow amount = BS [USD], Source amount = SA [SA], Price of source amount = PS [USD/SA] (1 [SA] = PS[USD])
    // Price of target amount = PT [USD/TA] (1[TA] = PT[USD]), Collateral amount = C [USD]
    // C = SA * PS, BS = TA * PT, CM = BS / CF, HF = C / CM
    // Example:
    //   SA = 3000[SA], TA = 2000[TA], PT = 2[USD/TA], PS = 5[USD/SA], CF = 0.8
    //   C=3000[SA]*5[USD/SA]=$15000, BS=2000[TA]*2[USD/TA=$4000, CM=$4000/0.8=$5000, HF=$15000/$5000=3
    //   We can borrow 2000[TA] == $4000, minimal collateral is $5000, collateral is $15000, health factor = 3

    // take collateral factor of the pool
    uint platformUid = poolToPlatform[pool];
    require(platformUid != 0, "Pool not found");
    uint cf18 = ILendingPlatform(platforms[platformUid].decorator).getPoolInfo(pool, targetToken);

    // get prices of source and target assets
    uint ps18 = priceOracle.getAssetPrice(sourceToken);
    uint pt18 = priceOracle.getAssetPrice(targetToken);

    // get source amount with decimals 18
    uint sourceDecimals = IERC20Extended(sourceToken).decimals();
    uint sa18 = sourceDecimals == 18
      ? sourceAmount
      : toMantissa(sourceAmount, sourceDecimals, 18);

    // get target amount with decimals 18
    uint targetDecimals = IERC20Extended(targetToken).decimals();
    uint ta18 = targetDecimals == 18
      ? targetAmount
      : toMantissa(targetAmount, targetDecimals, 18);

    // get required source amount
    require(pt18 != 0, "Zero target token price");
    require(ta18 != 0, "Zero target amount");

    return uint96(sa18 * ps18 * cf18 / (ta18 * pt18));
  }

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