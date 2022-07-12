// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../../third_party/market/ICErc20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../openzeppelin/SafeERC20.sol";
import "../../third_party/market/IComptroller.sol";
import "../../third_party/IERC20Extended.sol";
import "../../interfaces/IPriceOracle.sol";
import "../../core/DataTypes.sol";
import "../../interfaces/ILendingPlatform.sol";

/// @notice Lending Platform Market-XYZ, see https://docs.market.xyz/
contract MarketDecorator is ILendingPlatform {
  using SafeERC20 for IERC20;

  IPriceOracle public priceOracle;

  constructor(address priceOracle_) {
    require(priceOracle_ != address(0), "price oracle not assigned");
    priceOracle = IPriceOracle(priceOracle_);
  }

  /// @notice Estimate borrowing results
  /// @param pool A pool for source OR target assets. We need it to access comptroller.
  /// @return outCollateralAmount Required amount of collateral <= sourceAmount
  /// @return outEstimatedAmountToRepay How much target tokens should be paid at the end of the borrowing
  /// @return outErrorMessage A reason why the borrowing cannot be made; empty for success
  function buildBorrowPlan(
    address pool,
    DataTypes.BorrowParams memory params
  ) external view override returns (
    uint outCollateralAmount,
    uint outEstimatedAmountToRepay,
    string memory outErrorMessage
  ) {
//    // get max allowed amount to borrow in target tokens
//    uint amountSafeToBorrow = _getMaxSafeAmountToBorrow(pool, params);
//    if (params.targetAmount > amountSafeToBorrow) {
//      outErrorMessage = "Collateral is not enough";
//    } else {
//
//    }

    return (outCollateralAmount, outEstimatedAmountToRepay, outErrorMessage);
  }

  function _getMaxSafeAmountToBorrow(
    address pool,
    DataTypes.BorrowParams memory params
  ) internal view returns (uint) {
    // get all suitable pools that can provide allowed amount
    // select a pool with best conditions
    uint targetDecimals = IERC20Extended(params.targetToken).decimals();
    uint sourceDecimals = IERC20Extended(params.sourceToken).decimals();

    // get borrow rate [targetToken per block]
    uint borrowRate = ICErc20(pool).borrowRatePerBlock();

    // get max allowed amount to borrow [target tokens], scaled by 1e18
    uint dest = getAmountSafeToBorrow(
      sourceDecimals == 18
        ? params.sourceAmount
        : toMantissa(params.sourceAmount, sourceDecimals, 18),
      priceOracle.getAssetPrice(params.targetToken),
      priceOracle.getAssetPrice(params.sourceToken),
      _getCollateralFactor(pool, params.targetToken),
      params.minHealthFactor,
      targetDecimals == 18
        ? borrowRate
        : toMantissa(borrowRate, targetDecimals, 18),
      params.borrowDurationInBlocks,
      0 // there is no borrow fee on Market XYZ
    );

    return targetDecimals == 18
      ? dest
      : toMantissa(dest, 18, targetDecimals);
  }

  function _getCollateralFactor(address pool, address targetToken) internal view returns (uint) {
    IComptroller comptroller = IComptroller(ICErc20(pool).comptroller());
    // ensure that the target asset is in use and get its collateral factor scaled by 1e18
    (bool isListed, uint256 collateralFactorMantissa) = comptroller.markets(targetToken);
    require(isListed, "not listed");

    return collateralFactorMantissa;
  }

  /// @dev All values have decimals 18
  /// @param sourceAmount SA, Max allowed source amount to use it as collateral
  /// @param priceSourceUSD PS, price of the source asset in USD
  /// @param priceTargetUSD PT, price of the target asset in USD
  /// @param collateralFactor CF, collateral factor of the target pool
  /// @param minHealthFactor HE, required health factor at the end of the borrowing
  /// @param borrowRate BR, borrow rate [target tokens per block]
  /// @param borrowDurationInBlocks N, approx period of the borrowing in Ethereum blocks
  /// @param borrowFee BF, borrow fee [in target tokens]
  /// @return Safe to borrow amount in target tokens (but decimals = 18)
  function getAmountSafeToBorrow(
    uint sourceAmount,
    uint priceSourceUSD,
    uint priceTargetUSD,
    uint collateralFactor,
    uint minHealthFactor,
    uint borrowRate,
    uint borrowDurationInBlocks,
    uint borrowFee
  ) public pure returns (uint) {
    // Collateral = SS / PS
    uint sc = sourceAmount / priceSourceUSD;

    // Max allowed borrow amount: MB = SC/PT*CF
    uint mb = sc/priceTargetUSD * collateralFactor;

    // Required health factor at the beginning: HF = HE / (1 - HE * (N * BR + BF) / MB)
    uint hf = minHealthFactor / (1 - minHealthFactor * (borrowDurationInBlocks * borrowRate + borrowFee) / mb);

    return mb/hf;
  }

  /*****************************************************/
  /*               Helper utils                        */
  /*****************************************************/
  /// @notice Convert {amount} with [sourceDecimals} to new amount with {targetDecimals}
  function toMantissa(uint amount, uint sourceDecimals, uint targetDecimals) public pure returns (uint) {
    return amount * (10 ** sourceDecimals) / (10 ** targetDecimals);
  }
}
