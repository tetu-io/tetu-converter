// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

library DataTypes {
  enum BorrowMode {
    /// @notice Same as {BORROW_MODE_AUTO_HEALTH_FACTOR_1}
    BORROW_MODE_DEFAULT_0,

    /// @notice use all source amounts as collateral, borrow specified target amounts;
    ///         health factor must be as big as possible (but it should be greater or equal to H0).
    BORROW_MODE_AUTO_HEALTH_FACTOR_1,

    /// @notice borrow specified target amounts, use default value of health factor H0,
    ///         use minimum required collateral to get H0.
    BORROW_MODE_AUTO_COLLATERAL_AMOUNT_2,

    /// @notice use all source amounts as collateral, use default value of health factor H0,
    /// get as much as possible of target amounts
    BORROW_MODE_AUTO_TARGET_AMOUNT_3
  }

  struct LendingPlatform {
    uint lendingPlatformUid;
    string title;

    /// @dev address of corresponded LpXXX contract, that implements ILendingPlatform
    address decorator;

    /// @notice It's not-allowed to use this market to make new loans
    bool isBorrowingDisabled;

    address[] pools;
  }

}