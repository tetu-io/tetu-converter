// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../interfaces/ILendingDataTypes.sol";

/// @notice Contain list of lending pools. Allow to select most efficient pool and delegate borrow-request there
contract LpManager is ILendingDataTypes {

  /// @dev SourceToken => TargetToken => [all suitable pools]
  mapping(address => mapping (address => PoolData[])) public allPools;

  /// @notice Check if triple (source token, target token, pool) is already registered in {allPools}
  mapping(address => mapping (address => mapping (address => bool))) public sourceTargetPoolRegistered;

  //TODO: mapping cToken => Decorator


  /// @notice Add new pool for each possible pair of supported tokens
  /// @param supportedTokens Must contain at least two tokens: source, target.
  /// @param lpDecorator Must implement ILendingPlatform
  function addPool(
    address pool,
    address lpDecorator,
    address[] calldata supportedTokens
  ) external {
    //TODO: _onlyOperator();

    uint lenSupportedTokens = supportedTokens.length;
    for (uint i = 0; i < lenSupportedTokens; i = _uncheckedInc(i)) {
      for (uint j = i + 1; j < lenSupportedTokens; j = _uncheckedInc(j)) {
        require(
          !sourceTargetPoolRegistered[supportedTokens[i]][supportedTokens[j]][pool]
          && !sourceTargetPoolRegistered[supportedTokens[j]][supportedTokens[i]][pool]
          , "Already registered"
        );
        bool inputFirst = supportedTokens[i] > supportedTokens[j];
        address tokenIn = inputFirst ? supportedTokens[i] : supportedTokens[j];
        address tokenOut = inputFirst ? supportedTokens[j] : supportedTokens[i];

        PoolData memory pd;
        pd.pool = pool;
        pd.lpDecorator = lpDecorator;
        pd.tokenOut = tokenOut;
        pd.tokenIn = tokenIn;

        allPools[tokenIn][tokenOut].push(pd);

        sourceTargetPoolRegistered[tokenIn][tokenOut][pool] = true;
        //TODO: emit PoolAdded(pool);
      }
    }
  }

  function _uncheckedInc(uint i) internal pure returns (uint) {
    unchecked {
      return i + 1;
    }
  }

}