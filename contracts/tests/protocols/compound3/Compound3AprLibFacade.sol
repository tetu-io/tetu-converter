// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../../protocols/compound3/Compound3AprLib.sol";

contract Compound3AprLibFacade {
  function getRewardsAmountInBorrowAsset36(IComet comet, address cometRewards, IConverterController controller, uint borrowAmount, uint blocks, uint blocksPerDay, uint borrowAssetDecimals) external view returns(uint) {
    return Compound3AprLib.getRewardsAmountInBorrowAsset36(comet, cometRewards, controller, borrowAmount, blocks, blocksPerDay, borrowAssetDecimals);
  }

  function getBorrowCost36(IComet comet, uint borrowAmount, uint blocks, uint blocksPerDay, uint borrowAssetDecimals) external view returns(uint) {
    return Compound3AprLib.getBorrowCost36(comet, borrowAmount, blocks, blocksPerDay, borrowAssetDecimals);
  }

  function getBorrowRateAfterBorrow(address cometAddress, uint amountToBorrow_) external view returns (uint) {
    return Compound3AprLib.getBorrowRateAfterBorrow(cometAddress, amountToBorrow_);
  }

  function getBorrowRate(address comet, uint utilization) external view returns (uint) {
    return Compound3AprLib.getBorrowRate(IComet(comet), utilization);
  }

  function getPrice(address oracle) external view returns (uint) {
    return Compound3AprLib.getPrice(oracle);
  }
}