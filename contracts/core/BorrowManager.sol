// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../interfaces/ILendingDataTypes.sol";
import "./BorrowManagerStorage.sol";
import "../interfaces/ILendingPlatform.sol";

/// @notice Contain list of lending pools. Allow to select most efficient pool and delegate borrow-request there
contract BorrowManager is BorrowManagerStorage {

  /*****************************************************/
  /*               Configurator                        */
  /*****************************************************/

  function addPlatform(string calldata title, address decorator) external {
    uint newPlatformUid = platformsCount + 1;
    platformsCount = newPlatformUid;

    platforms[newPlatformUid].decorator = decorator;
    platforms[newPlatformUid].title = title;
  }

  /// @param assets Assets supported by the pool. Any asset can be source, any asset can be target asset.
  function addPool(uint platformUid, address poolAddress, address[] calldata assets) external {
    uint lenAssets = assets.length;
    for (uint i = 0; i < lenAssets; i = _uncheckedInc(i)) {
      for (uint j = i + 1; j < lenAssets; j = _uncheckedInc(j)) {
        bool inputFirst = assets[i] > assets[j];
        address tokenIn = inputFirst ? assets[i] : assets[j];
        address tokenOut = inputFirst ? assets[j] : assets[i];

        require(platforms[platformUid].lendingPlatformUid == platformUid, "Unknown platform");
        require(!assignedPoolsForAssets[tokenIn][tokenOut][poolAddress] && poolToPlatform[poolAddress] == 0,
          "Already registered"
        );
        poolToPlatform[poolAddress] = platformUid;
        poolsForAssets[tokenIn][tokenOut].push(poolAddress);
        assignedPoolsForAssets[tokenIn][tokenOut][poolAddress] = true;
      }
    }
  }

//  function addAssetToPool() external;
//  function removeAssetFromPool() external;
//  function setActivePoolPairAssets() external;

  /*****************************************************/
  /*               Borrow logic                        */
  /*****************************************************/

  /// @notice Find best pool to make a loan
  /// @param sourceToken Asset to be used as collateral
  /// @param sourceAmount Max available amount of collateral
  /// @param targetToken Asset to borrow
  /// @param targetAmount Required amount to borrow
  /// @param minHealthFactor Minimal allowed health factor, decimals 18
  /// @param borrowDurationInBlocks Estimated duration of the borrowing in count of Ethereum blocks
  /// @return outPool A pool optimal for the borrowing. 0 if the borrowing is not possible
  /// @return outCollateralAmount Required amount of collateral <= sourceAmount
  /// @return outEstimatedAmountToRepay How much target tokens should be paid at the end of the borrowing
  /// @return outError A reason why the borrowing cannot be made; empty for success
  function getBestBorrowPool(
    address sourceToken,
    address sourceAmount,
    address targetToken,
    address targetAmount,
    uint256 minHealthFactor,
    uint256 borrowDurationInBlocks
  ) external view returns (
    address outPool,
    uint outCollateralAmount,
    uint outEstimatedAmountToRepay,
    string memory outError
  ) {
    // get estimated results for all pools
    (address[] memory pools,
     uint[] memory collateralAmount,
     uint[] memory estimatedAmountToRepays,
     string[] memory errors
    ) = _getPoolsToBorrow(
      sourceToken,
      sourceAmount,
      targetToken,
      targetAmount,
      minHealthFactor,
      borrowDurationInBlocks
    );

    // select a pool with minimum estimated amount to repay
    uint lenPools = pools.length;
    for (uint i = 0; i < lenPools; i = _uncheckedInc(i)) {
      if (pools[i] == address(0) || estimatedAmountToRepays[i] < outEstimatedAmountToRepay) {
        outPool = pools[i];
        outCollateralAmount = collateralAmount[i];
        outEstimatedAmountToRepay = estimatedAmountToRepays[i];
        outError = errors[i];
      }
    }

    return (outPool, outCollateralAmount, outEstimatedAmountToRepay, outError);
  }

  /// @notice Find best pool to make a loan
  /// @param sourceToken Asset to be used as collateral
  /// @param sourceAmount Max available amount of collateral
  /// @param targetToken Asset to borrow
  /// @param targetAmount Required amount to borrow
  /// @param minHealthFactor Minimal allowed health factor, decimals 18
  /// @param borrowDurationInBlocks Estimated duration of the borrowing in count of Ethereum blocks
  /// @return outPools A pool optimal for the borrowing. 0 if the borrowing is not possible
  /// @return outCollateralAmounts Required amount of collateral <= sourceAmount
  /// @return outEstimatedAmountToRepays How much target tokens should be paid at the end of the borrowing
  /// @return outErrors A reason why the borrowing cannot be made; empty for success
  function _getPoolsToBorrow (
    address sourceToken,
    address sourceAmount,
    address targetToken,
    address targetAmount,
    uint256 minHealthFactor,
    uint256 borrowDurationInBlocks
  ) internal view returns (
    address[] memory outPools,
    uint[] memory outCollateralAmounts,
    uint[] memory outEstimatedAmountToRepays,
    string[] memory outErrors
  ) {
    // enumerate all available pools for the pair of the assets
    // select a pool with minimum value of {estimatedAmountToRepay}
    address[] memory pools = poolsForAssets
      [sourceToken < targetToken ? sourceToken : targetToken]
      [sourceToken < targetToken ? targetToken : sourceToken];
    uint lenPools = pools.length;
    if (lenPools != 0) {
      outPools = new address[](lenPools);
      outCollateralAmounts = new uint[](lenPools);
      outEstimatedAmountToRepays = new uint[](lenPools);
      outErrors = new string[](lenPools);

      for (uint i = 0; i < lenPools; ++i) {
        address decorator = platforms[poolToPlatform[pools[i]]].decorator;
        (outCollateralAmounts[i],
         outEstimatedAmountToRepays[i],
         outErrors[i]
        ) = ILendingPlatform(decorator).buildBorrowPlan(
          sourceToken,
          sourceAmount,
          targetToken,
          targetAmount,
          minHealthFactor,
          borrowDurationInBlocks
        );
      }
    }

    return (outPools, outCollateralAmounts, outEstimatedAmountToRepays, outErrors);
  }

//  function borrow() external;
//  function borrowWithPool() external;
//
//  function getHealthFactor() external;
//  function getCollateralFactor() external;


  /*****************************************************/
  /*               Helper utils                        */
  /*****************************************************/

  function _uncheckedInc(uint i) internal pure returns (uint) {
    unchecked {
      return i + 1;
    }
  }

}