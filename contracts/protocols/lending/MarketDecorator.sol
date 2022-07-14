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

  /// @notice get data of the pool
  /// @param pool = comptroller
  /// @return borrowRatePerBlock Normalized borrow rate can include borrow-rate-per-block + any additional fees
  /// @return collateralFactor Current collateral factor [0..1e18], where 1e18 is corresponded to CF=1
  /// @return availableCash Available underline in the pool. 0 if the market is unlisted
  function getPoolInfo(address pool, address underline)
  external
  view
  override
  returns (
    uint borrowRatePerBlock,
    uint collateralFactor,
    uint availableCash
  ) {
    address cToken = IComptroller(pool).cTokensByUnderlying(underline);
    (bool isListed, uint cf) = IComptroller(pool).markets(cToken);
    availableCash = isListed
      ? ICErc20(cToken).getCash()
      : 0; //the marked is unlisted, no cash is available
    borrowRatePerBlock = ICErc20(cToken).borrowRatePerBlock();
    collateralFactor = cf;
  }

  function borrow(
    address pool,
    DataTypes.BorrowParams calldata params
  ) external override {

  }


  /*****************************************************/
  /*               Helper utils                        */
  /*****************************************************/
  /// @notice Convert {amount} with [sourceDecimals} to new amount with {targetDecimals}
  function toMantissa(uint amount, uint sourceDecimals, uint targetDecimals) public pure returns (uint) {
    return amount * (10 ** targetDecimals) / (10 ** sourceDecimals);
  }
}
