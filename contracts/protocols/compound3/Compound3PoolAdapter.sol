// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../openzeppelin/Initializable.sol";
import "../../libs/AppErrors.sol";
import "../../interfaces/IConverterController.sol";
import "../../interfaces/IPoolAdapter.sol";
import "../../interfaces/IPoolAdapterInitializer.sol";
import "../../integrations/compound3/IComet.sol";

contract Compound3PoolAdapter is IPoolAdapter, IPoolAdapterInitializer, Initializable {
  using SafeERC20 for IERC20;

  ///////////////////////////////////////////////////////
  ///                Constants
  ///////////////////////////////////////////////////////

  ///////////////////////////////////////////////////////
  ///                Variables
  ///////////////////////////////////////////////////////

  address public collateralAsset;
  address public borrowAsset;
  address public user;
  IComet public comet;
  IConverterController public controller;
  address public originConverter;
  uint public collateralTokensBalance;

  ///////////////////////////////////////////////////////
  ///                Events
  ///////////////////////////////////////////////////////

  event OnInitialized(address controller, address pool, address user, address collateralAsset, address borrowAsset, address originConverter);

  ///////////////////////////////////////////////////////
  ///                Initialization
  ///////////////////////////////////////////////////////

  function initialize(
    address controller_,
    address comet_,
    address user_,
    address collateralAsset_,
    address borrowAsset_,
    address originConverter_
  ) external initializer {
    require(
      controller_ != address(0)
      && comet_ != address(0)
      && user_ != address(0)
      && collateralAsset_ != address(0)
      && borrowAsset_ != address(0)
      && originConverter_ != address(0),
      AppErrors.ZERO_ADDRESS
    );

    controller = IConverterController(controller_);
    user = user_;
    collateralAsset = collateralAsset_;
    borrowAsset = borrowAsset_;
    originConverter = originConverter_;

    comet = IComet(comet_);

    // The pool adapter doesn't keep assets on its balance, so it's safe to use infinity approve
    // All approves replaced by infinity-approve were commented in the code below
    IERC20(collateralAsset_).safeApprove(comet_, 2**255); // 2*255 is more gas-efficient than type(uint).max
    IERC20(borrowAsset_).safeApprove(comet_, 2**255);

    emit OnInitialized(controller_, comet_, user_, collateralAsset_, borrowAsset_, originConverter_);
  }

  ///////////////////////////////////////////////////////
  ///                Modifiers
  ///////////////////////////////////////////////////////

  ///////////////////////////////////////////////////////
  ///                Gov actions
  ///////////////////////////////////////////////////////

  ///////////////////////////////////////////////////////
  ///                Views
  ///////////////////////////////////////////////////////

  function getConfig() external view returns (
    address originConverter_,
    address user_,
    address collateralAsset_,
    address borrowAsset_
  ) {
    return (originConverter, user, collateralAsset, borrowAsset);
  }

  function getStatus() external view returns (
    uint collateralAmount,
    uint amountToPay,
    uint healthFactor18,
    bool opened,
    uint collateralAmountLiquidated
  ) {}

  function getCollateralAmountToReturn(uint amountToRepay_, bool closePosition_) external view returns (uint) {}

  function getConversionKind() external pure returns (
    AppDataTypes.ConversionKind
  ) {}

  ///////////////////////////////////////////////////////
  ///                External logic
  ///////////////////////////////////////////////////////

  function updateStatus() external {}

  function borrow(uint collateralAmount_, uint borrowAmount_, address receiver_) external returns (
    uint borrowedAmountOut
  ) {}

  function borrowToRebalance(uint borrowAmount_, address receiver_) external returns (
    uint resultHealthFactor18,
    uint borrowedAmountOut
  ) {}

  function repay(uint amountToRepay_, address receiver_, bool closePosition_) external returns (
    uint collateralAmountOut
  ) {}

  function repayToRebalance(uint amount_, bool isCollateral_) external returns (
    uint resultHealthFactor18
  ) {}

  function claimRewards(address receiver_) external returns (address rewardToken, uint amount) {}

  ///////////////////////////////////////////////////////
  ///                Internal logic
  ///////////////////////////////////////////////////////

}