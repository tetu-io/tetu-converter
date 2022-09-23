// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

interface IMockERC20 {
    function mint(address to, uint256 value) external;
    function burn(address from, uint256 value) external;
}
