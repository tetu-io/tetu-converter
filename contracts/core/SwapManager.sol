// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../interfaces/ITetuLiquidator.sol";
import "../openzeppelin/IERC20Metadata.sol";
import "../openzeppelin/IERC20.sol";
import "../openzeppelin/SafeERC20.sol";
import "../interfaces/ISwapManager.sol";
import "../interfaces/IController.sol";
import "../interfaces/ISwapConverter.sol";
import "./AppErrors.sol";
import "./AppDataTypes.sol";
import "../interfaces/IPriceOracle.sol";
import "hardhat/console.sol";
import "../interfaces/ISimulateProvider.sol";
import "../interfaces/ISwapSimulator.sol";
import "../interfaces/IClaimAmountCallback.sol";
import "./TetuConverter.sol";

/// @title Contract to find the best swap and make the swap
/// @notice Combines Manager and Converter
/// @author bogdoslav
contract SwapManager is ISwapManager, ISwapConverter, ISimulateProvider, ISwapSimulator {
  using SafeERC20 for IERC20;

  IController public immutable controller;

  ///////////////////////////////////////////////////////
  ///               Constants
  ///////////////////////////////////////////////////////

  uint public constant PRICE_IMPACT_NUMERATOR = 100_000;
  uint public constant PRICE_IMPACT_TOLERANCE = PRICE_IMPACT_NUMERATOR * 2 / 100; // 2%

  int public constant APR_NUMERATOR = 10**18;

  ///////////////////////////////////////////////////////
  ///               Events
  ///////////////////////////////////////////////////////
  event OnSwap(address sourceToken,
    uint sourceAmount,
    address targetToken,
    uint targetAmount,
    address receiver,
    uint outputAmount
  );

  ///////////////////////////////////////////////////////
  ///               Initialization
  ///////////////////////////////////////////////////////

  constructor (address controller_) {
    require(
      controller_ != address(0),
      AppErrors.ZERO_ADDRESS
    );
    controller = IController(controller_);
  }

  ///////////////////////////////////////////////////////
  ///           Return best amount for swap
  ///////////////////////////////////////////////////////

  /// @notice Find a way to convert collateral asset to borrow asset in most efficient way
  ///         The algo to convert source amount S1:
  ///         - make real swap in static-call, get result max-target-amount
  ///         - recalculate max-target-amount to source amount using prices from a PriceOracle = S2
  ///         Result APR = 2 * (S1 - S2) / S1
  /// @dev This is a writable function with read-only behavior
  ///      because to simulate real swap the function should be writable.
  /// @param sourceAmountApprover_ A contract which has approved {sourceAmount_} to TetuConverter
  /// @param sourceAmount_ Amount in terms of {sourceToken_} to be converter to {targetToken_}
  /// @return converter Address of ISwapConverter
  ///         If SwapManager cannot find a conversion way,
  ///         it returns converter == 0 (in the same way as ITetuConverter)
  function getConverter(
    address sourceAmountApprover_,
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_
  ) external override returns (
    address converter,
    uint maxTargetAmount,
    int apr18
  ) {
    console.log("SwapManager.getConverter");
    // simulate real swap of source amount to max target amount
    try ISimulateProvider(address(this)).simulate(
      address(this),
      abi.encodeWithSelector(
        ISwapSimulator.simulateSwap.selector,
        sourceAmountApprover_,
        sourceToken_,
        sourceAmount_,
        targetToken_
      )
    ) returns (bytes memory response) {
      maxTargetAmount = abi.decode(response, (uint));
      console.log("SwapManager.maxTargetAmount", maxTargetAmount);
    } catch {
      // we can have i.e. !PRICE error here
      // it means, there is no way to make the conversion with acceptable price impact
      console.log("SwapManager.!PRICE");
      return (address(0), 0, 0);
    }


    if (maxTargetAmount != 0) {
      converter = address(this);
      console.log("SwapManager.1");
      IPriceOracle priceOracle = IPriceOracle(controller.priceOracle());
      console.log("SwapManager.2", priceOracle.getAssetPrice(targetToken_));
      console.log("SwapManager.2", priceOracle.getAssetPrice(sourceToken_));

      uint priceSource = priceOracle.getAssetPrice(sourceToken_);
      require(priceSource != 0, AppErrors.ZERO_PRICE);

      uint maxTargetAmountInSourceTokens = maxTargetAmount
        * 10**IERC20Metadata(sourceToken_).decimals()
        * priceOracle.getAssetPrice(targetToken_)
        / priceSource
        / 10**IERC20Metadata(targetToken_).decimals();
      console.log("SwapManager.sourceAmount", sourceAmount_);
      console.log("SwapManager.maxTargetAmount", maxTargetAmount);
      console.log("SwapManager.IERC20Metadata(p_.sourceToken).decimals()", IERC20Metadata(sourceToken_).decimals());
      console.log("SwapManager.priceOracle.getAssetPrice(p_.targetToken)", priceOracle.getAssetPrice(targetToken_));
      console.log("SwapManager.priceOracle.getAssetPrice(p_.sourceToken)", priceOracle.getAssetPrice(sourceToken_));
      console.log("SwapManager.IERC20Metadata(p_.targetToken).decimals()", IERC20Metadata(targetToken_).decimals());
      console.log("SwapManager.maxTargetAmountInSourceTokens", maxTargetAmountInSourceTokens);

      int loss = 2 * (int(sourceAmount_) - int(maxTargetAmountInSourceTokens));
      apr18 = loss * APR_NUMERATOR / int(sourceAmount_);

      console.log("Predicted loss");
      console.logInt(loss);
    }

    return (converter, maxTargetAmount, apr18);
  }


  /// @notice Same as {getConverter} but it doesn't calculate APR
  function findConverter(
    address sourceAmountApprover_,
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_
  ) external override returns (
    address converter,
    uint maxTargetAmount
  ) {
    maxTargetAmount = abi.decode(
      ISimulateProvider(address(this)).simulate(
        controller.tetuConverter(),
        abi.encodeWithSelector(
          ISwapSimulator.simulateSwap.selector,
          sourceAmountApprover_,
          sourceToken_,
          sourceAmount_,
          targetToken_
        )
      ),
      (uint)
    );
    return maxTargetAmount == 0
      ? (converter, maxTargetAmount)
      : (address(this), maxTargetAmount);
  }

  ///////////////////////////////////////////////////////
  ///           ISwapConverter Implementation
  ///////////////////////////////////////////////////////

  function getConversionKind()
  override external pure returns (AppDataTypes.ConversionKind) {
    return AppDataTypes.ConversionKind.SWAP_1;
  }

  /// @notice Swap {sourceAmount_} of {sourceToken_} to {targetToken_} and send result amount to {receiver_}
  ///         The swapping is made using TetuLiquidator.
  /// @param targetAmount_ Amount that should be received after swapping.
  ///                      Result amount can be a bit different from the target amount because of slippage.
  ///                      0 - any amount is ok.
  ///                      not 0 - we need to ensure that slippage doesn't exceed a threshold
  /// @return outputAmount The amount that has been sent to the receiver
  function swap(
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint targetAmount_,
    address receiver_
  ) override external returns (uint outputAmount) {
    uint targetTokenBalanceBefore = IERC20(targetToken_).balanceOf(address(this));

    ITetuLiquidator tetuLiquidator = ITetuLiquidator(controller.tetuLiquidator());
    IERC20(sourceToken_).safeApprove(address(tetuLiquidator), sourceAmount_);

    // If price impact is too big, getConverter will return high APR
    // So TetuConverter will select borrow, not swap.
    // If the swap was selected anyway, it is wrong case.
    // liquidate() will revert here and it's ok.
    tetuLiquidator.liquidate(sourceToken_, targetToken_, sourceAmount_, PRICE_IMPACT_TOLERANCE);
    outputAmount = IERC20(targetToken_).balanceOf(address(this)) - targetTokenBalanceBefore;

    IERC20(targetToken_).safeTransfer(receiver_, outputAmount);
    emit OnSwap(sourceToken_, sourceAmount_, targetToken_, targetAmount_, receiver_, outputAmount);
  }

  /// @notice Make real swap to know result amount
  ///         but exclude any additional operations
  ///         like "sending the result amount to a receiver" or "emitting any events".
  /// @dev This function should be called only inside static call to know result amount.
  /// @param sourceAmountApprover_ A contract which has approved source amount to TetuConverter
  ///                              and called a function findSwapStrategy
  /// @param sourceAmount_ Amount in terms of {sourceToken_} to be converter to {targetToken_}
  /// @return amountOut Result amount in terms of {targetToken_} after conversion
  function simulateSwap(
    address sourceAmountApprover_,
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_
  ) external override returns (uint) {
    require(msg.sender == controller.swapManager(), AppErrors.ONLY_SWAP_MANAGER);
    console.log("SwapManager.simulateSwap", address(this), msg.sender);

    IClaimAmountCallback(controller.tetuConverter()).onRequireAmount(
      sourceAmountApprover_,
      sourceToken_,
      sourceAmount_
    );

    uint targetTokenBalanceBefore = IERC20(targetToken_).balanceOf(address(this));

    ITetuLiquidator tetuLiquidator = ITetuLiquidator(controller.tetuLiquidator());
    IERC20(sourceToken_).safeApprove(address(tetuLiquidator), sourceAmount_);
    tetuLiquidator.liquidate(sourceToken_, targetToken_, sourceAmount_, PRICE_IMPACT_TOLERANCE);

    return IERC20(targetToken_).balanceOf(address(this)) - targetTokenBalanceBefore;
  }

  //////////////////////////////////////////////////////////////////////////////
  ///           Simulate real swap
  ///           using gnosis simulate() and simulateAndRevert() functions
  ///           They are slightly more efficient than try/catch approach
  ///           see SimulateTesterTest.ts
  /////////////////////////////////////////////////////////////////////////////

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
  function simulate(
    address targetContract,
    bytes calldata calldataPayload
  ) external override returns (bytes memory response) {
    // Suppress compiler warnings about not using parameters, while allowing
    // parameters to keep names for documentation purposes. This does not
    // generate code.
    targetContract;
    calldataPayload;
    console.log("SwapManager.simulate");

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
