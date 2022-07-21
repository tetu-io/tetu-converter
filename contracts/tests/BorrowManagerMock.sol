// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../openzeppelin/Clones.sol";
import "../interfaces/IController.sol";
import "../interfaces/IBorrowManager.sol";
import "../interfaces/IPoolAdapter.sol";

/// @notice Mock to emulate getInfo
///         Allow to confirm that given pool adapter is valid
contract BorrowManagerMock {
  struct Info {
    address pool;
    address user;
    address collateralUnderline;
  }

  mapping (address => Info) public data;

  constructor (
    address[] memory poolAdapters_,
    address[] memory pools_,
    address[] memory users_,
    address[] memory collateralUnderlines_
  ) {
    for (uint i = 0; i < poolAdapters_.length; ++i) {
      data[poolAdapters_[i]].pool = pools_[i];
      data[poolAdapters_[i]].user = users_[i];
      data[poolAdapters_[i]].collateralUnderline = collateralUnderlines_[i];
    }
  }

  function getInfo(address pa_) external view returns (address pool, address user, address collateralUnderline) {
    return (data[pa_].pool, data[pa_].user, data[pa_].collateralUnderline);
  }

}

