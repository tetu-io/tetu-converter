// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "./BorrowManagerStorage.sol";
import "./DataTypes.sol";
import "../interfaces/ILendingPlatform.sol";
import "../third_party/market/ICErc20.sol";

/// @notice Contains list of lending pools. Allow to select most efficient pool and delegate borrow-request there
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

  /// @notice Find lending pool with best normalized borrow rate per ethereum block
  /// @dev Normalized borrow rate can include borrow-rate-per-block + any additional fees
  function getBestLendingPool (
    address sourceToken,
    address targetToken
  ) public view returns (address outPool, uint outBorrowRate) {
    // The borrow interest rate per block, scaled by 1e18
    address[] memory pools = poolsForAssets
      [sourceToken < targetToken ? sourceToken : targetToken]
      [sourceToken < targetToken ? targetToken : sourceToken];
    uint lenPools = pools.length;
    if (lenPools != 0) {
      for (uint i = 0; i < lenPools; i = _uncheckedInc(i)) {
        uint rate = ICErc20(pools[i]).borrowRatePerBlock();
        if (outPool == address(0) || rate < outBorrowRate) {
          outPool = pools[i];
          outBorrowRate = rate;
        }
      }
    }

    return (outPool, outBorrowRate);
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