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
import "../../interfaces/ILendingPlatform.sol";

/// @notice Lending Platform Market-XYZ, see https://docs.market.xyz/
contract MarketDecorator is ILendingPlatform {
  using SafeERC20 for IERC20;

  address public constant W_MATIC = 0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270;
  IPriceOracle public priceOracle;

  constructor(address priceOracle_) {
    require(priceOracle_ != address(0), "price oracle not assigned");
    priceOracle = IPriceOracle(priceOracle_);
  }

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
    _supplyAndBorrow(pool_, sourceToken_, sourceAmount_, targetToken_, targetAmount_);
    //keep CTokens on the balance, user don't need them
    //TODO: send borrowed amount to receiver
  }

  ///////////////////////////////////////////////////////
  ///                   Borrow logic
  ///////////////////////////////////////////////////////

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
    require(cTokenCollateral != address(0), "source token is not supported");

    // User has transferred a collateral to balance of TetuConverter
    uint balanceBefore = 0; //TODO
    uint balanceSource = IERC20(sourceToken_).balanceOf(address(this));
    uint collateral = balanceSource - balanceBefore;

    // Supply the collateral, receive cTokens on balance of TetuConverter
    require(collateral >= sourceAmount_, "TC: insufficient input amount");
    _supply(cTokenCollateral, sourceToken_, collateral);

    // Borrow the target amount. Receive it on balance of TetuConverter
    // Register borrowed amount using the push-pattern
    _borrow(comptroller, cTokenCollateral, targetToken_, targetAmount_);
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
      require(ICErc20(cTokenCollateral_).mint(amount_) == 0, "Market: Supplying failed");
//    }

    uint cTokenAmount = IERC20(cTokenCollateral_).balanceOf(address(this));
    IERC20(cTokenCollateral_).safeTransfer(msg.sender, cTokenAmount);
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
    require(cTokenBorrow != address(0), "target token is not supported");

    ICErc20(cTokenBorrow).borrow(amount_);
  }


  ///////////////////////////////////////////////////////
  ///                   Helper utils
  ///////////////////////////////////////////////////////
  function _isMatic(address token) internal pure returns (bool) {
    return token == W_MATIC;
  }
}
