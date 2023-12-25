// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Set of functions that should be implemented by the caller of ICompoundPoolAdapterLib
/// @dev This interface should be implemented if the protocol's token doesn't support ICTokenBase, i.e.
///      the token uses not-standard declaration of all or some key functions - borrow(), repayBorrow and so on.
interface ICompoundPoolAdapterLibCaller {
  /// @notice Call cToken.borrow() to borrow {amount} of {borrowAsset}
  /// Assume, that required collateral amount is already supplied.
  /// @dev It's not necessary to check if the amount was actually received (the check is made in CompoundPoolAdapterLib)
  function _borrow(address borrowAsset, address borrowCToken, uint amount) external;

  /// @notice Call cToken.repayBorrow() to repay {amountToRepay}
  function _repayBorrow(address borrowAsset, address borrowCToken, uint amountToRepay) external;

  /// @notice Call cToken.repayBorrow() to repay {amountToRepay}. Ensure that the operation was successfully made.
  /// @return Received amount of collateral
  function _redeem(address collateralAsset, address collateralCToken, uint amountToWithdraw) external returns (uint);

  /// @notice Call cToken.mint() to supply {amount} to the lending platform.
  /// @dev Ensure that the operation was successfully made.
  function _mint(address collateralCToken, uint amount) external;

  function _markets(address collateralCToken) external view returns (uint collateralFactor);
}