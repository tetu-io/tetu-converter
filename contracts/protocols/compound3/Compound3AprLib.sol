// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../openzeppelin/IERC20Metadata.sol";
import "../../integrations/compound3/IComet.sol";
import "../../integrations/compound3/ICometRewards.sol";
import "../../integrations/compound3/IPriceFeed.sol";
import "../../interfaces/IConverterController.sol";
import "../../integrations/tetu/ITetuLiquidator.sol";
import "hardhat/console.sol";

library Compound3AprLib {
  struct GetRewardsParamsLocal {
    IComet comet;
    ICometRewards cometRewards;
    IConverterController controller;
    uint borrowAmount;
    uint blocks;
    uint blocksPerDay;
    uint borrowAssetDecimals;
  }

  function getRewardsAmountInBorrowAsset36(IComet comet, address cometRewards, IConverterController controller, uint borrowAmount, uint blocks, uint blocksPerDay, uint borrowAssetDecimals) internal view returns (uint) {
    return _getRewardsAmountInBorrowAsset36(GetRewardsParamsLocal(comet, ICometRewards(cometRewards), controller, borrowAmount, blocks, blocksPerDay, borrowAssetDecimals));
  }

  function _getRewardsAmountInBorrowAsset36(GetRewardsParamsLocal memory p) internal view returns (uint) {
    IComet _comet = p.comet;
    ICometRewards.RewardConfig memory config = p.cometRewards.rewardConfig(address(_comet));
    uint timeElapsed = p.blocks * 86400 / p.blocksPerDay;

    // https://github.com/compound-developers/compound-3-developer-faq/blob/master/contracts/MyContract.sol#L181
    uint rewardToBorrowersForPeriod = _comet.baseTrackingBorrowSpeed() * timeElapsed * (_comet.baseIndexScale() / _comet.baseScale());
    uint rewardTokenDecimals = 10**IERC20Metadata(config.token).decimals();
    uint price = ITetuLiquidator(p.controller.tetuLiquidator()).getPrice(config.token, _comet.baseToken(), rewardTokenDecimals);
    return price * rewardToBorrowersForPeriod / _comet.totalBorrow() * p.borrowAmount * 1e36 / rewardTokenDecimals / (p.borrowAssetDecimals ** 2);
  }

  function getBorrowCost36(IComet comet, uint borrowAmount, uint blocks, uint blocksPerDay, uint borrowAssetDecimals) internal view returns (uint) {
    uint utilization = comet.getUtilization();
    uint64 rate = comet.getBorrowRate(utilization);
    uint timeElapsed = blocks * 86400 / blocksPerDay;
    return uint(rate) * timeElapsed * borrowAmount * 1e18 / borrowAssetDecimals;
  }

  function getPrice(address oracle) internal view returns (uint) {
    (,int answer,,,) = IPriceFeed(oracle).latestRoundData();
    return uint(answer);
  }
}