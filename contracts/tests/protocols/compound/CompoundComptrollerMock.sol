// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../../integrations/compound/ICompoundComptrollerBase.sol";
import "../../utils/TestUtilsLib.sol";

/// @notice Min common set of functions of Compound cTokens
/// required to implement platform and pool adapters
abstract contract CompoundComptrollerMock is ICompoundComptrollerBase {
  address internal _oracle;
  mapping(bytes32 => uint[]) internal _enterMarketsResults;
  mapping(address => uint[3]) internal _getAccountLiquidity;
  mapping(address => uint) internal _borrowCaps;
  mapping(address => bool) internal _borrowGuardianPaused;
  mapping(address => bool) internal _mintGuardianPaused;
  mapping(address => bool) internal _marketEntered;

  //region ------------------------------------ Setup
  function setOracle(address oracle_) external {
    _oracle = oracle_;
  }

  function setEnterMarkets(address[] memory cTokens, uint[] memory successIndicators) external {
    bytes32 key = TestUtilsLib.keccak256addresses(cTokens);
    _enterMarketsResults[key] = successIndicators;
  }

  function setGetAccountLiquidity(address account, uint256 error, uint256 liquidity, uint256 shortfall) external {
    _getAccountLiquidity[account] = [error, liquidity, shortfall];
  }

  function setBorrowCaps(address cToken, uint borrowCapValue) external {
    _borrowCaps[cToken] = borrowCapValue;
  }

  function setBorrowGuardianPaused(address cToken, bool paused) external {
    _borrowGuardianPaused[cToken] = paused;
  }

  function setMintGuardianPaused(address cToken, bool paused) external {
    _mintGuardianPaused[cToken] = paused;
  }
  function isMarketEntered(address cToken) external view returns (bool) {
    return _marketEntered[cToken];
  }

  //endregion ------------------------------------ Setup

  //region ------------------------------------ ICompoundComptrollerBase
  function oracle() external view returns (address) {
    return _oracle;
  }

  function enterMarkets(address[] memory cTokens) external returns (uint256[] memory) {
    bytes32 key = TestUtilsLib.keccak256addresses(cTokens);
    _enterMarketsResults[key] = _enterMarketsResults[key];
    for (uint i = 0; i < cTokens.length; ++i) {
      _marketEntered[cTokens[i]] = true;
    }
    return _enterMarketsResults[key];
  }

  function getAccountLiquidity(address account) external view returns (
    uint256 error,
    uint256 liquidity,
    uint256 shortfall
  ) {
    uint[3] memory data = _getAccountLiquidity[account];
    return (data[0], data[1], data[2]);
  }

  function borrowCaps(address cToken) external view returns (uint256) {
    return _borrowCaps[cToken];
  }
  function borrowGuardianPaused(address cToken) external view returns (bool) {
    return _borrowGuardianPaused[cToken];
  }
  function mintGuardianPaused(address cToken) external view returns (bool) {
    return _mintGuardianPaused[cToken];
  }
  //endregion ------------------------------------ ICompoundComptrollerBase
}