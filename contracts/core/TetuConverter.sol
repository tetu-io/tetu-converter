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
import "../core/DataTypes.sol";

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

  function findBestConversionStrategy(
    address sourceToken,
    uint sourceAmount,
    address targetToken,
    uint96 healthFactorOptional,
    uint approxOwnershipPeriodInBlocks
  ) external view override returns (
    address outPool,
    address outAdapter,
    uint outMaxTargetAmount,
    uint outInterest
  ) {
    DataTypes.ExecuteFindPoolParams memory findPoolParams;
    {
      findPoolParams = DataTypes.ExecuteFindPoolParams({
        healthFactorOptional: healthFactorOptional,
        sourceToken: sourceToken,
        targetToken: targetToken,
        sourceAmount: sourceAmount
      });
    }

    {
      (address pool, address adapter, uint br, uint mta) = borrowManager.findPool(findPoolParams);
      if (pool == address(0)) {
        return (address(0), address(0), 0, 0);
      } else {
        //TODO: estimate cost of the money - commissions for all operations:
        //TODO: a lawn has borrow and repay, swap has direct and backward swap.
        uint interest = (br * approxOwnershipPeriodInBlocks);
        return (pool, adapter, mta, interest);
      }
    }
  }


  function supplyAndBorrow (
    address adapter_,
    address pool_,
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint targetAmount_
  ) external {
    ILendingPlatform(adapter_).openPosition(pool_, sourceToken_, sourceAmount_, targetToken_, targetAmount_, msg.sender);
  }
}

