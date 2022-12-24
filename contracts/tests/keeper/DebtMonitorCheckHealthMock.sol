// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "hardhat/console.sol";

/// @notice Allow to mock IDebtMonitor.checkHealth
contract DebtMonitorCheckHealthMock {
  struct ReturnValues {
    uint nextIndexToCheck0;
    address[] outPoolAdapters;
    uint[] outAmountBorrowAsset;
    uint[] outAmountCollateralAsset;
  }
  struct ExpectedInputParams {
    bool enabled;
    uint startIndex0;
    uint maxCountToCheck;
    uint maxCountToReturn;
  }

  ReturnValues public returnValues;

  /// @notice Optional required values of input params of checkHealth()
  ///         If it's assigned, checkHealth() returns expected returnValues only
  ///         if the input params set is equal to expected one
  ExpectedInputParams public expectedInputParams;

  function setReturnValues(
    uint nextIndexToCheck0,
    address[] memory outPoolAdapters,
    uint[] memory outAmountBorrowAsset,
    uint[] memory outAmountCollateralAsset
  ) external {
    returnValues = ReturnValues ({
      nextIndexToCheck0: nextIndexToCheck0,
      outPoolAdapters: outPoolAdapters,
      outAmountBorrowAsset: outAmountBorrowAsset,
      outAmountCollateralAsset: outAmountCollateralAsset
    });
  }

  function setExpectedInputParams(
    uint startIndex0,
    uint maxCountToCheck,
    uint maxCountToReturn
  ) external {
    expectedInputParams = ExpectedInputParams ({
      enabled: true,
      startIndex0: startIndex0,
      maxCountToCheck: maxCountToCheck,
      maxCountToReturn: maxCountToReturn
    });
  }

  function checkHealth(
    uint startIndex0,
    uint maxCountToCheck,
    uint maxCountToReturn
  ) external view returns (
    uint nextIndexToCheck0,
    address[] memory outPoolAdapters,
    uint[] memory outAmountBorrowAsset,
    uint[] memory outAmountCollateralAsset
  ) {
    console.log("DebtMonitorCheckHealthMock.checkHealth");
    require(
      !expectedInputParams.enabled
      || (
        expectedInputParams.startIndex0 == startIndex0
        && expectedInputParams.maxCountToCheck == maxCountToCheck
        && expectedInputParams.maxCountToReturn == maxCountToReturn
      ),
      "Incorrect set of input params of checkHealth"
    );

    return (
      returnValues.nextIndexToCheck0,
      returnValues.outPoolAdapters,
      returnValues.outAmountBorrowAsset,
      returnValues.outAmountCollateralAsset
    );
  }
}
