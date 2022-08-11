// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

/// @notice User of TetuConvert should support this interface, so keeper will be able to make reconversion
interface IBorrower {
    function requireReconversion(
      address poolAdapter
    ) external;
}