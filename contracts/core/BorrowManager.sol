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
  /*           Find best pool for borrowing            */
  /*****************************************************/
  /// @notice Find lending pool capable of providing {targetAmount} and having best normalized borrow rate
  /// @param sourceAmount Max possible collateral value is source tokens
  /// @param targetAmount Minimum required target amount; result outMaxTargetAmount must be greater or equal
  /// @param healthFactorOptional if 0 than default health factor specified for the target asset will be used
  /// @return outPool Result pool or 0 if a pool is not found
  /// @return outBorrowRate Pool normalized borrow rate per ethereum block
  /// @return outMaxTargetAmount Max available amount of target tokens that we can borrow using {sourceAmount}
  function findPool(
    address sourceToken,
    uint sourceAmount,
    address targetToken,
    uint targetAmount,
    uint96 healthFactorOptional
  ) external view override returns (
    address outPool,
    uint outBorrowRate,
    uint outMaxTargetAmount
  ) {
    // Input params:
    // Min allowed target amount = TA [TA], Health factor = HF [-], Collateral amount = C [USD]
    // Source amount that can be used for the collateral = SA [SA}, Borrow amount = BS [USD]
    // Price of the source amount = PS [USD/SA] (1 [SA] = PS[USD])
    // Price of the target amount = PT [USD/TA] (1[TA] = PT[USD]), Available cash in the pool = PTA[TA]
    // Pool params: Collateral factor of the pool = PCF [-], Free cash in the pool = PTA [TA]
    //
    // C = SA * PS, CM = C / HF, BS = CM * PCF
    // Max target amount capable to be borrowed: TargetTA = BS / PT [TA].
    // We can use the pool only if TargetTA >= PTA >= TA

    // get all available pools from poolsForAssets[smaller-address][higher-address]
    address[] memory pools = poolsForAssets
      [sourceToken < targetToken ? sourceToken : targetToken]
      [sourceToken < targetToken ? targetToken : sourceToken];

    if (pools.length != 0) {
      uint16 targetDecimals = uint16(IERC20Extended(targetToken).decimals());
      (outPool, outBorrowRate, outMaxTargetAmount) = _findPool(pools
        , BorrowInput({
          targetToken: targetToken,
          sourceAmount18: _toMantissa(sourceAmount, uint16(IERC20Extended(sourceToken).decimals()), 18),
          targetAmount18: _toMantissa(targetAmount, targetDecimals, 18),
          healthFactor18: healthFactorOptional,
          targetDecimals: IERC20Extended(targetToken).decimals(),
          priceTarget18: priceOracle.getAssetPrice(targetToken),
          priceSource18: priceOracle.getAssetPrice(sourceToken)
        })
      );
    }

    return (outPool, outBorrowRate, outMaxTargetAmount);
  }

  /// @notice Enumerate all pools and select a pool suitable for borrowing with min borrow rate and enough underline
  function _findPool(address[] memory pools, BorrowInput memory pp) internal view returns (
    address outPool,
    uint outBorrowRate,
    uint outMaxTargetAmount
  ) {
    require(pp.healthFactor18 > 1, "wrong health factor");
    require(pp.priceSource18 != 0, "target price is 0");

    uint lenPools = pools.length;
    for (uint i = 0; i < lenPools; i = _uncheckedInc(i)) {
      address pool = pools[i];

      (uint rate18,
       uint pcf18,
       uint pta
      ) = ILendingPlatform(platforms[poolToPlatform[pool]].decorator).getPoolInfo(pool, pp.targetToken);

      if (outPool == address(0) || rate18 < outBorrowRate) {
        // how much target asset we are able to get for the provided collateral with given health factor
        // TargetTA = BS / PT [TA], C = SA * PS, CM = C / HF, BS = CM * PCF
        uint targetTa18 = pcf18 * pp.sourceAmount18 * pp.priceSource18 / (pp.priceTarget18 * pp.healthFactor18);

        // this amount should be greater or equal to the min allowed amount and the pool should have enough liquidity
        if (targetTa18 >= pp.targetAmount18 && _toMantissa(pta, pp.targetDecimals, 18) >= targetTa18) {
          // take the pool with lowed borrow rate
          outPool = pool;
          outBorrowRate = rate18;
          outMaxTargetAmount = _toMantissa(targetTa18, 18, pp.targetDecimals);
        }
      }
    }

    return (outPool, outBorrowRate, outMaxTargetAmount);
  }


  /*****************************************************/
  /*                   Borrow logic                    */
  /*****************************************************/

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
  function _toMantissa(uint amount, uint16 sourceDecimals, uint16 targetDecimals) internal pure returns (uint) {
    return sourceDecimals == targetDecimals
      ? amount
      : amount * (10 ** targetDecimals) / (10 ** sourceDecimals);
  }

}