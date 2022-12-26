// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

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
import "../interfaces/ISimulateProvider.sol";
import "../interfaces/ISwapSimulator.sol";
import "../interfaces/IRequireAmountBySwapManagerCallback.sol";
import "./TetuConverter.sol";
import "hardhat/console.sol";

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
  uint public constant PRICE_IMPACT_TOLERANCE_DEFAULT = PRICE_IMPACT_NUMERATOR * 2 / 100; // 2%

  int public constant APR_NUMERATOR = 10**18;

  /// @notice Optional price impact tolerance for assets. If not set, PRICE_IMPACT_TOLERANCE_DEFAULT is used.
  ///         asset => price impact tolerance (decimals are set by PRICE_IMPACT_NUMERATOR)
  mapping (address => uint) public priceImpactTolerances;

  ///////////////////////////////////////////////////////
  ///               Events
  ///////////////////////////////////////////////////////
  event OnSwap(address sourceToken,
    uint sourceAmount,
    address targetToken,
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

  /// @notice Set custom price impact tolerance for the asset
  /// @param priceImpactTolerance Set 0 to use default price impact tolerance for the {asset}.
  ///                             Decimals = PRICE_IMPACT_NUMERATOR
  function setPriceImpactTolerance(address asset_, uint priceImpactTolerance) external {
    require(msg.sender == controller.governance(), AppErrors.GOVERNANCE_ONLY);
    require(priceImpactTolerance <= PRICE_IMPACT_NUMERATOR, AppErrors.INCORRECT_VALUE);

    priceImpactTolerances[asset_] = priceImpactTolerance;
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
  ///                      This amount must be approved by {sourceAmountApprover_} to TetuConverter before the call
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
    uint maxTargetAmount
  ) {
    // there are no restrictions for the msg.sender

    // Simulate real swap of source amount to max target amount
    // We call SwapManager.simulateSwap() here as an external call
    // and than revert all changes back
    // We need additional try because !PRICE error can happen if a price impact is too high
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
    } catch {
      // we can have i.e. !PRICE error (the price impact is too high)
      // it means, there is no way to make the conversion with acceptable price impact
      return (address(0), 0);
    }

    return maxTargetAmount == 0
      ? (address(0), 0)
      : (address(this), maxTargetAmount);
  }

  ///////////////////////////////////////////////////////
  ///           ISwapConverter Implementation
  ///////////////////////////////////////////////////////

  function getConversionKind() override external pure returns (AppDataTypes.ConversionKind) {
    return AppDataTypes.ConversionKind.SWAP_1;
  }

  /// @notice Swap {sourceAmount_} of {sourceToken_} to {targetToken_} and send result amount to {receiver_}
  ///         The swapping is made using TetuLiquidator.
  /// @return outputAmount The amount that has been sent to the receiver
  function swap(
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    address receiver_
  ) override external returns (uint outputAmount) {
    // there are no restrictions for the msg.sender
    uint targetTokenBalanceBefore = IERC20(targetToken_).balanceOf(address(this));

    ITetuLiquidator tetuLiquidator = ITetuLiquidator(controller.tetuLiquidator());
    IERC20(sourceToken_).safeApprove(address(tetuLiquidator), sourceAmount_);

    // If price impact is too big, getConverter will return high APR
    // So TetuConverter will select borrow, not swap.
    // If the swap was selected anyway, it is wrong case.
    // liquidate() will revert here and it's ok.

    tetuLiquidator.liquidate(sourceToken_, targetToken_, sourceAmount_, _getPriceImpactTolerance(sourceToken_));
    outputAmount = IERC20(targetToken_).balanceOf(address(this)) - targetTokenBalanceBefore;

    IERC20(targetToken_).safeTransfer(receiver_, outputAmount);
    emit OnSwap(sourceToken_, sourceAmount_, targetToken_, receiver_, outputAmount);
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

    IRequireAmountBySwapManagerCallback(controller.tetuConverter()).onRequireAmountBySwapManager(
      sourceAmountApprover_,
      sourceToken_,
      sourceAmount_
    );

    uint targetTokenBalanceBefore = IERC20(targetToken_).balanceOf(address(this));

    ITetuLiquidator tetuLiquidator = ITetuLiquidator(controller.tetuLiquidator());
    IERC20(sourceToken_).safeApprove(address(tetuLiquidator), sourceAmount_);
    tetuLiquidator.liquidate(sourceToken_, targetToken_, sourceAmount_, _getPriceImpactTolerance(sourceToken_));
    return IERC20(targetToken_).balanceOf(address(this)) - targetTokenBalanceBefore;
  }

  /// @notice Calculate APR using known {sourceToken_} and known {targetAmount_}
  ///         as 2 * loss / sourceAmount
  ///         loss - conversion loss, we use 2 multiplier to take into account losses for there and back conversions.
  /// @param sourceAmount_ Source amount before conversion, in terms of {sourceToken_}
  /// @param targetAmount_ Result of conversion. The amount is in terms of {targetToken_}
  function getApr18(
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint targetAmount_
  ) external view override returns (int) {
    uint targetAmountInSourceTokens = _convertUsingPriceOracle(targetToken_, targetAmount_, sourceToken_);

    // calculate result APR
    // we need to multiple one-way-loss on to to get loss for there-and-back conversion
    return 2 * (int(sourceAmount_) - int(targetAmountInSourceTokens)) * APR_NUMERATOR / int(sourceAmount_);
  }

  /// @notice Return custom or default price impact tolerance for the asset
  function getPriceImpactTolerance(address asset_) external view override returns (uint priceImpactTolerance) {
    return _getPriceImpactTolerance(asset_);
  }

  /// @notice Converter amount of {assetIn_} to the corresponded amount of {assetOut_} using price oracle prices.
  ///         Ensure, that the difference of result amountOut and expected {amountOut_} doesn't exceed
  ///         price impact tolerance percent.
  function checkConversionUsingPriceOracle(
    address assetIn_,
    uint amountIn_,
    address assetOut_,
    uint amountOut_
  ) external view override returns (uint) {
    uint amountOut = _convertUsingPriceOracle(assetIn_, amountIn_, assetOut_);
    require(
      (amountOut_ > amountOut
        ? amountOut_ - amountOut
        : amountOut - amountOut_
      ) < amountOut * _getPriceImpactTolerance(assetOut_) / PRICE_IMPACT_NUMERATOR,
      AppErrors.TOO_HIGH_PRICE_IMPACT
    );
    return amountOut;
  }

  //////////////////////////////////////////////////////////////////////////////
  ///           View functions
  //////////////////////////////////////////////////////////////////////////////
  /// @notice Return custom or default price impact tolerance for the asset
  function _getPriceImpactTolerance(address asset_) internal view returns (uint priceImpactTolerance) {
    priceImpactTolerance = priceImpactTolerances[asset_];
    if (priceImpactTolerance == 0) {
      priceImpactTolerance = PRICE_IMPACT_TOLERANCE_DEFAULT;
    }
  }

  /// @notice Converter amount of {assetIn_} to the corresponded amount of {assetOut_} using price oracle prices
  function _convertUsingPriceOracle(
    address assetIn_,
    uint amountIn_,
    address assetOut_
  ) internal view returns (uint) {
    IPriceOracle priceOracle = IPriceOracle(controller.priceOracle());
    uint priceOut = priceOracle.getAssetPrice(assetOut_);
    uint priceIn = priceOracle.getAssetPrice(assetIn_);
    require(priceOut != 0 && priceIn != 0, AppErrors.ZERO_PRICE);

    return amountIn_
      * 10**IERC20Metadata(assetOut_).decimals()
      * priceIn
      / priceOut
      / 10**IERC20Metadata(assetIn_).decimals();
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
    // there are no restrictions for the msg.sender

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
    // there are no restrictions for the msg.sender

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
