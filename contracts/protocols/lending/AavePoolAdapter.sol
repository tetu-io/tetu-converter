import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../interfaces/IPoolAdapter.sol";
import "../../core/DebtMonitor.sol";
import "../../integrations/aave/IAavePool.sol";
import "../../integrations/aave/IAavePriceOracle.sol";
import "../../integrations/aave/IAaveAddressesProvider.sol";

/// @notice Implementation of IPoolAdapter for AAVE-protocol, see https://docs.aave.com/hub/
/// @dev Instances of this contract are created using proxy-minimal pattern, so no constructor
contract AavePoolAdapter is IPoolAdapter {
  using SafeERC20 for IERC20;

  /// @notice 1 - stable, 2 - variable
  uint constant public RATE_MODE = 2;

  address public override collateralToken;
  address public override user;

  IController public controller;
  IAavePool private _pool;
  IAavePriceOracle private _priceOracle;

  /// @notice Last synced amount of given token on the balance of this contract
  mapping(address => uint) public collateralBalance;

  ///////////////////////////////////////////////////////
  ///                Initialization
  ///////////////////////////////////////////////////////

  function initialize(
    address controller_,
    address pool_,
    address user_,
    address collateralUnderline_
  ) override external {
    require(controller_ != address(0), "zero controller");
    require(pool_ != address(0), "zero pool");
    require(user_ != address(0), "zero user");
    require(collateralUnderline_ != address(0), "zero collateral");

    controller = IController(controller_);
    user = user_;
    collateralToken = collateralUnderline_;

    _pool = IAavePool(pool_);
    _priceOracle = IAavePriceOracle(IAaveAddressesProvider(_pool.ADDRESSES_PROVIDER()).getPriceOracle());
  }

  ///////////////////////////////////////////////////////
  ///                 Borrow logic
  ///////////////////////////////////////////////////////

  /// @dev TC calls this function before transferring any amounts to balance of this contract
  function sync(address tokenToBorrow_) external {
    _onlyTC();

    collateralBalance[collateralToken] = IERC20(collateralToken).balanceOf(address(this));
    collateralBalance[tokenToBorrow_] = IERC20(tokenToBorrow_).balanceOf(address(this));
  }

  /// @notice Supply collateral to the pool and borrow {borrowedAmount_} in {borrowedToken_}
  /// @dev Caller should call "sync" before "borrow"
  function borrow(
    uint collateralAmount_,
    address borrowedToken_,
    uint borrowedAmount_,
    address receiver_
  ) external override {
    _onlyTC();

    //a-tokens
    DataTypes.ReserveData memory d = _pool.getReserveData(borrowedToken_);
    uint aTokensBalance = IERC20(d.aTokenAddress).balanceOf(address(this));

    // check received amount
    require(collateralAmount_ == IERC20(collateralToken).balanceOf(address(this)) - collateralBalance[collateralToken]
      , "APA:Wrong collateral balance");

    // Supplies an `amount` of underlying asset into the reserve, receiving in return overlying aTokens.
    // E.g. User supplies 100 USDC and gets in return 100 aUSDC
    IERC20(collateralToken).approve(address(_pool), collateralAmount_);
    _pool.supply(
      collateralToken,
      collateralAmount_,
      address(this),
      0 // no referral code
    );

    // ensure that we received a-tokens
    uint aTokensAmount = IERC20(d.aTokenAddress).balanceOf(address(this)) - aTokensBalance;
    require(aTokensAmount == collateralAmount_, "APA: wront atokens balance");

    // ensure that we can borrow allowed amount safely
    _ensureSafeToBorrow(borrowedToken_, borrowedAmount_);

    // make borrow, send borrow money from the pool to the receiver
    _pool.borrow(
      borrowedToken_,
      borrowedAmount_,
      RATE_MODE,
      0, // no referral code
      address(this)
    );

    // ensure that we have received required borrowed amount, send the amount to the receiver
    require(borrowedAmount_ == IERC20(borrowedToken_).balanceOf(address(this)) - collateralBalance[borrowedToken_]
    , "APA:Wrong borrow balance");
    IERC20(borrowedToken_).transfer(receiver_, borrowedAmount_);

    // register the borrow in DebtMonitor
    IDebtMonitor(controller.debtMonitor()).onBorrow(d.aTokenAddress, aTokensAmount, borrowedToken_);

    // TODO: send aTokens anywhere?
  }

  /// @notice Revert if health factor will be below threshold after borrowing {amountToBorrow_}
  function _ensureSafeToBorrow(
    address tokenToBorrow_,
    uint amountToBorrow_
  ) internal {
    (uint256 totalCollateralBase,
    uint256 totalDebtBase,
    uint256 availableBorrowsBase,
    uint256 currentLiquidationThreshold,
    uint256 ltv,
    ) = _pool.getUserAccountData(address(this));

    //TODO
  }


  ///////////////////////////////////////////////////////
  ///                 Repay logic
  ///////////////////////////////////////////////////////

  /// @notice Repay borrowed amount, return collateral to the user
  /// @dev Caller should call "sync" before "repay"
  function repay(
    address borrowedToken_,
    uint amountToRepay_,
    address receiver_
  ) external override {
    // ensure that we have received enough money on our balance just before repay was called
    // TODO dust tokens are possible, what if we need to repay all debts completely? borrowedAmount_ == -1 ?
    require(amountToRepay_ == IERC20(borrowedToken_).balanceOf(address(this)) - collateralBalance[borrowedToken_]
      , "APA:Wrong repay balance");

    // transfer borrow amount back to the pool
    _pool.repay(borrowedToken_,
      amountToRepay_, //TODO amount to be repaid, expressed in wei units.
      RATE_MODE,
      address(this)
    );

    // withdraw the collateral
    uint amountCollateralToReturn = _getCollateralAmountToReturn(borrowedToken_, amountToRepay_);
    _pool.withdraw(collateralToken,
      amountCollateralToReturn, //TODO: amount deposited, expressed in wei units.  Use type(uint).max to withdraw the entire balance.
      receiver_
    );

    // update borrow position status in DebtMonitor
    //TODO IDebtMonitor(controller.debtMonitor()).onRepay(d.aTokenAddress, aTokensAmount, borrowedToken_);

  }

  /// @param amountToRepay_ Amount to be repaid [in borrowed tokens]
  /// @return Amount of collateral [in collateral tokens] to be returned in exchange of {borrowedAmount_}
  function _getCollateralAmountToReturn(address borrowedToken_, uint amountToRepay_) internal returns (uint) {
    // get total amount of the borrow position
    (uint256 totalCollateralBase, uint256 totalDebtBase,,,,) = _pool.getUserAccountData(address(this));
    require(totalDebtBase != 0, "APA:zero totalDebtBase");

    // how much collateral we have provided?

    // the asset price in the base currency
    address[] memory assets = new address[](2);
    assets[0] = collateralToken;
    assets[1] = borrowedToken_;

    uint[] memory prices = _priceOracle.getAssetsPrices(assets);

    uint amountToRepayBase = amountToRepay_ * prices[0];
    return // == totalCollateral * amountToRepay / totalDebt
      totalCollateralBase * (10 ** IERC20Extended(collateralToken).decimals()) //TODO we need to return the amount in wei units
      / prices[1]
      / _priceOracle.BASE_CURRENCY_UNIT() // == 1e8 for USD
      * (
        amountToRepayBase == totalDebtBase
          ? 1
          : amountToRepayBase / totalDebtBase
      );
  }

  ///////////////////////////////////////////////////////
  ///         View current status
  ///////////////////////////////////////////////////////

  function pool() external view override returns (address) {
    return address(_pool);
  }

  /// @notice How much we should pay to close the borrow
  function getAmountToRepay(address borrowedToken_) external view override returns (uint) {
    return 0; //TODO
  }

  /// @return outCountItems Count of valid items in the output arrays
  /// @return outBorrowedTokens List of borrowed tokens (BT)
  /// @return outCollateralAmountsCT List of summary collateral amounts [in collateral tokens]
  /// @return outAmountsToPayBT List of amounts that should be repay [in borrowed tokens] to return the collaterals
  function getOpenedPositions() external view override returns (
    uint outCountItems,
    address[] memory outBorrowedTokens,
    uint[] memory outCollateralAmountsCT,
    uint[] memory outAmountsToPayBT
  ) {
    //TODO
    return (outCountItems, outBorrowedTokens, outCollateralAmountsCT, outAmountsToPayBT);
  }

  function collateralFactor() external view override returns (uint) {
    return 0; //TODO
  }

  /// @notice Ensure that the caller is TetuConveter
  function _onlyTC() internal view {
    //TODO
  }

  /// @notice Convert {amount} with [sourceDecimals} to new amount with {targetDecimals}
  function _toMantissa(uint amount, uint8 sourceDecimals, uint8 targetDecimals) internal pure returns (uint) {
    return sourceDecimals == targetDecimals
    ? amount
    : amount * (10 ** targetDecimals) / (10 ** sourceDecimals);
  }
}