// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "./DataTypes.sol";
import "../interfaces/IPlatformAdapter.sol";
import "../integrations/market/ICErc20.sol";
import "../integrations/IERC20Extended.sol";
import "../interfaces/IBorrowManager.sol";
import "../interfaces/IPriceOracle.sol";
import "hardhat/console.sol";
import "../openzeppelin/IERC20.sol";
import "../openzeppelin/SafeERC20.sol";
import "../base/BorrowManagerBase.sol";

/// @notice Contains list of lending pools. Allow to select most efficient pool and delegate borrow-request there
contract BorrowManager is BorrowManagerBase {
  using SafeERC20 for IERC20;

  ///////////////////////////////////////////////////////
  ///                Structs and enums
  ///////////////////////////////////////////////////////

  /// @dev All input params for _findPool; 18 means that decimals 18 is used
  struct BorrowInput {
    address targetToken;
    uint96 healthFactor18;
    uint16 targetDecimals;
    uint sourceAmount18;
    uint priceTarget18;
    uint priceSource18;
  }

  struct AdaptersForPlatform {
    /// @notice IPlatformAdapter implementation for the platform
    address platformAdapter;
    /// @notice IPoolAdapter implementation for the platforms. 0 for DEX, not 0 for lending platforms
    /// @dev This contract provides source code for pool adapters cloned through minimal proxy template
    address templatePoolAdapter;
  }

  ///////////////////////////////////////////////////////
  ///                    Members
  ///////////////////////////////////////////////////////

  /// @notice Min allowed health factor = collateral / min allowed collateral.
  /// @dev Health factor < 1 produces liquidation immediately
  uint96 constant public MIN_HEALTH_FACTOR = 11e17; //TODO value?

  /// @notice Platform adapter is a contract that "knows" how to work with the pool correctly.
  ///         pool => adapters ( 1 Platform adapter : N pools )
  mapping(address => AdaptersForPlatform) public poolToPlatformAdapter;

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

  constructor(address controller_)
    BorrowManagerBase(controller_)
  {

  }

  ///////////////////////////////////////////////////////
  ///               Configuration
  ///////////////////////////////////////////////////////

  /// @param pool_ It's comptroller
  /// @param platformAdapter_ Implementation of IPlatformAdapter that knows how to work with the pool
  /// @param templatePoolAdapter_ Implementation of IPoolAdapter for the lending platform
  /// @param assets_ All assets supported by the pool (duplicates are not allowed)
  function addPool(address pool_, address platformAdapter_, address templatePoolAdapter_, address[] calldata assets_)
  external override {
    uint lenAssets = assets_.length;

    require(poolToPlatformAdapter[pool_].platformAdapter == address(0), "Pool is already registered");
    poolToPlatformAdapter[pool_].platformAdapter = platformAdapter_;
    poolToPlatformAdapter[pool_].templatePoolAdapter = templatePoolAdapter_;

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
  function findPool(DataTypes.ExecuteFindPoolParams memory p_) external view override returns (
    address outPool,
    address outAdapter,
    uint outBorrowRate,
    uint outMaxTargetAmount
  ) {
    // Input params:
    // Health factor = HF [-], Collateral amount = C [USD]
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
      [p_.sourceToken < p_.targetToken ? p_.sourceToken : p_.targetToken]
      [p_.sourceToken < p_.targetToken ? p_.targetToken : p_.sourceToken];

    if (pools.length != 0) {
      (outPool, outAdapter, outBorrowRate, outMaxTargetAmount) = _findPool(pools
        , BorrowInput({
          targetToken: p_.targetToken,
          sourceAmount18: _toMantissa(p_.sourceAmount, uint16(IERC20Extended(p_.sourceToken).decimals()), 18),
          healthFactor18: p_.healthFactorOptional == 0
            ? defaultHealthFactors[p_.targetToken]
            : p_.healthFactorOptional,
          targetDecimals: IERC20Extended(p_.targetToken).decimals(),
          priceTarget18: IPriceOracle(controller.priceOracle()).getAssetPrice(p_.targetToken),
          priceSource18: IPriceOracle(controller.priceOracle()).getAssetPrice(p_.sourceToken)
        })
      );
    }

    return (outPool, outAdapter, outBorrowRate, outMaxTargetAmount);
  }

  /// @notice Enumerate all pools and select a pool suitable for borrowing with min borrow rate and enough underline
  function _findPool(address[] memory pools, BorrowInput memory pp) internal view returns (
    address outPool,
    address outAdapter,
    uint outBorrowRate,
    uint outMaxTargetAmount
  ) {
    require(pp.healthFactor18 > MIN_HEALTH_FACTOR, "wrong health factor");
    require(pp.priceSource18 != 0, "source price is 0");

    uint lenPools = pools.length;
    for (uint i = 0; i < lenPools; i = _uncheckedInc(i)) {
      address pool = pools[i];
      address adapter = poolToPlatformAdapter[pool].platformAdapter;

      (uint rate18,
       uint pcf18,
       uint pta
      ) = IPlatformAdapter(adapter).getPoolInfo(pool, pp.targetToken);

      if (outPool == address(0) || rate18 < outBorrowRate) {
        // how much target asset we are able to get for the provided collateral with given health factor
        // TargetTA = BS / PT [TA], C = SA * PS, CM = C / HF, BS = CM * PCF
        uint resultTa18 = pcf18 * pp.sourceAmount18 * pp.priceSource18 / (pp.priceTarget18 * pp.healthFactor18);

        // the pool should have enough liquidity
        if (_toMantissa(pta, pp.targetDecimals, 18) >= resultTa18) {
          // take the pool with lowed borrow rate
          outPool = pool;
          outAdapter = adapter;
          outBorrowRate = rate18;
          outMaxTargetAmount = _toMantissa(resultTa18, 18, pp.targetDecimals);
        }
      }
    }

    return (outPool, outAdapter, outBorrowRate, outMaxTargetAmount);
  }


  ///////////////////////////////////////////////////////
  ///                  Getters
  ///////////////////////////////////////////////////////

  function getPlatformAdapter(address pool_) external view override returns (
    address outPlatformAdapter,
    bool outIsLendingPlatform
  ) {
    AdaptersForPlatform memory aa = poolToPlatformAdapter[pool_];
    require(aa.platformAdapter != address(0), "wrong pool");

    return (aa.platformAdapter, aa.templatePoolAdapter == address(0));
  }

  function _getTemplatePoolAdapter(address pool_) internal view override returns (address) {
    return poolToPlatformAdapter[pool_].templatePoolAdapter;
  }

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