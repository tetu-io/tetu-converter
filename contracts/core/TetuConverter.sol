// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../interfaces/ITetuConverter.sol";
import "../integrations/market/ICErc20.sol";
import "../integrations/IERC20Extended.sol";
import "../interfaces/IBorrowManager.sol";
import "hardhat/console.sol";
import "../openzeppelin/SafeERC20.sol";
import "../openzeppelin/IERC20.sol";
import "../interfaces/IPlatformAdapter.sol";
import "../core/DataTypes.sol";
import "../interfaces/IPoolAdapter.sol";
import "../interfaces/IController.sol";

/// @notice Main application contract
contract TetuConverter is ITetuConverter {
  using SafeERC20 for IERC20;

  ///////////////////////////////////////////////////////
  ///                Members
  ///////////////////////////////////////////////////////

  IController public immutable controller;

  /// @notice Save asset-balance at the end of every borrow function and read them at the beginning
  ///         The differences between stored balance and actual balanc is amount of tokens provided as collateral
  /// @dev See explanation to swap, https://docs.uniswap.org/protocol/V2/concepts/core-concepts/swaps
  mapping (address => uint) reserves;

  /// @notice user contract => collateral => adapter
  /// @dev adapter = an instance of [Protocol]PoolAdapter created using minimal proxy pattern
  mapping (address => mapping(address => mapping(address => IPoolAdapter))) poolAdapters;

  ///////////////////////////////////////////////////////
  ///                Initialization
  ///////////////////////////////////////////////////////

  constructor(address controller_) {
    require(controller_ != address(0), "zero controller");

    controller = IController(controller_);
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
      (address pool, uint br, uint mta) = _bm().findPool(findPoolParams);
      if (pool == address(0)) {
        return (address(0), 0, 0);
      } else {
        //TODO: estimate cost of the money - commissions for all operations:
        //TODO: a lawn has borrow and repay, swap has direct and backward swap.
        console.log("br=%d period=%d", br, approxOwnershipPeriodInBlocks);
        uint interest = (br * approxOwnershipPeriodInBlocks);
        return (pool, mta, interest);
      }
    }
  }

  ///////////////////////////////////////////////////////
  ///       Make conversion
  ///////////////////////////////////////////////////////

  function convert(
    address pool_,
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint targetAmount_,
    address receiver_
  ) external override {
    console.log("TC.convert");
    //ensure that source amount was transferred to balance
    require(reserves[sourceToken_] + sourceAmount_ == IERC20(sourceToken_).balanceOf(address(this)), "wrong balance");

    (address platformAdapter, bool lending) = _bm().getPlatformAdapter(pool_);
    if (lending) {
      // make borrow
      console.log("Lending!");

      // get exist or register new pool adapter
      address poolAdapter;
      for (uint i = 0; i < 2; ++i) {
        poolAdapter = _bm().getPoolAdapter(
          pool_,
          msg.sender,
          sourceToken_
        );
        if (i == 0 && poolAdapter == address(0)) {
          _bm().registerPoolAdapter(
            pool_,
            msg.sender,
            sourceToken_
          );
        } else {
          break;
        }
      }
      require(poolAdapter != address(0), "pa not found");
      console.log("Pool adapter", poolAdapter);

      IPoolAdapter pa = IPoolAdapter(poolAdapter);

      // re-transfer the collateral to the pool adapter
      IERC20(sourceToken_).transfer(poolAdapter, sourceAmount_);
      console.log("Transfer to pool adapter token=%s amount=%d", sourceToken_, sourceAmount_);

      // borrow target-amount and transfer borrowed amount to the receiver
      pa.borrow(sourceAmount_, targetToken_, targetAmount_, receiver_);
    } else {
      // make swap
      //TODO
      console.log("SWAP!");
    }

    // update reserves
    reserves[sourceToken_] = IERC20(sourceToken_).balanceOf(address(this));
  }

  ///////////////////////////////////////////////////////
  ///       Find opened borrow-positions
  ///////////////////////////////////////////////////////

  function findBorrows (
    address collateralToken_,
    address borrowedToken_
  ) external view override returns (
    uint outCountItems,
    address[] memory outPoolAdapters,
    uint[] memory outAmountsToPay
  ) {


    return (outCountItems, outPoolAdapters, outAmountsToPay);
  }

  ///////////////////////////////////////////////////////
  ///       Inline functions
  ///////////////////////////////////////////////////////
  function _bm() internal view returns (IBorrowManager) {
    return IBorrowManager(controller.borrowManager());
  }
}

