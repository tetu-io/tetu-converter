// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../libs/AppDataTypes.sol";
import "../../openzeppelin/EnumerableSet.sol";
import "../../openzeppelin/EnumerableMap.sol";
import "../../interfaces/IPlatformAdapter.sol";
import "../../interfaces/IConverterController.sol";
import "../../libs/ConverterLogicLib.sol";
import "../../libs/AppUtils.sol";
import "../../libs/EntryKinds.sol";
import "../../libs/BorrowManagerLogicLib.sol";

/// @notice Wrapper to provide access to internal functions of BorrowManagerLogicLib
contract BorrowManagerLogicLibFacade {
  using EnumerableSet for EnumerableSet.AddressSet;

  struct FindExistDebtsToRebalanceLocal {
    BorrowManagerLogicLib.BorrowCandidate[] candidates;
    uint count;
    bool needMore;
  }

  EnumerableSet.AddressSet internal _pas;

  //region ----------------------------------------------------- Setup
  function addPlatformAdapter(address[] memory platformAdapters) external {
    for (uint i = 0; i < platformAdapters.length; ++i) {
      _pas.add(platformAdapters[i]);
    }
  }

  //endregion ----------------------------------------------------- Setup

  function _findConverter(
    AppDataTypes.InputConversionParams memory p_,
    BorrowManagerLogicLib.InputParamsAdditional memory addParams_
  ) external view returns (
    address[] memory convertersOut,
    uint[] memory collateralAmountsOut,
    uint[] memory amountsToBorrowOut,
    int[] memory aprs18Out
  ) {
    return BorrowManagerLogicLib.findConverter(p_, addParams_, _pas);
  }

  function _prepareOutput(
    uint countDebts_,
    uint count_,
    BorrowManagerLogicLib.BorrowCandidate[] memory data_
  ) external pure returns (
    address[] memory converters,
    uint[] memory collateralAmounts,
    uint[] memory borrowAmounts,
    int[] memory aprs18
  ) {
    return BorrowManagerLogicLib._prepareOutput(countDebts_, count_, data_);
  }

  function _findCandidatesForExistDebts(
    IPlatformAdapter[] memory platformAdapters,
    AppDataTypes.InputConversionParams memory p_,
    BorrowManagerLogicLib.InputParamsAdditional memory addParams_,
    BorrowManagerLogicLib.BorrowCandidate[] memory input
  ) external view returns (FindExistDebtsToRebalanceLocal memory) {
    (uint count, bool needMore) = BorrowManagerLogicLib._findCandidatesForExistDebts(platformAdapters, p_, addParams_, input);
    return FindExistDebtsToRebalanceLocal({
      count: count,
      needMore: needMore,
      candidates: input
    });
  }

  function _getExistValidPoolAdapter(
    IPlatformAdapter[] memory platformAdapters_,
    uint index0_,
    address user_,
    address collateralAsset_,
    address borrowAsset_,
    IConverterController controller_
  ) external view returns (
    uint indexPlatformAdapter,
    address poolAdapter,
    uint healthFactor18
  ) {
    return BorrowManagerLogicLib._getExistValidPoolAdapter(platformAdapters_, index0_, user_, collateralAsset_, borrowAsset_, controller_);
  }

  function _findConversionStrategyForExistDebt(
    IPoolAdapter poolAdapter_,
    IPlatformAdapter platformAdapter_,
    AppDataTypes.InputConversionParams memory p_,
    BorrowManagerLogicLib.InputParamsAdditional memory addParams_
  ) external view returns (
    BorrowManagerLogicLib.BorrowCandidate memory dest,
    bool partialBorrow
  ) {
    return BorrowManagerLogicLib._findConversionStrategyForExistDebt(poolAdapter_, platformAdapter_, p_, addParams_);
  }

  function _getPlanWithRebalancing(
    IPlatformAdapter platformAdapter_,
    AppDataTypes.InputConversionParams memory p_,
    uint16 targetHealthFactor2_,
    uint[2] memory thresholds,
    int requiredCollateralAssetAmount
  ) external view returns (
    AppDataTypes.ConversionPlan memory plan
  ) {
    return BorrowManagerLogicLib._getPlanWithRebalancing(
      platformAdapter_,
      p_,
      targetHealthFactor2_,
      thresholds,
      requiredCollateralAssetAmount
    );
  }

  function _findNewCandidates(
    IPlatformAdapter[] memory platformAdapters_,
    uint startDestIndex_,
    AppDataTypes.InputConversionParams memory p_,
    BorrowManagerLogicLib.InputParamsAdditional memory addParams_,
    BorrowManagerLogicLib.BorrowCandidate[] memory input
  ) external view returns (
    uint totalCount,
    BorrowManagerLogicLib.BorrowCandidate[] memory dest
  ) {
    totalCount = BorrowManagerLogicLib._findNewCandidates(platformAdapters_, startDestIndex_, p_, addParams_, input);
    return (totalCount, input);
  }
}