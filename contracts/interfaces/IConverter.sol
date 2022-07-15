// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

/// @notice Converter - universal adapter/decorator for lending/dex platform
/// @dev User make conversion through these converters
interface IConverter {

  /// @notice Convert {sourceAmount_} to {targetAmount} using borrowing or swapping
  /// @param sourceToken_ Input asset
  /// @param sourceAmount_ TODO requirements
  /// @param targetToken_ Target asset
  /// @param targetAmount_ TODO requirements
  /// @param receiver_ Receiver of cTokens
  function openPosition (
    address pool_,
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint targetAmount_,
    address receiver_
  ) external;

//  function closePosition (
//    address pool_,
//    address sourceToken_,
//    address targetToken_,
//    uint targetAmount_,
//    address receiver_
//  ) external;
}