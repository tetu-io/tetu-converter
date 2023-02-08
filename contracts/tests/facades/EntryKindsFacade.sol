// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../core/EntryKinds.sol";

/// @notice Provide direct acess to internal functions of the library EntryKinds
contract EntryKindsFacade {
  function getEntryKind(bytes memory entryData_) external pure returns (uint) {
    return EntryKinds.getEntryKind(entryData_);
  }

  function exactCollateralInForMaxBorrowOut(
    uint collateralAmount,
    uint healthFactor18,
    uint liquidationThreshold18,
    AppDataTypes.PricesAndDecimals memory pd,
    bool priceDecimals36
  ) external pure returns (
    uint amountToBorrowOut
  ) {
    return EntryKinds.exactCollateralInForMaxBorrowOut(
      collateralAmount,
      healthFactor18,
      liquidationThreshold18,
      pd,
      priceDecimals36
    );
  }

  function exactProportion(
    uint collateralAmount,
    uint healthFactor18,
    uint liquidationThreshold18,
    AppDataTypes.PricesAndDecimals memory pd,
    bytes memory entryData,
    bool priceDecimals36
  ) external pure returns (
    uint collateralAmountOut,
    uint amountToBorrowOut
  ) {
    return EntryKinds.exactProportion(
      collateralAmount,
      healthFactor18,
      liquidationThreshold18,
      pd,
      entryData,
      priceDecimals36
    );
  }

  function getCollateralAmountToConvert(
    bytes memory entryData,
    uint collateralAmount,
    uint healthFactor18,
    uint liquidationThreshold18
  ) external pure returns (
    uint collateralAmountOut
  ) {
    return EntryKinds.getCollateralAmountToConvert(
      entryData,
      collateralAmount,
      healthFactor18,
      liquidationThreshold18
    );
  }
}