// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

/// @notice User of TetuConvert should support this interface, so keeper/TetuConverter will be able to require actions
interface IBorrower {
    function requireReconversion(
      address poolAdapter
    ) external;

    function requireRepay(
      address poolAdapter
    ) external;
}