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
  ///  Simulate real swap using simulate() - two contracts
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

  ////////////////////////////////////////////////////////////////
  ///  Make real swap and revert with a custom error
  ////////////////////////////////////////////////////////////////

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


  ////////////////////////////////////////////////////////////////
  ///  Simulate real swap using simulate() - try to use single contract
  ////////////////////////////////////////////////////////////////
  function callSimulateMakeSwapUsingTetuLiquidatorSingleContract(
    address tetuLiquidator,
    address sourceAsset,
    uint sourceAmount,
    address targetAsset
  ) external returns (uint) {
    console.log("callSimulateMakeSwapUsingTetuLiquidatorSingleContract.1");

    uint response = abi.decode(
      ISimulateTester(address(this)).simulateLocal(
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
    console.log("callSimulateMakeSwapUsingTetuLiquidatorSingleContract.response", response);
    return response;
  }

  ////////////////////////////////////////////////////////////////
  ///  simulate() for callSimulateMakeSwapUsingTetuLiquidatorSingleContract impl
  ////////////////////////////////////////////////////////////////

  /// Source: https://github.com/gnosis/util-contracts/blob/main/contracts/storage/StorageSimulation.sol
  ///
  /// @dev Performs a delegetecall on a targetContract in the context of self.
  /// Internally reverts execution to avoid side effects (making it static).
  ///
  /// This method reverts with data equal to `abi.encode(bool(success), bytes(response))`.
  /// Specifically, the `returndata` after a call to this method will be:
  /// `success:bool || response.length:uint256 || response:bytes`.
  ///
  /// @param targetContract Address of the contract containing the code to execute.
  /// @param calldataPayload Calldata that should be sent to the target contract (encoded method name and arguments).
  function simulateAndRevert(
    address targetContract,
    bytes memory calldataPayload
  ) public {
    assembly {
      let success := delegatecall(
      gas(),
      targetContract,
      add(calldataPayload, 0x20),
      mload(calldataPayload),
      0,
      0
      )

      mstore(0x00, success)
      mstore(0x20, returndatasize())
      returndatacopy(0x40, 0, returndatasize())
      revert(0, add(returndatasize(), 0x40))
    }
  }

  ///  Source: https://github.com/gnosis/util-contracts/blob/main/contracts/storage/StorageAccessible.sol
  ///  @dev Simulates a delegate call to a target contract in the context of self.
  ///
  ///  Internally reverts execution to avoid side effects (making it static).
  ///  Catches revert and returns encoded result as bytes.
  ///
  ///  @param targetContract Address of the contract containing the code to execute.
  ///  @param calldataPayload Calldata that should be sent to the target contract (encoded method name and arguments).
  function simulateLocal(
    address targetContract,
    bytes calldata calldataPayload
  ) external override returns (bytes memory response) {
    // Suppress compiler warnings about not using parameters, while allowing
    // parameters to keep names for documentation purposes. This does not
    // generate code.
    targetContract;
    calldataPayload;

    assembly {
      let internalCalldata := mload(0x40)
    // Store `simulateAndRevert.selector`.
      mstore(internalCalldata, "\xb4\xfa\xba\x09")
    // Abuse the fact that both this and the internal methods have the
    // same signature, and differ only in symbol name (and therefore,
    // selector) and copy calldata directly. This saves us approximately
    // 250 bytes of code and 300 gas at runtime over the
    // `abi.encodeWithSelector` builtin.
      calldatacopy(
      add(internalCalldata, 0x04),
      0x04,
      sub(calldatasize(), 0x04)
      )

    // `pop` is required here by the compiler, as top level expressions
    // can't have return values in inline assembly. `call` typically
    // returns a 0 or 1 value indicated whether or not it reverted, but
    // since we know it will always revert, we can safely ignore it.
      pop(call(
      gas(),
      address(),
      0,
      internalCalldata,
      calldatasize(),
      // The `simulateAndRevert` call always reverts, and instead
      // encodes whether or not it was successful in the return data.
      // The first 32-byte word of the return data contains the
      // `success` value, so write it to memory address 0x00 (which is
      // reserved Solidity scratch space and OK to use).
      0x00,
      0x20
      ))


    // Allocate and copy the response bytes, making sure to increment
    // the free memory pointer accordingly (in case this method is
    // called as an internal function). The remaining `returndata[0x20:]`
    // contains the ABI encoded response bytes, so we can just write it
    // as is to memory.
      let responseSize := sub(returndatasize(), 0x20)
      response := mload(0x40)
      mstore(0x40, add(response, responseSize))
      returndatacopy(response, 0x20, responseSize)

      if iszero(mload(0x00)) {
        revert(add(response, 0x20), mload(response))
      }
    }
  }
}