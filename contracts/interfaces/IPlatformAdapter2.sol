// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

/// @notice A lending platform (AAVE, HF, etc). Allow to work with comptroller and any pool of the platform.
interface IPlatformAdapter2 {

  /// @notice Kind of borrow rate
  ///         I.e. AAVE calculates borrow-rate per second
  ///              Compound calculates borrow-rate per block
  enum BorrowRateKind {
    UNKNOWN_0,
    PER_BLOCK_1,
    PER_SECOND_2
  }

  /// @notice Get pool data required to select best lending pool
  /// @param pool_ = comptroller
  /// @return borrowRateKind Kind of {borrowRatePerBlockWAD}. 0 if the borrow is not possible
  /// @return borrowRate Normalized borrow rate (borrow-rate + any fees), decimals = 18 (wad)
  /// @return ltvWAD Loan-to-value, decimals = 18 (wad)
  /// @return collateralFactorWAD Current collateral factor [0..1e18], where 1e18 is corresponded to CF=1
  /// @return maxAmountToBorrowBT How much borrow asset we can borrow in the pool (in borrow tokens)
  /// @return maxAmountToSupplyCT How much collateral asset can be supplied (in collateral tokens). 0 - unlimited
  function getPoolInfo (
    address pool_,
    address collateralAsset_,
    address borrowAsset_
  ) external view returns (
    BorrowRateKind borrowRateKind,
    uint borrowRate,
    uint ltvWAD,
    uint collateralFactorWAD,
    uint maxAmountToBorrowBT,
    uint maxAmountToSupplyCT
  );
}
