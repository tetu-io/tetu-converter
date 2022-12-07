// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "./SimulateContainer.sol";
import "../../interfaces/ITetuLiquidator.sol";
import "../../openzeppelin/IERC20.sol";
import "../../openzeppelin/SafeERC20.sol";
import "./ISimulateTester.sol";

contract SimulateTester is ISimulateTester {
  using SafeERC20 for IERC20;
  uint public swapResult;

  ////////////////////////////////////////////////////////////////
  ///  Simulate call of makeSwap function using simulate()
  ////////////////////////////////////////////////////////////////
  function makeSwapStub(uint inputValue) external returns (uint) {
    swapResult = 77;
    return swapResult + inputValue;
  }

  function callSimulateMakeSwapStub(SimulateContainer container) external returns (uint) {
    console.log("callSimulateMakeSwapStub.1");
    uint response = abi.decode(
      container.simulate(
        address(this),
        abi.encodeWithSelector(SimulateTester.makeSwapStub.selector, 2)
      ),
      (uint)
    );
    console.log("callSimulateMakeSwapStub.response", response);
    console.log("callSimulateMakeSwapStub.swapResult", swapResult);
    return response;
  }

  ////////////////////////////////////////////////////////////////
  ///  Simulate real swap using simulate()
  ////////////////////////////////////////////////////////////////
  function makeSwapUsingTetuLiquidator(
    address tetuLiquidatorAddress,
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_
  ) external returns (uint) {
    console.log("makeSwapUsingTetuLiquidator", address(this), sourceAmount_);

    uint balanceSourceBefore = IERC20(sourceToken_).balanceOf(address(this));
    uint balanceTargetBefore = IERC20(targetToken_).balanceOf(address(this));
    console.log("makeSwapUsingTetuLiquidator.balanceSourceBefore", balanceSourceBefore);
    console.log("makeSwapUsingTetuLiquidator.balanceTargetBefore", balanceTargetBefore);

    IERC20(sourceToken_).safeApprove(tetuLiquidatorAddress, sourceAmount_);
    ITetuLiquidator tetuLiquidator = ITetuLiquidator(tetuLiquidatorAddress);
    tetuLiquidator.liquidate(sourceToken_, targetToken_, sourceAmount_, 2000);

    uint balanceSourceAfter = IERC20(sourceToken_).balanceOf(address(this));
    uint balanceTargetAfter = IERC20(targetToken_).balanceOf(address(this));
    console.log("source balance dif", balanceSourceBefore, balanceSourceAfter);
    console.log("target balance dif", balanceTargetBefore, balanceTargetAfter);

    return balanceTargetAfter - balanceTargetBefore;
  }

  function makeSwapUsingTetuLiquidatorWithRevert(
    address tetuLiquidatorAddress,
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_
  ) external override {
    console.log("makeSwapUsingTetuLiquidator", address(this), sourceAmount_);

    uint balanceSourceBefore = IERC20(sourceToken_).balanceOf(address(this));
    uint balanceTargetBefore = IERC20(targetToken_).balanceOf(address(this));
    console.log("makeSwapUsingTetuLiquidator.balanceSourceBefore", balanceSourceBefore);
    console.log("makeSwapUsingTetuLiquidator.balanceTargetBefore", balanceTargetBefore);

    IERC20(sourceToken_).safeApprove(tetuLiquidatorAddress, sourceAmount_);
    ITetuLiquidator tetuLiquidator = ITetuLiquidator(tetuLiquidatorAddress);
    tetuLiquidator.liquidate(sourceToken_, targetToken_, sourceAmount_, 2000);

    uint balanceSourceAfter = IERC20(sourceToken_).balanceOf(address(this));
    uint balanceTargetAfter = IERC20(targetToken_).balanceOf(address(this));
    console.log("source balance dif", balanceSourceBefore, balanceSourceAfter);
    console.log("target balance dif", balanceTargetBefore, balanceTargetAfter);

    revert ErrorWithAmount(balanceTargetAfter - balanceTargetBefore);
  }

  function callSimulateMakeSwapUsingTetuLiquidator(
    SimulateContainer container,
    address tetuLiquidator,
    address sourceAsset,
    uint sourceAmount,
    address targetAsset
  ) external returns (uint) {
    console.log("callSimulateMakeSwapUsingTetuLiquidator.1");

    uint response = abi.decode(
      container.simulate(
        address(this),
        abi.encodeWithSelector(
            SimulateTester.makeSwapUsingTetuLiquidator.selector,
            tetuLiquidator,
            sourceAsset,
            sourceAmount,
            targetAsset
        )
      ),
      (uint)
    );
    console.log("callSimulateSwap.response", response);
    return response;
  }


}