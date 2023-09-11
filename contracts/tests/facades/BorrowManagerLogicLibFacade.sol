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
  ) internal view returns (
    address[] memory convertersOut,
    uint[] memory collateralAmountsOut,
    uint[] memory amountsToBorrowOut,
    int[] memory aprs18Out
  ) {
    return BorrowManagerLogicLib.findConverter(p_, addParams_, _pas);
  }

  function _prepareFindConverterResults(
    uint countDebts_,
    uint count_,
    BorrowManagerLogicLib.BorrowCandidate[] memory data_
  ) internal pure returns (
    address[] memory convertersOut,
    uint[] memory collateralAmountsOut,
    uint[] memory amountsToBorrowOut,
    int[] memory aprs18Out
  ) {
    return BorrowManagerLogicLib._prepareFindConverterResults(countDebts_, count_, data_);
  }

  function _findExistDebtsToRebalance(
    IPlatformAdapter[] memory platformAdapters,
    AppDataTypes.InputConversionParams memory p_,
    BorrowManagerLogicLib.InputParamsAdditional memory addParams_,
    BorrowManagerLogicLib.BorrowCandidate[] memory input
  ) internal view returns (FindExistDebtsToRebalanceLocal memory) {
    (uint count, bool needMore) = BorrowManagerLogicLib._findExistDebtsToRebalance(platformAdapters, p_, addParams_, input);
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
  ) internal view returns (
    uint indexPlatformAdapter,
    address poolAdapter
  ) {
    return BorrowManagerLogicLib._getExistValidPoolAdapter(platformAdapters_, index0_, user_, collateralAsset_, borrowAsset_, controller_);
  }

  function _findPoolsForExistDebt(
    IPoolAdapter poolAdapter_,
    IPlatformAdapter platformAdapter_,
    AppDataTypes.InputConversionParams memory p_,
    BorrowManagerLogicLib.InputParamsAdditional memory addParams_,
    uint usedAmountIn0
  ) internal view returns (
    BorrowManagerLogicLib.BorrowCandidate memory dest,
    uint usedAmountInFinal
  ) {
    return BorrowManagerLogicLib._findPoolsForExistDebt(poolAdapter_, platformAdapter_, p_, addParams_, usedAmountIn0);
  }

  function _getPlanWithRebalancing(
    IPlatformAdapter platformAdapter_,
    AppDataTypes.InputConversionParams memory p_,
    uint16 targetHealthFactor2_,
    int requiredCollateralAssetAmount,
    int requiredBorrowAssetAmount
  ) internal view returns (
    AppDataTypes.ConversionPlan memory plan
  ) {
    return BorrowManagerLogicLib._getPlanWithRebalancing(platformAdapter_, p_, targetHealthFactor2_, requiredCollateralAssetAmount, requiredBorrowAssetAmount);
  }

  function _findPoolsForNewDebt(
    IPlatformAdapter[] memory platformAdapters_,
    uint startDestIndex_,
    AppDataTypes.InputConversionParams memory p_,
    BorrowManagerLogicLib.InputParamsAdditional memory addParams_,
    BorrowManagerLogicLib.BorrowCandidate[] memory dest_
  ) internal view returns (
    uint totalCount
  ) {
    return BorrowManagerLogicLib._findPoolsForNewDebt(platformAdapters_, startDestIndex_, p_, addParams_, dest_);
  }
}