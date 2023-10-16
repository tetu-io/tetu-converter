// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../interfaces/IPoolAdapter.sol";
import "hardhat/console.sol";

/// @notice Pool adapter functions can be called by TetuConverter only
///         This contract allows to get status of the pool adapter
///         and call repay() in the same block.
///         As result, we can make full repay.
contract TetuConverterReplacer {
  uint public amountToPay;
  uint public repayResultAmount;
  function repay(
    IPoolAdapter poolAdapter,
    uint repayPart,
    bool closePosition,
    address receiver
  ) external {
    console.log("TetuConverterReplacer.poolAdapter", address(poolAdapter));
    console.log("TetuConverterReplacer.repayPart", repayPart);
    (, amountToPay,,,,) = poolAdapter.getStatus();
    console.log("TetuConverterReplacer.amountToPay.1", amountToPay);

    poolAdapter.updateStatus();
    (, amountToPay,,,,) = poolAdapter.getStatus();
    console.log("TetuConverterReplacer.amountToPay.2", amountToPay);

    amountToPay = amountToPay * repayPart / 100_000;
    console.log("TetuConverterReplacer.amountToPay.3", amountToPay);
    repayResultAmount = poolAdapter.repay(amountToPay, receiver, closePosition);
  }

}