// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../../integrations/market/ICErc20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/Math.sol";
import "../../integrations/market/IComptroller.sol";
import "../../integrations/IERC20Extended.sol";
import "../../integrations/IWmatic.sol";
import "../../interfaces/IPriceOracle.sol";
import "../../core/DataTypes.sol";
import "../../interfaces/IPlatformAdapter.sol";
import "hardhat/console.sol";

/// @notice Lending Platform Market-XYZ, see https://docs.market.xyz/
contract MarketAdapter is IPlatformAdapter {
  using SafeERC20 for IERC20;

  address public constant W_MATIC = 0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270;

  /// @notice Current balances of assets
  /// @dev User sends a collateral and calls borrow; (borrow - reserve[sourceAsset]) gives us the collateral
  mapping (address => uint) reserves;

  /// @notice get data of the pool
  /// @param pool = comptroller
  /// @return borrowRatePerBlock Normalized borrow rate can include borrow-rate-per-block + any additional fees
  /// @return collateralFactor Current collateral factor [0..1e18], where 1e18 is corresponded to CF=1
  /// @return availableCash Available underline in the pool. 0 if the market is unlisted
  function getPoolInfo(address pool, address underline)
  external
  view
  override
  returns (
    uint borrowRatePerBlock,
    uint collateralFactor,
    uint availableCash
  ) {
    address cToken = IComptroller(pool).cTokensByUnderlying(underline);
    (bool isListed, uint cf) = IComptroller(pool).markets(cToken);
    availableCash = isListed
      ? ICErc20(cToken).getCash()
      : 0; //the marked is unlisted, no cash is available
    borrowRatePerBlock = ICErc20(cToken).borrowRatePerBlock();
    collateralFactor = cf;
  }

  ///////////////////////////////////////////////////////
  ///                   IConverter
  ///////////////////////////////////////////////////////

  /// @notice Convert {sourceAmount_} to {targetAmount} using borrowing
  /// @dev this low-level function should be called from a contract which performs important safety checks
  /// @param sourceToken_ Input asset
  /// @param sourceAmount_ TODO requirements
  /// @param targetToken_ Target asset
  /// @param targetAmount_ TODO requirements
  /// @param receiver_ Receiver of cTokens
  function openPosition (
    address pool_,
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint targetAmount_,
    address receiver_
  ) external override {
    console.log("openPosition sourceToken_=%s sourceAmount_=%d", sourceToken_, sourceAmount_);
    console.log("openPosition targetToken_=%s targetAmount_=%d", targetToken_, targetAmount_);

    _supplyAndBorrow(pool_, sourceToken_, sourceAmount_, targetToken_, targetAmount_);
    //keep CTokens on the balance, user don't need them
    //TODO: send borrowed amount to receiver
    IERC20(targetToken_).safeTransfer(receiver_, targetAmount_);
  }

  ///////////////////////////////////////////////////////
  ///                   Borrow logic
  ///////////////////////////////////////////////////////

  /// @notice save current balance to reserve before sending a collateral
  /// @dev sync(), send collateral, openPosition()
  function sync(address sourceToken) external override {
    reserves[sourceToken] = IERC20(sourceToken).balanceOf(address(this));
  }

  /// @notice Borrow {targetAmount} using {sourceAmount_} as collateral
  ///         keep balance of cToken on the balance of this contract
  /// @param sourceToken_ Asset to be used as collateral
  /// @param sourceAmount_ Amount of collateral; it should already be transferred to the balance of the contract
  /// @param targetToken_ Asset to borrow
  /// @param targetAmount_ Required amount to borrow
  function _supplyAndBorrow (
    address pool_,
    address sourceToken_,
    uint sourceAmount_,
    address targetToken_,
    uint targetAmount_
  ) internal {
    IComptroller comptroller = IComptroller(pool_);
    address cTokenCollateral = comptroller.cTokensByUnderlying(sourceToken_);
    require(cTokenCollateral != address(0), "MD: source token is not supported");

    // User has transferred a collateral to balance of MarketAdapter
    // in this transaction, just before calling this function
    uint balanceBefore = reserves[sourceToken_];
    uint balanceSource = IERC20(sourceToken_).balanceOf(address(this));
    uint collateral = balanceSource - balanceBefore;

    // Supply the collateral, receive cTokens on balance of TetuConverter
    require(collateral >= sourceAmount_, "MD: insufficient input amount");
    _supply(cTokenCollateral, sourceToken_, collateral);

    // Borrow the target amount. Receive it on balance of TetuConverter
    // Register borrowed amount using the push-pattern
    _borrow(comptroller, cTokenCollateral, targetToken_, targetAmount_);

    reserves[sourceToken_] = IERC20(sourceToken_).balanceOf(address(this));
  }

  /// @notice Transfer {amount_} of {underlineToken_} from sender to pool, transfer received cTokens to the sender
  function _supply(address cTokenCollateral_, address sourceToken_, uint amount_) internal {
    amount_ = Math.min(IERC20(sourceToken_).balanceOf(address(this)), amount_); //TODO do we need this check?

// TODO: mint is not payable in ICErc20 ..
//    if (_isMatic(underlineToken_)) {
//      require(IERC20(W_MATIC).balanceOf(address(this)) >= amount_, "Market: Not enough wmatic");
//      IWmatic(W_MATIC).withdraw(amount_);
//      ICErc20(cToken).mint{value : amount_}();
//    } else {
      IERC20(sourceToken_).safeApprove(cTokenCollateral_, 0);
      IERC20(sourceToken_).safeApprove(cTokenCollateral_, amount_);
      require(ICErc20(cTokenCollateral_).mint(amount_) == 0, "MD: Supplying failed");
//    }
  }

  /// @param cTokenCollateral_ cToken that should be used as a collateral
  /// @param targetToken_ Asset that should be borrowed
  function _borrow(IComptroller comptroller_, address cTokenCollateral_, address targetToken_, uint amount_) internal {
    //enter to market
    address[] memory markets = new address[](1);
    markets[0] = cTokenCollateral_;
    comptroller_.enterMarkets(markets);

    //borrow amount
    address cTokenBorrow = comptroller_.cTokensByUnderlying(targetToken_);
    require(cTokenBorrow != address(0), "MD: target token is not supported");

    // Error codes: https://docs.rari.capital/fuse/#error-codes
    uint ret = ICErc20(cTokenBorrow).borrow(amount_);
    console.log("borrow result %d", ret);
    require(ret == 0, "MD: borrow error"); //!TODO: how to return error code ret here?

    // ensure that we have received the borrowed amount
    uint borrowBalance = ICErc20(cTokenBorrow).borrowBalanceCurrent(address(this));
    require(borrowBalance == amount_, "MD: wrong borrow balance");
  }


  ///////////////////////////////////////////////////////
  ///                   Helper utils
  ///////////////////////////////////////////////////////
  function _isMatic(address token) internal pure returns (bool) {
    return token == W_MATIC;
  }
}
