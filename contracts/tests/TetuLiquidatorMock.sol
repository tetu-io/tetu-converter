// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../core/AppDataTypes.sol";
import "../interfaces/ITetuLiquidator.sol";
import "../openzeppelin/IERC20.sol";
import "../tests/IMockERC20.sol";
import "hardhat/console.sol";

// @notice This mock should be used with mockERC20 for liquidate
contract TetuLiquidatorMock is ITetuLiquidator {

  uint public constant SLIPPAGE_DENOMINATOR = 100_000;

  /// how much 1 token costs in USD, in token decimals
  mapping(address => uint256) public prices;
  int public slippage = 0;
  uint public priceImpact = 0;

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

  function changePrices(address[] memory assets, uint[] memory pricesInUSD) public {
    require(assets.length == pricesInUSD.length, "wrong lengths");
    for (uint i = 0; i < assets.length; ++i) {
      prices[assets[i]] = pricesInUSD[i];
      console.log("Price for %s is %d USD", assets[i], pricesInUSD[i]);
    }
  }

  ///////////////////////////////////////////////////////
  ///           ITetuLiquidator
  ///////////////////////////////////////////////////////

  function getPrice(address tokenIn, address tokenOut, uint amount)
  public override view returns (uint) {
    console.log('amount  ', amount);
    uint priceIn = prices[tokenIn];
    console.log('priceIn ', priceIn);
    require(priceIn != 0, 'L: Not found pool for tokenIn');
    uint8 decimalsIn = IMockERC20(tokenIn).decimals();

    uint priceOut = prices[tokenOut];
    require(priceOut != 0, 'L: Not found pool for tokenOut');
    uint8 decimalsOut = IMockERC20(tokenOut).decimals();
    console.log('priceOut', priceOut);

    return (priceIn * amount * 10**decimalsOut) / (priceOut * 10**decimalsIn);
  }

  function liquidate(
    address tokenIn,
    address tokenOut,
    uint amount,
    uint priceImpactTolerance
  ) external override {
    IMockERC20(tokenIn).burn(address(this), amount);

    uint amountOut = getPrice(tokenIn, tokenOut, amount);
    amountOut *= uint(int(SLIPPAGE_DENOMINATOR) - slippage) / SLIPPAGE_DENOMINATOR;
    require(priceImpactTolerance >= priceImpact, '!PRICE');

    IMockERC20(tokenOut).mint(msg.sender, amountOut);
  }

  function getPriceForRoute(PoolData[] memory /*route*/, uint /*amount*/)
  external override pure returns (uint) {
    revert('Not implemented');
  }

  function isRouteExist(address /*tokenIn*/, address /*tokenOut*/)
  external override pure returns (bool) {
    revert('Not implemented');
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
