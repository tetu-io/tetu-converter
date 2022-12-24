// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "hardhat/console.sol";
import "./ISimulateTester.sol";
import "../../openzeppelin/IERC20.sol";
import "../../openzeppelin/SafeERC20.sol";

contract SimulateContainer {
  /**
    * Source: https://github.com/gnosis/util-contracts/blob/main/contracts/storage/StorageSimulation.sol
    *
    * @dev Performs a delegetecall on a targetContract in the context of self.
    * Internally reverts execution to avoid side effects (making it static).
    *
    * This method reverts with data equal to `abi.encode(bool(success), bytes(response))`.
    * Specifically, the `returndata` after a call to this method will be:
    * `success:bool || response.length:uint256 || response:bytes`.
    *
    * @param targetContract Address of the contract containing the code to execute.
    * @param calldataPayload Calldata that should be sent to the target contract (encoded method name and arguments).
    */
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

  /**
     * Source: https://github.com/gnosis/util-contracts/blob/main/contracts/storage/StorageAccessible.sol
     * @dev Simulates a delegate call to a target contract in the context of self.
     *
     * Internally reverts execution to avoid side effects (making it static).
     * Catches revert and returns encoded result as bytes.
     *
     * @param targetContract Address of the contract containing the code to execute.
     * @param calldataPayload Calldata that should be sent to the target contract (encoded method name and arguments).
     */
  function simulate(
    address targetContract,
    bytes calldata calldataPayload
  ) public returns (bytes memory response) {
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

  ////////////////////////////////////////////////////////////////
  ///  Simulate real swap using try/catch()
  ////////////////////////////////////////////////////////////////
  function callTryCatchSwapUsingTetuLiquidator(
    address simulateTester_,
    address tetuLiquidator,
    address sourceAsset_,
    uint sourceAmount_,
    address targetAsset_
  ) external returns (uint result) {
    console.log("callTryCatchSwapUsingTetuLiquidator.1");

    ISimulateTester simulateTester = ISimulateTester(simulateTester_);
    try simulateTester.makeSwapUsingTetuLiquidatorWithRevert(
      tetuLiquidator,
      sourceAsset_,
      sourceAmount_,
      targetAsset_
    ) {
      console.log("simulateTester.makeSwapUsingTetuLiquidator.no revert?");
      require(false, "no revert?");
    } catch (bytes memory reason) {
      console.log("simulateTester.makeSwapUsingTetuLiquidator.catch.1");
//      bytes4 expectedSelector = SimulateContainer.ErrorWithAmount.selector;
//      bytes4 receivedSelector = bytes4(reason);
//      require(expectedSelector == receivedSelector, "smth is wrong");
//      console.log("simulateTester.makeSwapUsingTetuLiquidator.catch.2");
      uint amount = abi.decode(extractCalldata(reason), (uint));
      console.log("simulateTester.makeSwapUsingTetuLiquidator.catch.3", amount);
      result = amount;
    }

    uint balanceSourceAfterRevert = IERC20(sourceAsset_).balanceOf(address(this));
    uint balanceTargetAfterRevert = IERC20(targetAsset_).balanceOf(address(this));
    console.log("callTryCatchSwapUsingTetuLiquidator.balanceSourceAfterRevert", balanceSourceAfterRevert);
    console.log("callTryCatchSwapUsingTetuLiquidator.balanceTargetAfterRevert", balanceTargetAfterRevert);

    console.log("callSimulateMakeSwapUsingTetuLiquidator.result", result);
    return result;
  }

  /// @dev https://ethereum.stackexchange.com/questions/131283/how-do-i-decode-call-data-in-solidity
  function extractCalldata(bytes memory calldataWithSelector) internal pure returns (bytes memory) {
    bytes memory calldataWithoutSelector;

    require(calldataWithSelector.length >= 4);

    assembly {
      let totalLength := mload(calldataWithSelector)
      let targetLength := sub(totalLength, 4)
      calldataWithoutSelector := mload(0x40)

    // Set the length of callDataWithoutSelector (initial length - 4)
      mstore(calldataWithoutSelector, targetLength)

    // Mark the memory space taken for callDataWithoutSelector as allocated
      mstore(0x40, add(0x20, targetLength))

    // Process first 32 bytes (we only take the last 28 bytes)
      mstore(add(calldataWithoutSelector, 0x20), shl(0x20, mload(add(calldataWithSelector, 0x20))))

    // Process all other data by chunks of 32 bytes
      for { let i := 0x1C } lt(i, targetLength) { i := add(i, 0x20) } {
        mstore(add(add(calldataWithoutSelector, 0x20), i), mload(add(add(calldataWithSelector, 0x20), add(i, 0x04))))
      }
    }

    return calldataWithoutSelector;
  }
}