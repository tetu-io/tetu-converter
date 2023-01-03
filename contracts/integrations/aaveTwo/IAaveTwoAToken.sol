// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Restored from 0x3CB4cA3c9DC0e02D252098eEbb3871AC7a43c54d (events and _XXX were removed)
interface IAaveTwoAToken {
  function ATOKEN_REVISION() external view returns (uint256);
  function DOMAIN_SEPARATOR() external view returns (bytes32);
  function EIP712_REVISION() external view returns (bytes memory);
  function PERMIT_TYPEHASH() external view returns (bytes32);
  function POOL() external view returns (address);
  function RESERVE_TREASURY_ADDRESS() external view returns (address);
  function UNDERLYING_ASSET_ADDRESS() external view returns (address);
  function allowance(address owner, address spender) external view returns (uint256);
  function approve(address spender, uint256 amount) external returns (bool);
  function balanceOf(address user) external view returns (uint256);

  function burn(
    address user,
    address receiverOfUnderlying,
    uint256 amount,
    uint256 index
  ) external;

  function decimals() external view returns (uint8);

  function decreaseAllowance(address spender, uint256 subtractedValue) external returns (bool);
  function getIncentivesController() external view returns (address);
  /**
   * @dev Returns the scaled balance of the user and the scaled total supply.
   * @param user The address of the user
   * @return The scaled balance of the user
   * @return The scaled balance and the scaled total supply
   **/
  function getScaledUserBalanceAndSupply(address user) external view returns (uint256, uint256);
  function handleRepayment(address user, uint256 amount) external;

  function increaseAllowance(address spender, uint256 addedValue) external returns (bool);

  function initialize(
    address pool,
    address treasury,
    address underlyingAsset,
    address incentivesController,
    uint8 aTokenDecimals,
    string memory aTokenName,
    string memory aTokenSymbol,
    bytes memory params
  ) external;

  function mint(
    address user,
    uint256 amount,
    uint256 index
  ) external returns (bool);

  function mintToTreasury(uint256 amount, uint256 index) external;

  function name() external view returns (string memory);

  function permit(
    address owner,
    address spender,
    uint256 value,
    uint256 deadline,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) external;

  function scaledBalanceOf(address user) external view returns (uint256);
  function scaledTotalSupply() external view returns (uint256);
  function symbol() external view returns (string memory);
  function totalSupply() external view returns (uint256);
  function transfer(address recipient, uint256 amount) external returns (bool);

  function transferFrom(
    address sender,
    address recipient,
    uint256 amount
  ) external returns (bool);

  function transferOnLiquidation(
    address from,
    address to,
    uint256 value
  ) external;

  function transferUnderlyingTo(address target, uint256 amount)
  external
  returns (uint256);
}
