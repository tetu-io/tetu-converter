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


  /// @notice Get normalized borrow rate per block, scaled by 1e18
  /// @dev Normalized borrow rate can include borrow-rate-per-block + any additional fees
  function getBorrowRate(
    address pool,
    address sourceToken,
    address targetToken
  ) external view override returns (uint) {
    // The borrow interest rate per block, scaled by 1e18
    // There are no additional fees (fuseFee and adminFee are included to the borrow rate)
    return ICErc20(pool).borrowRatePerBlock();
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
    return amount * (10 ** sourceDecimals) / (10 ** targetDecimals);
  }
}
