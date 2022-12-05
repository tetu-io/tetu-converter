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
import "../integrations/aave3/IAavePriceOracle.sol";

/// @title Contract to find the best swap and make the swap
/// @notice Combines Manager and Converter
/// @author bogdoslav
contract SwapManager is ISwapManager, ISwapConverter {
  using SafeERC20 for IERC20;

  IController public immutable controller;

  ///////////////////////////////////////////////////////
  ///               Constants
  ///////////////////////////////////////////////////////

  uint public constant SLIPPAGE_NUMERATOR = 100_000;
  uint public constant SLIPPAGE_TOLERANCE = SLIPPAGE_NUMERATOR * 1 / 100; // 1 %

  uint public constant PRICE_IMPACT_NUMERATOR = 100_000;
  uint public constant PRICE_IMPACT_TOLERANCE = PRICE_IMPACT_NUMERATOR * 2 / 100; // 2%
  uint public constant AVERAGE_PRICE_IMPACT_TO_CALCULATE_APR = PRICE_IMPACT_NUMERATOR * 1 / 100; // 1%

  address public constant AAVE3_PRICE_ORACLE = 0xb023e699F5a33916Ea823A16485e259257cA8Bd1;

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
  /// @return converter Address of ISwapConverter
  ///         If SwapManager cannot find a conversion way,
  ///         it returns converter == 0 (in the same way as ITetuConverter)
  function getConverter(AppDataTypes.InputConversionParams memory p_)
  external view override returns (
    address converter,
    uint maxTargetAmount,
    int apr18
  ) {
    ITetuLiquidator liquidator = ITetuLiquidator(controller.tetuLiquidator());
//    (ITetuLiquidator.PoolData[] memory route,) = liquidator.buildRoute(p_.sourceToken, p_.targetToken);
    maxTargetAmount = liquidator.getPrice(p_.sourceToken, p_.targetToken, p_.sourceAmount)
      * (PRICE_IMPACT_NUMERATOR - AVERAGE_PRICE_IMPACT_TO_CALCULATE_APR) / PRICE_IMPACT_NUMERATOR;

    if (maxTargetAmount != 0) {
      // how much we will get when sell target token back
      uint returnAmount = liquidator.getPrice(p_.targetToken, p_.sourceToken, maxTargetAmount)
        * (PRICE_IMPACT_NUMERATOR - AVERAGE_PRICE_IMPACT_TO_CALCULATE_APR) / PRICE_IMPACT_NUMERATOR;

      if (returnAmount != 0) {
        // getPrice returns 0 if conversion way is not found
        // in this case, we should return converter = 0 in same way as ITetuConverter does
        converter = address(this);

        int loss = int(p_.sourceAmount) - int(returnAmount);
        apr18 = loss * APR_NUMERATOR / int(p_.sourceAmount);
      }
    }

    return (converter, maxTargetAmount, apr18);
  }

  /// todo remove
  function getConverter2(AppDataTypes.InputConversionParams memory p_)
  external view returns (
    address converter,
    uint maxTargetAmount,
    int apr18
  ) {
    ITetuLiquidator liquidator = ITetuLiquidator(controller.tetuLiquidator());
    maxTargetAmount = liquidator.getPrice(p_.sourceToken, p_.targetToken, p_.sourceAmount)
      * (PRICE_IMPACT_NUMERATOR - AVERAGE_PRICE_IMPACT_TO_CALCULATE_APR) / PRICE_IMPACT_NUMERATOR;

    if (maxTargetAmount != 0) {
//      IAavePriceOracle priceOracle = IAavePriceOracle(AAVE3_PRICE_ORACLE);
//      address[] memory assets = new address[](2);
//      assets[0] = p_.sourceToken;
//      assets[1] = p_.targetToken;
//      uint[] memory prices = priceOracle.getAssetsPrices(assets);

      uint maxTargetAmountInSourceTokens = maxTargetAmount
        * 10**18 // IERC20Metadata(p_.sourceToken).decimals()
        * 1e18 // priceOracle.getAssetPrice(p_.targetToken)
        / 1e18 // priceOracle.getAssetPrice(p_.sourceToken)
        / 10**18; // IERC20Metadata(p_.targetToken).decimals();

      converter = address(this);

      int loss = 2 * (int(p_.sourceAmount) - int(maxTargetAmountInSourceTokens));
      apr18 = loss * APR_NUMERATOR / int(p_.sourceAmount);
    }

    return (converter, maxTargetAmount, apr18);
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

    uint slippage = targetAmount_ == 0 || outputAmount >= targetAmount_
      ? 0
      : (targetAmount_ - outputAmount) * SLIPPAGE_NUMERATOR / targetAmount_;
    require(slippage <= SLIPPAGE_TOLERANCE, AppErrors.SLIPPAGE_TOO_BIG);

    IERC20(targetToken_).safeTransfer(receiver_, outputAmount);
    emit OnSwap(sourceToken_, sourceAmount_, targetToken_, targetAmount_, receiver_, outputAmount);
  }

}
