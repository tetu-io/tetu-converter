// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../../integrations/market/ICErc20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../openzeppelin/SafeERC20.sol";
import "../../integrations/market/IComptroller.sol";
import "../../integrations/IERC20Extended.sol";
import "../../integrations/IWmatic.sol";
import "../../interfaces/IPriceOracle.sol";
import "../../core/DataTypes.sol";
import "../../interfaces/ILendingPlatform.sol";

/// @notice Lending Platform Market-XYZ, see https://docs.market.xyz/
contract MarketDecorator is ILendingPlatform {
  using SafeERC20 for IERC20;

  address public constant W_MATIC = 0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270;
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

  /*****************************************************/
  /*               Borrow logic                        */
  /*****************************************************/
  function borrow(
    address pool,
    address sourceToken,
    uint sourceAmount,
    address targetToken,
    uint targetAmount
  ) external override {
    IComptroller comptroller = IComptroller(pool);
    //address cSourceToken = IComptroller(pool).cTokensByUnderlying(cSourceToken);

    // Supply collateral
//    _supply(sourceToken, cSourceToken, )

    // Borrow
  }

//  function _supply(
//    address underlineToken_,
//    address cToken_,
//    uint amount_
//  ) internal {
//    amount_ = Math.min(IERC20(underlineToken_).balanceOf(address(this)), amount_); //TODO do we need this check?
//    if (_isMatic()) {
//      require(IERC20(W_MATIC).balanceOf(address(this)) >= amount, "Market: Not enough wmatic");
//      IWmatic(W_MATIC).withdraw(amount);
//      ICErc20(cToken_).mint{value : amount_}();
//    } else {
//      IERC20(underlineToken_).safeApprove(cToken_, 0);
//      IERC20(underlineToken_).safeApprove(cToken_, amount_);
//      require(ICErc20(cToken_).mint(amount_) == 0, "Market: Supplying failed");
//    }
//  }

  /*****************************************************/
  /*               Helper utils                        */
  /*****************************************************/
  function _isMatic(address token) internal view returns (bool) {
    return token == W_MATIC;
  }
}
