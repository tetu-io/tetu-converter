// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../interfaces/ITetuConverter.sol";
import "../integrations/market/ICErc20.sol";
import "../integrations/IERC20Extended.sol";
import "../interfaces/IBorrowManager.sol";
import "hardhat/console.sol";
import "../openzeppelin/SafeERC20.sol";
import "../openzeppelin/IERC20.sol";
import "../interfaces/ILendingPlatform.sol";

/// @notice Main application contract
contract TetuConverter is ITetuConverter {
  using SafeERC20 for IERC20;

  ///////////////////////////////////////////////////////
  ///                Members
  ///////////////////////////////////////////////////////

  uint constant public CONVERSION_WAY_NOT_FOUND = 0;
  uint constant public CONVERSION_SWAP = 1;
  uint constant public CONVERSION_LENDING = 2;

  IBorrowManager public immutable borrowManager;

  /// @notice Save asset-balance at the end of every borrow function and read them at the beginning
  ///         The differences between stored balance and actual balanc is amount of tokens provided as collateral
  /// @dev See explanation to swap, https://docs.uniswap.org/protocol/V2/concepts/core-concepts/swaps
  mapping (address => uint) reserves;

  ///////////////////////////////////////////////////////
  ///                Initialization
  ///////////////////////////////////////////////////////

  constructor(address borrowManager_) {
    require(borrowManager_ != address(0), "zero address");

    borrowManager = IBorrowManager(borrowManager_);
  }

  ///////////////////////////////////////////////////////
  ///       Find best strategy for conversion
  ///////////////////////////////////////////////////////

  /// @notice Find best conversion strategy (swap or lending) and provide "cost of money" as interest for the period
  /// @param sourceAmount Amount to be converted
  /// @param targetAmount Minimum required amount that should be received
  /// @param healthFactorOptional For lending: min allowed health factor; 0 - use default value
  /// @return outStrategyKind 0 - not found, 1 - Swap, 2 - lending
  /// @return outPool Result pool or 0 if a pool is not found
  /// @return outMaxTargetAmount Max available amount of target tokens that we can get after conversion
  /// @return outInterestPerPeriod Pool normalized borrow rate per ethereum block
  function findBestConversionStrategy(
    address sourceToken,
    uint sourceAmount,
    address targetToken,
    uint targetAmount,
    uint96 healthFactorOptional,
    uint approxOwnershipPeriodInBlocks
  ) external view override returns (
    uint outStrategyKind,
    address outPool,
    uint outMaxTargetAmount,
    uint outInterestPerPeriod
  ) {
    outStrategyKind = CONVERSION_LENDING;
    (address pool, uint br, uint mta) = borrowManager.findPool(
      sourceToken,
      sourceAmount,
      targetToken,
      targetAmount,
      healthFactorOptional
    );
    if (pool == address(0)) {
      return (CONVERSION_WAY_NOT_FOUND, address(0), 0, 0);
    } else {
      uint interest = br * 5; //stub, TODO
      return (CONVERSION_LENDING, pool, mta, interest);
    }
  }


  ///////////////////////////////////////////////////////
  ///           Borrow logic
  ///////////////////////////////////////////////////////

  /// @notice Borrow {targetAmount} from the pool using {sourceAmount} as collateral.
  /// @dev Result health factor cannot be less the default health factor specified for the target asset by governance.
  /// @param sourceToken_ Asset to be used as collateral
  /// @param sourceAmount_ Amount of collateral; it should already be transferred to the balance of the contract
  /// @param targetToken_ Asset to borrow
  /// @param targetAmount_ Required amount to borrow
  /// @param receiver_ Receiver of cTokens
  function borrow (
    address pool_,
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint targetAmount_,
    address receiver_
  ) external override {
    // User has transferred a collateral to balance of TetuConverter
    uint balanceBefore = 0; //TODO
    uint balanceSource = IERC20(sourceToken_).balanceOf(address(this));
    uint collateral = balanceSource - balanceBefore;

    // Supply the collateral, receive cTokens on balance of TetuConverter
    // Register cTokens using the push pattern
    address decorator = borrowManager.getLendingPlatform(pool_);
    require(collateral >= sourceAmount_, "TC: insufficient input amount");
    IERC20(decorator).safeTransfer(decorator, collateral);

    ILendingPlatform p = ILendingPlatform(decorator);
    p.supply(pool_, sourceToken_, collateral);

    // Borrow the target amount. Receive it on balance of TetuConverter
    // Register borrowed amount using the push-pattern


  }
}