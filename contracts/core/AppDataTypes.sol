// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

library AppDataTypes {

  enum ConversionKind {
    UNKNOWN_0,
    SWAP_1,
    BORROW_2
  }

  /// @notice Input params for BorrowManager.findPool (stack is too deep problem)
  struct InputConversionParams {
    /// @notice if 0 than default health factor specified for the target asset will be used, decimals 2
    uint16 healthFactor2;

    address sourceToken;
    address targetToken;

    uint periodInBlocks;
    /// @notice Amount of {sourceToken} to be converted to {targetToken}
    uint sourceAmount;
  }

  /// @notice Explain how a given pool can make specified conversion
  struct ConversionPlan {
    /// @notice Template adapter contract that implements required strategy.
    address converter;
    /// @notice Current collateral factor [0..1e18], where 1e18 is corresponded to CF=1
    /// TODO: probably we need to use different decimals for the collateral factor to reduce size of this struct
    uint liquidationThreshold18;

    /// @notice Amount to borrow in terms of borrow tokens
    ///         = borrowAmountFactor18 * (priceCollateral18/priceBorrow18) * liquidationThreshold18 / 1e18
    uint amountToBorrow;

    /// @notice APR for the period calculated using borrow rate in terms of borrow tokens, decimals 36
    /// @dev It doesn't take into account supply increment and rewards
    uint borrowApr36;
    /// @notice Potential supply increment after borrow period in terms of Borrow Tokens (BT), decimals 36
    uint supplyAprBt36;
    /// @notice Potential rewards amount after borrow period in terms of Borrow Tokens (BT), decimals 36
    uint rewardsAmountBt36;

    /// @notice Loan-to-value, decimals = 18 (wad)
    /// TODO: uint16? see aave..
    uint ltv18;
    /// @notice How much borrow asset we can borrow in the pool (in borrow tokens)
    uint maxAmountToBorrow;
    /// @notice How much collateral asset can be supplied (in collateral tokens).
    ///         type(uint).max - unlimited, 0 - no supply is possible
    uint maxAmountToSupply;
  }

  /// @notice A struct to combine all params of getConversionPlan implementation to single struct
  /// @dev Workaround for - stack is too deep problem... - problem
  struct ParamsGetConversionPlan {
    address collateralAsset;
    uint collateralAmount;
    address borrowAsset;
    uint borrowAmountFactor18;
    uint countBlocks;
  }
}
