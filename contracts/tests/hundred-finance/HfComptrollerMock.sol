// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../../openzeppelin/IERC20.sol";
import "../../openzeppelin/SafeERC20.sol";
import "hardhat/console.sol";
import "../../integrations/hundred-finance/IHfComptroller.sol";
import "../../integrations/hundred-finance/IHfCToken.sol";

/// @notice Implement some key-functions of the HfComptroller
///         used by HfPoolAdapter
///         Function calls are just delegated to original pool
///         But the mock allows to change the logic of any function if it's necessary for tests
///         HfPoolAdapter uses IHfComptroller together with CTokens, so
///         it's necessary to mock all contracts at the same time: controller, price-oracle, both cTokens
///         This contract provides real implementation for cToken-functions too.
/// @dev This mock is used to check communication between HfPoolAdapter and HundredFinance-comptroller
///      HundredFinance-comptroller is mocked, so we are able to imitate various HundredFinance-comptroller-errors
contract HfComptrollerMock is IHfComptroller {
  using SafeERC20 for IERC20;

  IHfComptroller public comptroller;
  address public collateralCToken;
  address public borrowCToken;
  address public mockedCollateralCToken;
  address public mockedBorrowCToken;
  address public assetBorrow;
  address public assetCollateral;

  bool public repayBorrowFails;
  bool public redeemFails;
  bool public ignoreBorrow;
  bool public getAccountLiquidityFails;
  bool public getAccountLiquidityReturnsIncorrectLiquidity;
  bool public mintFails;
  bool public borrowFails;

  constructor (
    address comptroller_,
    address collateralAsset_,
    address borrowAsset_,
    address collateralCToken_,
    address borrowCToken_,
    address mockedCollateralCToken_,
    address mockedBorrowCToken_
  ) {
    comptroller = IHfComptroller(comptroller_);
    IERC20(collateralCToken_).safeApprove(comptroller_, type(uint).max);
    IERC20(borrowCToken_).safeApprove(comptroller_, type(uint).max);
    console.log("HfControllerMock is used instead of real HundredFinance controller", address(this), comptroller_);

    collateralCToken = collateralCToken_;
    mockedCollateralCToken = mockedCollateralCToken_;
    borrowCToken = borrowCToken_;
    mockedBorrowCToken = mockedBorrowCToken_;
    assetBorrow = borrowAsset_;
    assetCollateral = collateralAsset_;

    IERC20(collateralAsset_).safeApprove(collateralCToken_, type(uint).max);
    IERC20(borrowAsset_).safeApprove(borrowCToken_, type(uint).max);
  }

  /////////////////////////////////////////////////////////////////
  ///       Config the mock
  /////////////////////////////////////////////////////////////////
  function setIgnoreBorrow() external {
    console.log("Set ignoreBorrow=true");
    ignoreBorrow = true;
  }
  function setRepayBorrowFails() external {
    console.log("Set repayBorrowFails=true");
    repayBorrowFails = true;
  }
  function setRedeemFails() external {
    console.log("Set redeemFails=true");
    redeemFails = true;
  }
  function setGetAccountLiquidityFails() external {
    console.log("Set getAccountLiquidityFails=true");
    getAccountLiquidityFails = true;
  }
  function setGetAccountLiquidityReturnsIncorrectLiquidity() external {
    console.log("Set getAccountLiquidityReturnsIncorrectLiquidity");
    getAccountLiquidityReturnsIncorrectLiquidity = true;
  }
  function setMintFails() external {
    console.log("Set mint fails");
    mintFails = true;
  }
  function setBorrowFails() external {
    console.log("Set borrow fails");
    borrowFails = true;
  }
  /////////////////////////////////////////////////////////////////
  ///        Calls from HfCTokenMock
  ///        delegated to real CTokens
  ///        (this contract must be the message sender)
  /////////////////////////////////////////////////////////////////
  function balanceOf(IHfCToken cToken, address owner) external view returns (uint256) {
    console.log("HfComptrollerMock.balanceOf", owner);
    return cToken.balanceOf(address(this));
  }
  function mint(IHfCToken cToken, uint256 mintAmount_) external returns (uint256) {
    IERC20(assetCollateral).safeTransferFrom(msg.sender, address(this), mintAmount_);
    console.log("HfComptrollerMock.mint", mintAmount_,IERC20(assetCollateral).balanceOf(address(this)));
    if (mintFails) {
      return 17;
    } else {
      return cToken.mint(mintAmount_);
    }
  }
  function redeem(IHfCToken cToken, uint256 redeemTokens) external returns (uint256) {
    if (redeemFails) {
      return 17; // error
    }
    uint dest = cToken.redeem(redeemTokens);
    uint amount = IERC20(cToken.underlying()).balanceOf(address(this));
    IERC20(cToken.underlying()).safeTransfer(msg.sender, amount);
    console.log("HfComptrollerMock.redeem", redeemTokens, IERC20(cToken.underlying()).balanceOf(address(this)));
    return dest;
  }
  function getAccountSnapshot(IHfCToken cToken, address account) external view returns (
    uint256 error, uint256 tokenBalance, uint256 borrowBalance, uint256 exchangeRateMantissa
  ) {
    account;
    return cToken.getAccountSnapshot(address(this));
  }
  function borrow(IHfCToken cToken, uint256 borrowAmount_) external returns (uint256) {
    if (ignoreBorrow) {
      return 0;
    } else {
      if (borrowFails) {
        return 17;
      } else {
        console.log("HfComptrollerMock.borrow", address(cToken), borrowAmount_);
        uint dest = cToken.borrow(borrowAmount_);
        console.log("HfComptrollerMock.borrow.done, received", IERC20(assetBorrow).balanceOf(address(this)));
        IERC20(assetBorrow).safeTransfer(msg.sender, borrowAmount_);

        return dest;
      }
    }
  }
  function repayBorrow(IHfCToken cToken, uint256 repayAmount) external returns (uint256) {
    console.log("HfComptrollerMock.repayBorrow", repayAmount);
    if (repayBorrowFails) {
      console.log("HfComptrollerMock.repayBorrow returns error");
      return 17; // error
    }
    IERC20(cToken.underlying()).safeTransferFrom(msg.sender, address(this), repayAmount);
    console.log("HfComptrollerMock.repayBorrow", address(this), IERC20(cToken.underlying()).balanceOf(address(this)));
    return cToken.repayBorrow(repayAmount);
  }

  function enterMarkets(address[] memory cTokens_) external override returns (uint256[] memory) {
    console.log("HfComptrollerMock.enterMarkets");
    address[] memory tokens = new address[](cTokens_.length);
    for (uint i = 0; i < cTokens_.length; ++i) {
      if (cTokens_[i] == mockedCollateralCToken) {
        tokens[i] = collateralCToken;
      } else if (cTokens_[i] == mockedBorrowCToken) {
        tokens[i] = borrowCToken;
      } else {
        tokens[i] = cTokens_[i];
      }
    }
    return comptroller.enterMarkets(tokens);
  }

  function markets(address target_) external override view returns (
    bool isListed,
    uint256 collateralFactorMantissa,
    bool isComped
  ) {
    console.log("HfComptrollerMock.markets", target_);
    address target = target_ == mockedCollateralCToken
      ? collateralCToken
      : target_ == mockedBorrowCToken
        ? borrowCToken
        : target_;
    console.log("HfComptrollerMock.markets.target", target);
    console.log("HfComptrollerMock.markets.mockedCollateralCToken", mockedCollateralCToken);
    console.log("HfComptrollerMock.markets.collateralCToken", collateralCToken);
    console.log("HfComptrollerMock.markets.mockedBorrowCToken", mockedBorrowCToken);
    console.log("HfComptrollerMock.markets.borrowCToken", borrowCToken);

    (isListed,
     collateralFactorMantissa,
     isComped
    ) = comptroller.markets(target);

    console.log("isListed", isListed);
    return (isListed, collateralFactorMantissa, isComped);
  }

  /////////////////////////////////////////////////////////////////
  ///       IHfComptroller facade
  ///       All functions required by HfPoolAdapter
  ///       Replace mocked-cTokens by real one on the fly
  /////////////////////////////////////////////////////////////////

  function getAccountLiquidity(address account) external override view returns (
    uint256 error, uint256 liquidity, uint256 shortfall
  ) {
    console.log("HfComptrollerMock.getAccountLiquidity", account);
    if (getAccountLiquidityFails) {
      return (17, liquidity, shortfall);
    } else if (getAccountLiquidityReturnsIncorrectLiquidity) {
      return (0, 1, shortfall); // VERY small liquidity
    } else {
      return comptroller.getAccountLiquidity(address(this));
    }
  }

  function oracle() external override view returns (address) {
    console.log("HfComptrollerMock.oracle");
    return comptroller.oracle();
  }



  /////////////////////////////////////////////////////////////////
  ///       IHfComptroller facade
  ///       All other functions
  ///
  ///       ATTENTION
  ///
  //        If you need any of following function
  //        move them in the above section
  //        and correctly replace params on the fly
  //        (cTokens addresses and user account address)
  /////////////////////////////////////////////////////////////////
  function accountAssets(address a, uint256 b) external override view returns (address) {
    return comptroller.accountAssets(a, b);
  }
  function admin() external override view returns (address) {
    return comptroller.admin();
  }
  function allMarkets(uint256 a) external override view returns (address) {
    return comptroller.allMarkets(a);
  }

  function borrowAllowed(address cToken, address borrower, uint256 borrowAmount) external override returns (uint256) {
    return comptroller.borrowAllowed(cToken, borrower, borrowAmount);
  }

  function borrowCapGuardian() external override view returns (address) {
    return comptroller.borrowCapGuardian();
  }
  function borrowCaps(address cToken) external override view returns (uint256) {
    return comptroller.borrowCaps(cToken);
  }
  function borrowGuardianPaused(address a) external override view returns (bool) {
    return comptroller.borrowGuardianPaused(a);
  }
  function borrowVerify(address cToken, address borrower, uint256 borrowAmount) external override {
    return comptroller.borrowVerify(cToken, borrower, borrowAmount);
  }

  function bprotocol(address a) external override view returns (address) {
    return comptroller.bprotocol(a);
  }
  function checkMembership(address account, address cToken) external override view returns (bool) {
    return comptroller.checkMembership(account, cToken);
  }

  function claimComp(address holder, address[] memory cTokens) external override {
    return comptroller.claimComp(holder, cTokens);
  }
  function claimComp(address[] memory holders, address[] memory cTokens) external override {
    return comptroller.claimComp(holders, cTokens);
  }
  function claimComp(address holder) external override {
    comptroller.claimComp(holder);
  }
  function closeFactorMantissa() external override view returns (uint256) {
    return comptroller.closeFactorMantissa();
  }
  function compAccrued(address a) external override view returns (uint256) {
    return comptroller.compAccrued(a);
  }
  function compBorrowState(address a) external override view returns (uint224 index_, uint32 block_) {
    return comptroller.compBorrowState(a);
  }
  function compBorrowerIndex(address a, address b) external override view returns (uint256) {
    return comptroller.compBorrowerIndex(a, b);
  }
  function compContributorSpeeds(address a) external override view returns (uint256) {
    return comptroller.compContributorSpeeds(a);
  }
  function compInitialIndex() external override view returns (uint224) {
    return comptroller.compInitialIndex();
  }
  function compRate() external override view returns (uint256) {
    return comptroller.compRate();
  }
  function compSpeeds(address a) external override view returns (uint256) {
    return comptroller.compSpeeds(a);
  }
  function compSupplierIndex(address a, address b) external override view returns (uint256) {
    return comptroller.compSupplierIndex(a, b);
  }
  function compSupplyState(address a) external override view returns (uint224 index, uint32 block_) {
    return comptroller.compSupplyState(a);
  }
  function exitMarket(address cTokenAddress) external override returns (uint256) {
    return comptroller.exitMarket(cTokenAddress);
  }
  function getAllMarkets() external override view returns (address[] memory) {
    return comptroller.getAllMarkets();
  }
  function getAssetsIn(address account) external override view returns (address[] memory) {
    return comptroller.getAssetsIn(account);
  }
  function getBlockNumber() external override view returns (uint256) {
    return comptroller.getBlockNumber();
  }
  function getCompAddress() external override pure returns (address) {
    return address(0); // just a stub
  }
  function getHypotheticalAccountLiquidity(address account, address cTokenModify, uint256 redeemTokens, uint256 borrowAmount) external override view returns (
    uint256,
    uint256,
    uint256
  ) {
    return comptroller.getHypotheticalAccountLiquidity(account, cTokenModify, redeemTokens, borrowAmount);
  }

  function implementation() external override view returns (address) {
    return comptroller.implementation();
  }
  function isComptroller() external override view returns (bool) {
    return comptroller.isComptroller();
  }
  function lastContributorBlock(address a) external override view returns (uint256) {
    return comptroller.lastContributorBlock(a);
  }
  function liquidateBorrowAllowed(
    address cTokenBorrowed,
    address cTokenCollateral,
    address liquidator,
    address borrower,
    uint256 repayAmount
  ) external override returns (uint256) {
    return comptroller.liquidateBorrowAllowed(cTokenBorrowed, cTokenCollateral, liquidator, borrower, repayAmount);
  }
  function liquidateBorrowVerify(
    address cTokenBorrowed,
    address cTokenCollateral,
    address liquidator,
    address borrower,
    uint256 actualRepayAmount,
    uint256 seizeTokens
  ) external override {
    return comptroller.liquidateBorrowVerify(cTokenBorrowed, cTokenCollateral, liquidator, borrower, actualRepayAmount, seizeTokens);
  }
  function liquidateCalculateSeizeTokens(
    address cTokenBorrowed,
    address cTokenCollateral,
    uint256 actualRepayAmount
  ) external override view returns (uint256, uint256) {
    return comptroller.liquidateCalculateSeizeTokens(cTokenBorrowed, cTokenCollateral, actualRepayAmount);
  }

  function liquidationIncentiveMantissa() external override view returns (uint256) {
    return comptroller.liquidationIncentiveMantissa();
  }

  function maxAssets() external override view returns (uint256) {
    return comptroller.maxAssets();
  }

  function mintAllowed(
    address cToken,
    address minter,
    uint256 mintAmount
  ) external override returns (uint256) {
    return comptroller.mintAllowed(cToken, minter, mintAmount);
  }

  function mintGuardianPaused(address a) external override view returns (bool) {
    return comptroller.mintGuardianPaused(a);
  }
  function mintVerify(
    address cToken,
    address minter,
    uint256 actualMintAmount,
    uint256 mintTokens
  ) external override {
    return comptroller.mintVerify(cToken, minter, actualMintAmount, mintTokens);
  }

  function pauseGuardian() external override view returns (address) {
    return comptroller.pauseGuardian();
  }
  function pendingAdmin() external override view returns (address) {
    return comptroller.pendingAdmin();
  }
  function pendingImplementation() external override view returns (address) {
    return comptroller.pendingImplementation();
  }
  function redeemAllowed(
    address cToken,
    address redeemer,
    uint256 redeemTokens
  ) external override returns (uint256) {
    return comptroller.redeemAllowed(cToken, redeemer, redeemTokens);
  }

  function redeemVerify(
    address cToken,
    address redeemer,
    uint256 redeemAmount,
    uint256 redeemTokens
  ) external override {
    return comptroller.redeemVerify(cToken, redeemer, redeemAmount, redeemTokens);
  }
  function repayBorrowAllowed(
    address cToken,
    address payer,
    address borrower,
    uint256 repayAmount
  ) external override returns (uint256) {
    return comptroller.repayBorrowAllowed(cToken, payer, borrower, repayAmount);
  }
  function repayBorrowVerify(
    address cToken,
    address payer,
    address borrower,
    uint256 actualRepayAmount,
    uint256 borrowerIndex
  ) external override {
    return comptroller.repayBorrowVerify(cToken, payer, borrower, actualRepayAmount, borrowerIndex);
  }

  function seizeAllowed(
    address cTokenCollateral,
    address cTokenBorrowed,
    address liquidator,
    address borrower,
    uint256 seizeTokens
  ) external override returns (uint256) {
    return comptroller.seizeAllowed(cTokenCollateral, cTokenBorrowed, liquidator, borrower, seizeTokens);
  }

  function seizeGuardianPaused() external override view returns (bool) {
    return comptroller.seizeGuardianPaused();
  }

  function seizeVerify(
    address cTokenCollateral,
    address cTokenBorrowed,
    address liquidator,
    address borrower,
    uint256 seizeTokens
  ) external override {
    return comptroller.seizeVerify(cTokenCollateral, cTokenBorrowed, liquidator, borrower, seizeTokens);
  }

  function transferAllowed(
    address cToken,
    address src,
    address dst,
    uint256 transferTokens
  ) external override returns (uint256) {
    return comptroller.transferAllowed(cToken, src, dst, transferTokens);
  }

  function transferGuardianPaused() external override view returns (bool) {
    return comptroller.transferGuardianPaused();
  }

  function transferVerify(
    address cToken,
    address src,
    address dst,
    uint256 transferTokens
  ) external override {
    comptroller.transferVerify(cToken, src, dst, transferTokens);
  }

  function updateContributorRewards(address contributor) external override {
    comptroller.updateContributorRewards(contributor);
  }
  function _setPriceOracle(address newOracle) external override returns (uint256) {
    return comptroller._setPriceOracle(newOracle);
  }

  function _setMarketBorrowCaps(address[] memory cTokens, uint256[] memory newBorrowCaps) external override {
    comptroller._setMarketBorrowCaps(cTokens, newBorrowCaps);
  }
  function _setMintPaused(address cToken, bool state) external override returns (bool) {
    return comptroller._setMintPaused(cToken, state);
  }
  function _setBorrowPaused(address cToken, bool state) external override returns (bool) {
    return comptroller._setBorrowPaused(cToken, state);
  }
  function _setTransferPaused(bool state) external override returns (bool) {
    return comptroller._setTransferPaused(state);
  }
}