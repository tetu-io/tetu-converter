// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "./IConverterControllerProvider.sol";

interface IConverterControllable is IConverterControllerProvider {

  function isController(address _contract) external view returns (bool);

  function isControllerTetuV2(address _contract) external view returns (bool);

  function isGovernance(address _contract) external view returns (bool);

  function created() external view returns (uint256);

  function createdBlock() external view returns (uint256);

  function increaseRevision(address oldLogic) external;

}
