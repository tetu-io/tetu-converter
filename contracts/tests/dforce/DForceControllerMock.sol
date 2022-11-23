//// SPDX-License-Identifier: MIT
//pragma solidity 0.8.4;
//
//import "../../integrations/dforce/IDForceController.sol";
//import "../../openzeppelin/IERC20.sol";
//import "../../openzeppelin/SafeERC20.sol";
//
///// @notice Implement some key-functions of the IDForceController
/////         used by DForcePoolAdapter
/////         Function calls are just delegated to original pool
/////         But the mock allows to change the logic of any function if it's necessary for tests
//contract DForceControllerMock is IDForceController {
//  using SafeERC20 for IERC20;
//
//  IDForceController public comptroller;
//  bool public ignoreSupply;
//  bool public ignoreRepay;
//  bool public ignoreWithdraw;
//  bool public ignoreBorrow;
//  bool public skipSendingATokens;
//  bool public grabAllBorrowAssetFromSenderOnRepay;
//
//  constructor (
//    address comptroller_,
//    address collateralCToken_,
//    address borrowCToken_
//  ) {
//    comptroller = IDForceController(comptroller_);
//    IERC20(collateralCToken_).safeApprove(comptroller_, type(uint).max);
//    IERC20(borrowCToken_).safeApprove(comptroller_, type(uint).max);
//    console.log("DForceControllerMock is used instead of real DForce controller", address(this), comptroller_);
//  }
//
//  /////////////////////////////////////////////////////////////////
//  ///       Config the mock
//  /////////////////////////////////////////////////////////////////
//  function setIgnoreSupply() external {
//    ignoreSupply = true;
//  }
//  function setIgnoreRepay() external {
//    ignoreRepay = true;
//  }
//  function setIgnoreWithdraw() external {
//    ignoreWithdraw = true;
//  }
//  function setIgnoreBorrow() external {
//    ignoreBorrow = true;
//  }
//  function setSkipSendingATokens() external {
//    skipSendingATokens = true;
//  }
//  function setGrabAllBorrowAssetFromSenderOnRepay() external {
//    grabAllBorrowAssetFromSenderOnRepay = true;
//  }
//
//  /////////////////////////////////////////////////////////////////
//  ///       IDForceController facade
//  ///       All functions required by DForcePoolAdapter
//  /////////////////////////////////////////////////////////////////
//
//  function afterBorrow(address _iToken, address _borrower, uint256 _borrowedAmount) external;
//  function afterFlashloan(address _iToken, address _to, uint256 _amount) external;
//
//  function afterLiquidateBorrow(address _iTokenBorrowed, address _iTokenCollateral, address _liquidator,
//    address _borrower, uint256 _repaidAmount, uint256 _seizedAmount) external;
//
//  function afterMint(address _iToken, address _minter, uint256 _mintAmount, uint256 _mintedAmount) external;
//  function afterRedeem(address _iToken, address _redeemer, uint256 _redeemAmount, uint256 _redeemedUnderlying) external;
//  function afterRepayBorrow(address _iToken, address _payer, address _borrower, uint256 _repayAmount) external;
//  function afterSeize(address _iTokenCollateral, address _iTokenBorrowed, address _liquidator,
//    address _borrower, uint256 _seizedAmount) external;
//  function afterTransfer(address _iToken, address _from, address _to, uint256 _amount) external;
//  function beforeBorrow(address _iToken, address _borrower, uint256 _borrowAmount) external;
//  function beforeFlashloan(address _iToken, address _to, uint256 _amount) external;
//  function beforeLiquidateBorrow(address _iTokenBorrowed, address _iTokenCollateral,
//    address _liquidator, address _borrower, uint256 _repayAmount) external;
//  function beforeMint(address _iToken, address _minter, uint256 _mintAmount) external;
//  function beforeRedeem(address _iToken, address _redeemer, uint256 _redeemAmount) external;
//  function beforeRepayBorrow(address _iToken, address _payer, address _borrower, uint256 _repayAmount) external;
//  function beforeSeize(address _iTokenCollateral, address _iTokenBorrowed, address _liquidator,
//    address _borrower, uint256 _seizeAmount) external;
//
//  function beforeTransfer(address _iToken, address _from, address _to, uint256 _amount) external;
//
//  function calcAccountEquity(address _account) external view returns (
//    uint256 accountEquity,
//    uint256 shortfall,
//    uint256 collateralValue,
//    uint256 borrowedValue
//  );
//
//  function closeFactorMantissa() external view returns (uint256);
//  function enterMarketFromiToken(address _market, address _account) external;
//  function enterMarkets(address[] memory _iTokens) external returns (bool[] memory _results);
//  function exitMarkets(address[] memory _iTokens) external returns (bool[] memory _results);
//  function getAlliTokens() external view returns (address[] memory _alliTokens);
//  function getBorrowedAssets(address _account) external view returns (address[] memory _borrowedAssets);
//  function getEnteredMarkets(address _account) external view returns (address[] memory _accountCollaterals);
//  function hasBorrowed(address _account, address _iToken) external view returns (bool);
//  function hasEnteredMarket(address _account, address _iToken) external view returns (bool);
//  function hasiToken(address _iToken) external view returns (bool);
//  function initialize() external;
//  function isController() external view returns (bool);
//  function liquidateCalculateSeizeTokens(address _iTokenBorrowed, address _iTokenCollateral,
//    uint256 _actualRepayAmount) external view returns (uint256 _seizedTokenCollateral);
//  function liquidationIncentiveMantissa() external view returns (uint256);
//
//  function markets(address) external view returns (
//    uint256 collateralFactorMantissa,
//    uint256 borrowFactorMantissa,
//    uint256 borrowCapacity,
//    uint256 supplyCapacity,
//    bool mintPaused,
//    bool redeemPaused,
//    bool borrowPaused
//  );
//
//  function owner() external view returns (address);
//  function pauseGuardian() external view returns (address);
//  function pendingOwner() external view returns (address);
//
//  function priceOracle() external view returns (address);
//  function rewardDistributor() external view returns (address);
//  function seizePaused() external view returns (bool);
//  function transferPaused() external view returns (bool);
//
//  function _setPriceOracle(address _newOracle) external;
//  function _setBorrowCapacity(address _iToken, uint256 _newBorrowCapacity) external;
//  function _setSupplyCapacity(address _iToken, uint256 _newSupplyCapacity) external;
//  function _setMintPaused(address _iToken, bool _paused) external;
//  function _setRedeemPaused(address _iToken, bool _paused) external;
//  function _setBorrowPaused(address _iToken, bool _paused) external;
//}
