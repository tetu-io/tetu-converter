// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "./DataTypes.sol";
import "../interfaces/ILendingPlatform.sol";
import "../integrations/market/ICErc20.sol";
import "../integrations/IERC20Extended.sol";
import "../interfaces/IBorrowManager.sol";
import "../interfaces/IPriceOracle.sol";
import "hardhat/console.sol";

/// @notice Contains list of lending pools. Allow to select most efficient pool and delegate borrow-request there
contract BorrowManager is IBorrowManager {
  //TODO contract version

  ///////////////////////////////////////////////////////
  ///                Structs and enums
  ///////////////////////////////////////////////////////

  /// @dev All input params for _findPool; 18 means that decimals 18 is used
  struct BorrowInput {
    address targetToken;
    uint96 healthFactor18;
    uint16 targetDecimals;
    uint sourceAmount18;
    uint targetAmount18;
    uint priceTarget18;
    uint priceSource18;
  }

  ///////////////////////////////////////////////////////
  ///                    Members
  ///////////////////////////////////////////////////////

  /// @notice Min allowed health factor = collateral / min allowed collateral.
  /// @dev Health factor < 1 produces liquidation immediately
  uint96 constant public MIN_HEALTH_FACTOR = 11e17; //TODO value?

  /// @notice Generator of unique ID of the lending platforms: 1, 2, 3..
  /// @dev UID of the last added platform
  uint public platformsCount;
  IPriceOracle public immutable priceOracle;

  /// @notice Decorator is a contract that "knows" how to work with the pool correctly.
  /// @dev 1 Decorator : N pools
  mapping(address => address) public poolToDecorator;

  /// @notice SourceToken => TargetToken => [all suitable pools]
  /// @dev SourceToken is always less then TargetToken
  mapping(address => mapping (address => address[])) public poolsForAssets;

  /// @notice Check if triple (source token, target token, pool) is already registered in {allPools}
  mapping(address => mapping (address => mapping (address => bool))) public assignedPoolsForAssets;

  /// @notice Default health factors (HF) for assets. Default HF is used if user hasn't provided HF value, decimals 18
  /// @dev Health factor = collateral / minimum collateral. It should be greater then MIN_HEALTH_FACTOR
  mapping(address => uint96) public defaultHealthFactors;

  ///////////////////////////////////////////////////////
  ///               Initialization
  ///////////////////////////////////////////////////////

  constructor(address priceOracle_) {
    require(priceOracle_ != address(0), "price oracle not assigned");
    priceOracle = IPriceOracle(priceOracle_);
  }

  ///////////////////////////////////////////////////////
  ///               Configuration
  ///////////////////////////////////////////////////////

  /// @param pool_ It's comptroller
  /// @param decorator_ Implementation of ILendingPlatform that knows how to work with the pool
  /// @param assets_ All assets supported by the pool (duplicates are not allowed)
  function addPool(address pool_, address decorator_, address[] calldata assets_) external override {
    uint lenAssets = assets_.length;

    require(poolToDecorator[pool_] == address(0), "Pool is already registered");
    poolToDecorator[pool_] = decorator_;

    for (uint i = 0; i < lenAssets; i = _uncheckedInc(i)) {
      for (uint j = i + 1; j < lenAssets; j = _uncheckedInc(j)) {
        bool inputFirst = assets_[i] < assets_[j];
        address tokenIn = inputFirst ? assets_[i] : assets_[j];
        address tokenOut = inputFirst ? assets_[j] : assets_[i];

        require(!assignedPoolsForAssets[tokenIn][tokenOut][pool_], "Pair is already registered");

        poolsForAssets[tokenIn][tokenOut].push(pool_);
        assignedPoolsForAssets[tokenIn][tokenOut][pool_] = true;
      }
    }
  }

  /// @notice Set default health factor for {asset}. Default value is used only if user hasn't provided custom value
  /// @param value Health factor must be greater then 1.
  function setHealthFactor(address asset, uint96 value) external override {
    require(value > MIN_HEALTH_FACTOR, "HF must be > MIN_HF");
    defaultHealthFactors[asset] = value;
  }

//  function addAssetToPool() external;
//  function removeAssetFromPool() external;
//  function setActivePoolPairAssets() external;

  ///////////////////////////////////////////////////////
  ///           Find best pool for borrowing
  ///////////////////////////////////////////////////////
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
    // Max target amount capable to be borrowed: ResultTA = BS / PT [TA].
    // We can use the pool only if ResultTA >= PTA >= TA

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
          healthFactor18: healthFactorOptional == 0
            ? defaultHealthFactors[targetToken]
            : healthFactorOptional,
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
    require(pp.healthFactor18 > MIN_HEALTH_FACTOR, "wrong health factor");
    require(pp.priceSource18 != 0, "source price is 0");

    uint lenPools = pools.length;
    for (uint i = 0; i < lenPools; i = _uncheckedInc(i)) {
      address pool = pools[i];

      (uint rate18,
       uint pcf18,
       uint pta
      ) = ILendingPlatform(poolToDecorator[pool]).getPoolInfo(pool, pp.targetToken);

      if (outPool == address(0) || rate18 < outBorrowRate) {
        // how much target asset we are able to get for the provided collateral with given health factor
        // TargetTA = BS / PT [TA], C = SA * PS, CM = C / HF, BS = CM * PCF
        uint resultTa18 = pcf18 * pp.sourceAmount18 * pp.priceSource18 / (pp.priceTarget18 * pp.healthFactor18);

        // this amount should be greater or equal to the min allowed amount and the pool should have enough liquidity
        if (resultTa18 >= pp.targetAmount18 && _toMantissa(pta, pp.targetDecimals, 18) >= resultTa18) {
          // take the pool with lowed borrow rate
          outPool = pool;
          outBorrowRate = rate18;
          outMaxTargetAmount = _toMantissa(resultTa18, 18, pp.targetDecimals);
        }
      }
    }

    return (outPool, outBorrowRate, outMaxTargetAmount);
  }


  ///////////////////////////////////////////////////////
  ///                   Borrow logic
  ///////////////////////////////////////////////////////

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

    //TODO ILendingPlatform(platforms[platform].decorator).borrow()
  }

//  function borrow() external;
//  function borrowWithPool() external;
//
//  function getHealthFactor() external;
//  function getCollateralFactor() external;


  ///////////////////////////////////////////////////////
  ///               Helper utils
  ///////////////////////////////////////////////////////

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

  function poolsForAssetsLength(address token1, address token2) public view returns (uint) {
    return poolsForAssets[token1][token2].length;
  }

}