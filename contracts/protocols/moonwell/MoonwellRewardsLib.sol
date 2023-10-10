// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../integrations/moonwell/IMToken.sol";
import "../../integrations/moonwell/IMoonwellMultiRewardDistributor.sol";

/// @notice Routines to calculate supply and borrow reward amounts in advance
///         Based on the code from MultiRewardDistributor.sol, see https://github.com/moonwell-fi/moonwell-contracts-v2
library MoonwellRewardsLib {

  /// @notice The initialIndexConstant, used to initialize indexes, and taken from the Comptroller
  uint224 public constant initialIndexConstant = 1e36;
  uint constant expScale = 1e18;
  uint constant doubleScale = 1e36;

  //region ----------------------------------------------------------- Data types
  struct IndexUpdate {
    uint224 newIndex;
    uint32 newTimestamp;
  }

  struct Exp {
    uint mantissa;
  }

  struct Double {
    uint mantissa;
  }

  struct MTokenData {
    uint mTokenBalance;
    uint borrowBalanceStored;
  }

  // Some structs we can't move to the interface
  struct CurrentMarketData {
    uint256 totalMTokens;
    uint256 totalBorrows;
    Exp marketBorrowIndex;
  }

  struct CalculatedData {
    CurrentMarketData marketData;
    MTokenData mTokenInfo;
  }
  //endregion ----------------------------------------------------------- Data types

  //region ----------------------------------------------------------- Public function
  function getOutstandingRewardsForUser(
    IMToken mToken_,
    uint32 borrowPeriodTimestamp_,
    uint amountToSupply_,
    uint amountToBorrow_,
    IMoonwellMultiRewardDistributor rewardDistributor
  ) internal view returns (MultiRewardDistributorCommon.RewardInfo[] memory outputRewardData) {
    // Global config for this mToken
    MultiRewardDistributorCommon.MarketConfig[] memory configs = rewardDistributor.getAllMarketConfigs(address(mToken_));
    outputRewardData = new MultiRewardDistributorCommon.RewardInfo[](configs.length);

    // Code golf to avoid too many local vars :rolling-eyes:
    CalculatedData memory calcData = CalculatedData({
        marketData: CurrentMarketData({
        totalMTokens: mToken_.totalSupply(),
        totalBorrows: mToken_.totalBorrows(),
        marketBorrowIndex: Exp({mantissa: mToken_.borrowIndex()})
      }),
      mTokenInfo: MTokenData({
      // we assume that new user is going to make new borrow
        mTokenBalance: amountToSupply_,
        borrowBalanceStored: amountToBorrow_
      })
    });

    for (uint256 index = 0; index < configs.length; index++) {
      MultiRewardDistributorCommon.MarketConfig memory config = configs[index];

      // Calculate our new global supply index
      IndexUpdate memory supplyUpdate = calculateNewIndex(
        config.supplyEmissionsPerSec,
        config.supplyGlobalTimestamp + borrowPeriodTimestamp_,
        config.supplyGlobalIndex,
        config.endTime,
        calcData.marketData.totalMTokens
      );

      // Calculate our new global borrow index
      IndexUpdate memory borrowUpdate = calculateNewIndex(
        config.borrowEmissionsPerSec,
        config.borrowGlobalTimestamp + borrowPeriodTimestamp_,
        config.borrowGlobalIndex,
        config.endTime,
        div_(
          calcData.marketData.totalBorrows,
          calcData.marketData.marketBorrowIndex
        )
      );

      uint userSupplyIndex = config.supplyGlobalIndex; // _emissionConfig.supplierIndices[_user]
      uint userBorrowIndex = config.borrowGlobalTimestamp; // _emissionConfig.supplierIndices[_user]

      // Calculate outstanding supplier side rewards
      uint256 supplierRewardsAccrued = calculateSupplyRewardsForUser(
        supplyUpdate.newIndex,
        0, // calcData.mTokenInfo.mTokenBalance,
        userSupplyIndex
      );

      uint256 borrowerRewardsAccrued = calculateBorrowRewardsForUser(
        borrowUpdate.newIndex,
        calcData.marketData.marketBorrowIndex,
        calcData.mTokenInfo,
        userBorrowIndex
      );

      outputRewardData[index] = MultiRewardDistributorCommon.RewardInfo({
        emissionToken: config.emissionToken,
        totalAmount: borrowerRewardsAccrued + supplierRewardsAccrued,
        supplySide: supplierRewardsAccrued,
        borrowSide: borrowerRewardsAccrued
      });
    }

    return outputRewardData;
  }
  //endregion ----------------------------------------------------------- Public function

  //region ----------------------------------------------------------- Internal logic
  /// @notice An internal view to calculate the total owed supplier rewards for a given supplier address
  /// @param _globalSupplyIndex The global supply index for a market
  /// @param _supplierTokens The amount of this market's mTokens owned by a user
  /// @param userSupplyIndex _emissionConfig.supplierIndices[_supplier], _supplier is the address of the supplier
  function calculateSupplyRewardsForUser(
    uint224 _globalSupplyIndex,
    uint256 _supplierTokens,
    uint256 userSupplyIndex
  ) internal pure returns (uint256) {
    // If our user's index isn't set yet, set to the current global supply index
    if (userSupplyIndex == 0 && _globalSupplyIndex >= initialIndexConstant) {
      userSupplyIndex = initialIndexConstant; //_globalSupplyIndex;
    }

    // Calculate change in the cumulative sum of the reward per cToken accrued
    Double memory deltaIndex = Double({
      mantissa: sub_(_globalSupplyIndex, userSupplyIndex)
    });

    // Calculate reward accrued: cTokenAmount * accruedPerCToken
    return mul_(_supplierTokens, deltaIndex);
  }

  /// @notice An internal view to calculate the total owed borrower rewards for a given borrower address
  /// @param _globalBorrowIndex The global borrow index for a market
  /// @param _marketBorrowIndex The mToken's borrowIndex
  /// @param _mTokenData A struct holding a borrower's
  /// @param userBorrowIndex _emissionConfig.borrowerIndices[_borrower],
  ///        where _borrower is the address of the supplier mToken balance and borrowed balance
  function calculateBorrowRewardsForUser(
    uint224 _globalBorrowIndex,
    Exp memory _marketBorrowIndex,
    MTokenData memory _mTokenData,
    uint256 userBorrowIndex
  ) internal pure returns (uint256) {
    // If our user's index isn't set yet, set to the current global borrow index
    if (userBorrowIndex == 0 && _globalBorrowIndex >= initialIndexConstant) {
      userBorrowIndex = initialIndexConstant; //userBorrowIndex = _globalBorrowIndex;
    }

    // Calculate change in the cumulative sum of the reward per cToken accrued
    Double memory deltaIndex = Double({
      mantissa: sub_(_globalBorrowIndex, userBorrowIndex)
    });

    uint borrowerAmount = div_(
      _mTokenData.borrowBalanceStored,
      _marketBorrowIndex
    );

    // Calculate reward accrued: mTokenAmount * accruedPerMToken
    return mul_(borrowerAmount, deltaIndex);
  }

  /// @notice An internal view to calculate the global reward indices while taking into account emissions end times.
  /// @dev Denominator here is whatever fractional denominator is used to calculate the index. On the supply side
  ///      it's simply mToken.totalSupply(), while on the borrow side it's (mToken.totalBorrows() / mToken.borrowIndex())
  /// @param _emissionsPerSecond The configured emissions per second for this index
  /// @param _currentTimestamp The current index timestamp
  /// @param _currentIndex The current index
  /// @param _rewardEndTime The end time for this reward config
  /// @param _denominator The denominator used in the calculation (supply side == mToken.totalSupply,
  ///        borrow side is (mToken.totalBorrows() / mToken.borrowIndex()).
  function calculateNewIndex(
    uint256 _emissionsPerSecond,
    uint32 _currentTimestamp,
    uint224 _currentIndex,
    uint256 _rewardEndTime,
    uint256 _denominator
  ) internal view returns (IndexUpdate memory) {
    uint32 blockTimestamp = safe32(
      block.timestamp,
      "block timestamp exceeds 32 bits"
    );
    uint256 deltaTimestamps = sub_(
      blockTimestamp,
      uint256(_currentTimestamp)
    );

    // If our current block timestamp is newer than our emission end time, we need to halt
    // reward emissions by stinting the growth of the global index, but importantly not
    // the global timestamp. Should not be gte because the equivalent case makes a
    // 0 deltaTimestamp which doesn't accrue the last bit of rewards properly.
    if (blockTimestamp > _rewardEndTime) {
      // If our current index timestamp is less than our end time it means this
      // is the first time the endTime threshold has been breached, and we have
      // some left over rewards to accrue, so clamp deltaTimestamps to the whatever
      // window of rewards still remains.
      if (_currentTimestamp < _rewardEndTime) {
        deltaTimestamps = sub_(_rewardEndTime, _currentTimestamp);
      } else {
        // Otherwise just set deltaTimestamps to 0 to ensure that we short circuit in the next step
        deltaTimestamps = 0;
      }
    }

    // Short circuit to update the timestamp but *not* the index if there's nothing to calculate
    if (deltaTimestamps == 0 || _emissionsPerSecond == 0) {
      return
        IndexUpdate({
        newIndex: _currentIndex,
        newTimestamp: blockTimestamp
      });
    }

    // At this point we know we have to calculate a new index, so do so
    uint256 tokenAccrued = mul_(deltaTimestamps, _emissionsPerSecond);
    Double memory ratio = _denominator > 0
      ? fraction(tokenAccrued, _denominator)
      : Double({mantissa: 0});

    uint224 newIndex = safe224(
      add_(Double({mantissa: _currentIndex}), ratio).mantissa,
      "new index exceeds 224 bits"
    );

    return IndexUpdate({newIndex: newIndex, newTimestamp: blockTimestamp});
  }
  //endregion ----------------------------------------------------------- Internal logic

  //region ----------------------------------------------------------- Math utils
  function div_(uint a, Exp memory b) pure internal returns (uint) {
    return div_(mul_(a, expScale), b.mantissa);
  }

  function div_(uint a, uint b) pure internal returns (uint) {
    return div_(a, b, "divide by zero");
  }

  function div_(uint a, uint b, string memory errorMessage) pure internal returns (uint) {
    require(b > 0, errorMessage);
    return a / b;
  }

  function sub_(uint a, uint b) pure internal returns (uint) {
    return sub_(a, b, "subtraction underflow");
  }

  function sub_(uint a, uint b, string memory errorMessage) pure internal returns (uint) {
    require(b <= a, errorMessage);
    return a - b;
  }

  function mul_(uint a, Double memory b) pure internal returns (uint) {
    return mul_(a, b.mantissa) / doubleScale;
  }

  function mul_(uint a, uint b) pure internal returns (uint) {
    return mul_(a, b, "multiplication overflow");
  }

  function mul_(uint a, uint b, string memory errorMessage) pure internal returns (uint) {
    if (a == 0 || b == 0) {
      return 0;
    }
    uint c = a * b;
    require(c / a == b, errorMessage);
    return c;
  }

  function safe32(uint n, string memory errorMessage) pure internal returns (uint32) {
    require(n < 2**32, errorMessage);
    return uint32(n);
  }

  function fraction(uint a, uint b) pure internal returns (Double memory) {
    return Double({mantissa: div_(mul_(a, doubleScale), b)});
  }

  function safe224(uint n, string memory errorMessage) pure internal returns (uint224) {
    require(n < 2**224, errorMessage);
    return uint224(n);
  }

  function add_(Double memory a, Double memory b) pure internal returns (Double memory) {
    return Double({mantissa: add_(a.mantissa, b.mantissa)});
  }

  function add_(uint a, uint b) pure internal returns (uint) {
    return add_(a, b, "addition overflow");
  }

  function add_(uint a, uint b, string memory errorMessage) pure internal returns (uint) {
    uint c = a + b;
    require(c >= a, errorMessage);
    return c;
  }
  //endregion ----------------------------------------------------------- Math utils
}
