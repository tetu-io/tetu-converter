// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Set of functions that should be implemented by the caller of ICompoundPoolAdapterLib
/// @dev This interface should be implemented if the protocol's token doesn't support ICTokenBase, i.e.
///      the token uses not-standard declaration of all or some key functions - borrow(), repayBorrow and so on.
interface ICompoundPoolAdapterLibCaller {
  function _borrow(address borrowAsset, address borrowCToken, uint amount) external;
  function _repayBorrow(address borrowAsset, address borrowCToken, uint amountToRepay) external;

  /// @return collateralAmountToReturn
  function _redeem(address collateralAsset, address collateralCToken, uint amountToWithdraw) external returns (uint);

  function _mint(address collateralCToken, uint amount) external;

  function _markets(address collateralCToken) external view returns (uint collateralFactor);
}