// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

interface IConverterControllerProvider {
  function controller() external view returns (address);
}
