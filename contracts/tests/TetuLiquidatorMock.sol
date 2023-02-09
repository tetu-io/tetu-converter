// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../libs/AppDataTypes.sol";
import "../interfaces/ITetuLiquidator.sol";
import "../openzeppelin/IERC20.sol";
import "../tests/tokens/IMockERC20.sol";
import "hardhat/console.sol";

// @notice This mock should be used with mockERC20 for liquidate
contract TetuLiquidatorMock is ITetuLiquidator {

  uint public constant SLIPPAGE_NOMINATOR = 100_000;
  uint public constant PRICE_IMPACT_NUMERATOR = 100_000;

  /// how much 1 token costs in USD, in token decimals
  mapping(address => uint256) public prices;
  int public slippage = 0;
  uint public priceImpact = 0;
  bool public disablePriceException = false;

  constructor(address[] memory assets, uint[] memory pricesInUSD) {
    changePrices(assets, pricesInUSD);
  }

  ///////////////////////////////////////////////////////
  ///           Set up
  ///////////////////////////////////////////////////////

  function setSlippage(int slippage_) external {
    slippage = slippage_;
  }

  function setPriceImpact(uint priceImpact_) external {
    priceImpact = priceImpact_;
  }

  function setDisablePriceException(bool disable_) external {
    disablePriceException = disable_;
  }

  function changePrices(address[] memory assets, uint[] memory pricesInUSD) public {
    require(assets.length == pricesInUSD.length, "wrong lengths");
    for (uint i = 0; i < assets.length; ++i) {
      prices[assets[i]] = pricesInUSD[i];
    }
  }

  ///////////////////////////////////////////////////////
  ///           ITetuLiquidator
  ///////////////////////////////////////////////////////

  function getPrice(address tokenIn, address tokenOut, uint amount) public override view returns (uint amountOut) {
    uint priceIn = prices[tokenIn];
    if (priceIn == 0) {
      // there is no conversion way, return 0 in same way as the real liquidator
      return 0;
    }
    uint8 decimalsIn = IMockERC20(tokenIn).decimals();

    uint priceOut = prices[tokenOut];
    if (priceOut == 0) {
      // there is no conversion way, return 0 in same way as the real liquidator
      return 0;
    }
    uint8 decimalsOut = IMockERC20(tokenOut).decimals();

    amountOut = (priceIn * amount * 10**decimalsOut) / (priceOut * 10**decimalsIn);
    amountOut = amountOut * uint(int(PRICE_IMPACT_NUMERATOR) - int(priceImpact)) / PRICE_IMPACT_NUMERATOR;
    console.log("TetuLiquidatorMock.getPrice.amountOut", amountOut);
  }

  function liquidate(
    address tokenIn,
    address tokenOut,
    uint amount,
    uint priceImpactTolerance
  ) external override {
    // real tetu liquidator requires approve() before calling liquidate(), so the mock requires too.
    IERC20(tokenIn).transferFrom(msg.sender, address(this), amount);
    IMockERC20(tokenIn).burn(address(this), amount);
    uint amountOut = getPrice(tokenIn, tokenOut, amount);
    console.log("TetuLiquidatorMock.liquidate.amountOut,amountIn", amountOut, amount);
    amountOut = amountOut * uint(int(SLIPPAGE_NOMINATOR) - slippage) / SLIPPAGE_NOMINATOR;
    require(disablePriceException || priceImpactTolerance >= priceImpact, '!PRICE');
    IMockERC20(tokenOut).mint(msg.sender, amountOut);
  }

  function getPriceForRoute(PoolData[] memory /*route*/, uint /*amount*/)
  external override pure returns (uint) {
    revert('Not implemented');
  }

  function isRouteExist(address tokenIn, address tokenOut)
  external override view returns (bool) {
    return prices[tokenIn] != 0 && prices[tokenOut] != 0;
  }

  function buildRoute(
    address /*tokenIn*/,
    address /*tokenOut*/
  ) external override pure returns (PoolData[] memory /*route*/, string memory /*errorMessage*/) {
   revert('Not implemented');
  }

  function liquidateWithRoute(
    PoolData[] memory /*route*/,
    uint /*amount*/,
    uint /*priceImpactTolerance*/
  ) external override pure {
    revert('Not implemented');
  }

}
