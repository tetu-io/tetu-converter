// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

/// @notice Restored from 0x52A1CeB68Ee6b7B5D13E0376A1E0E4423A8cE26e (events were removed)
interface IAaveStableDebtToken {
  function DEBT_TOKEN_REVISION() external view returns (uint256);
  function DELEGATION_WITH_SIG_TYPEHASH() external view returns (bytes32);
  function DOMAIN_SEPARATOR() external view returns (bytes32);
  function EIP712_REVISION() external view returns (bytes memory);
  function POOL() external view returns (address);
  function UNDERLYING_ASSET_ADDRESS() external view returns (address);

  function allowance(address, address) external view returns (uint256);
  function approve(address, uint256) external returns (bool);
  function approveDelegation(address delegatee, uint256 amount) external;
  function balanceOf(address account) external view returns (uint256);
  function borrowAllowance(address fromUser, address toUser) external view returns (uint256);
  function burn(address from, uint256 amount) external returns (uint256, uint256);
  function decimals() external view returns (uint8);
  function decreaseAllowance(address, uint256) external returns (bool);

  function delegationWithSig(
    address delegator,
    address delegatee,
    uint256 value,
    uint256 deadline,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) external;

  function getAverageStableRate() external view returns (uint256);
  function getIncentivesController() external view returns (address);

  function getSupplyData()
  external
  view
  returns (
    uint256,
    uint256,
    uint256,
    uint40
  );

  function getTotalSupplyAndAvgRate() external view returns (uint256, uint256);
  function getTotalSupplyLastUpdated() external view returns (uint40);
  function getUserLastUpdated(address user) external view returns (uint40);
  function getUserStableRate(address user) external view returns (uint256);
  function increaseAllowance(address, uint256) external returns (bool);

  function initialize(
    address initializingPool,
    address underlyingAsset,
    address incentivesController,
    uint8 debtTokenDecimals,
    string memory debtTokenName,
    string memory debtTokenSymbol,
    bytes memory params
  ) external;

  function mint(
    address user,
    address onBehalfOf,
    uint256 amount,
    uint256 rate
  )
  external
  returns (
    bool,
    uint256,
    uint256
  );

  function name() external view returns (string memory);
  function nonces(address owner) external view returns (uint256);
  function principalBalanceOf(address user) external view returns (uint256);
  function setIncentivesController(address controller) external;
  function symbol() external view returns (string memory);
  function totalSupply() external view returns (uint256);
  function transfer(address, uint256) external returns (bool);

  function transferFrom(address, address, uint256) external returns (bool);
}
