// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;


/// @notice Restored from 0x72a053fa208eaafa53adb1a1ea6b4b2175b5735e (events were removed)
interface IAaveTwoStableDebtToken {
  function DEBT_TOKEN_REVISION() external view returns (uint256);
  function POOL() external view returns (address);
  function UNDERLYING_ASSET_ADDRESS() external view returns (address);

  function allowance(address owner, address spender) external view returns (uint256);
  function approve(address spender, uint256 amount) external returns (bool);
  function approveDelegation(address delegatee, uint256 amount) external;
  function balanceOf(address account) external view returns (uint256);
  function borrowAllowance(address fromUser, address toUser) external view returns (uint256);
  function burn(address user, uint256 amount) external;
  function decimals() external view returns (uint8);
  function decreaseAllowance(address spender, uint256 subtractedValue) external returns (bool);
  function getAverageStableRate() external view returns (uint256);
  function getIncentivesController() external view returns (address);

  function getSupplyData() external view returns (uint256, uint256, uint256, uint40);
  function getTotalSupplyAndAvgRate() external view returns (uint256, uint256);
  function getTotalSupplyLastUpdated() external view returns (uint40);
  function getUserLastUpdated(address user) external view returns (uint40);
  function getUserStableRate(address user) external view returns (uint256);
  function increaseAllowance(address spender, uint256 addedValue) external returns (bool);

  function initialize(
    address pool,
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
  ) external returns (bool);

  function name() external view returns (string memory);
  function principalBalanceOf(address user) external view returns (uint256);
  function symbol() external view returns (string memory);
  function totalSupply() external view returns (uint256);
  function transfer(address recipient, uint256 amount) external returns (bool);

  function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}
