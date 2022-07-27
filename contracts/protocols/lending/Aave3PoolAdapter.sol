import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../interfaces/IPoolAdapter2.sol";
import "../../core/DebtMonitor.sol";
import "../../integrations/aave/IAavePool.sol";
import "../../integrations/aave/IAavePriceOracle.sol";
import "../../integrations/aave/IAaveAddressesProvider.sol";

/// @notice Implementation of IPoolAdapter for AAVE-protocol, see https://docs.aave.com/hub/
/// @dev Instances of this contract are created using proxy-minimal pattern, so no constructor
contract Aave3PoolAdapter is IPoolAdapter2 {
  using SafeERC20 for IERC20;

  /// @notice 1 - stable, 2 - variable
  uint constant public RATE_MODE = 2;

  address public collateralAsset;
  address public borrowAsset;
  address public user;

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
    address collateralAsset_,
    address borrowAsset_
  ) override external {
    require(controller_ != address(0), "zero controller");
    require(pool_ != address(0), "zero pool");
    require(user_ != address(0), "zero user");
    require(collateralAsset_ != address(0), "zero collateral");
    require(borrowAsset_ != address(0), "zero borrow token");

    controller = IController(controller_);
    user = user_;
    collateralAsset = collateralAsset_;
    borrowAsset = borrowAsset_;

    _pool = IAavePool(pool_);
    _priceOracle = IAavePriceOracle(IAaveAddressesProvider(_pool.ADDRESSES_PROVIDER()).getPriceOracle());
  }

  ///////////////////////////////////////////////////////
  ///        Sync balances before borrow/repay
  ///////////////////////////////////////////////////////

  /// @dev TC calls this function before transferring any amounts to balance of this contract
  function sync() external {
    _onlyTC();

    collateralBalance[collateralAsset] = IERC20(collateralAsset).balanceOf(address(this));
    collateralBalance[borrowAsset] = IERC20(borrowAsset).balanceOf(address(this));
  }

  ///////////////////////////////////////////////////////
  ///                 Borrow logic
  ///////////////////////////////////////////////////////

  /// @notice Supply collateral to the pool and borrow {borrowedAmount_}
  /// @dev Caller should call "sync" before "borrow"
  function borrow(
    uint collateralAmount_,
    uint borrowAmount_,
    address receiver_
  ) external override {
    _onlyTC();

    //a-tokens
    DataTypes.ReserveData memory d = _pool.getReserveData(collateralAsset);
    uint aTokensBalance = IERC20(d.aTokenAddress).balanceOf(address(this));

    console.log("collateralAmount_ %d", collateralAmount_);
    console.log("Collateral balance %d", IERC20(collateralAsset).balanceOf(address(this)));
    console.log("sync %d", collateralBalance[collateralAsset]);
    console.log("diff %d", IERC20(collateralAsset).balanceOf(address(this)) - collateralBalance[collateralAsset]);

    // ensure we have received expected collateral amount
    require(collateralAmount_ >= IERC20(collateralAsset).balanceOf(address(this)) - collateralBalance[collateralAsset]
      , "APA:Wrong collateral balance");

    // Supplies an `amount` of underlying asset into the reserve, receiving in return overlying aTokens.
    // E.g. User supplies 100 USDC and gets in return 100 aUSDC
    IERC20(collateralAsset).approve(address(_pool), collateralAmount_);
    _pool.supply(
      collateralAsset,
      collateralAmount_,
      address(this),
      0 // no referral code
    );
    _pool.setUserUseReserveAsCollateral(collateralAsset, true);
    (uint256 totalCollateralBase,,,,,) = _pool.getUserAccountData(user);
    console.log("totalCollateralBase %d", totalCollateralBase);
    console.log("Collateral balance %d", IERC20(collateralAsset).balanceOf(address(this)));

    // ensure that we received a-tokens
    uint aTokensAmount = IERC20(d.aTokenAddress).balanceOf(address(this)) - aTokensBalance;
    console.log("aTokensAmount %d", aTokensAmount);
    console.log("aTokensAmount balance %d", IERC20(d.aTokenAddress).balanceOf(address(this)));
    console.log("aTokensAmount balance inc %d", IERC20(d.aTokenAddress).balanceOf(address(this))- aTokensBalance);
    require(aTokensAmount >= collateralAmount_, "APA: wrong aTokens balance");

    // ensure that we can borrow allowed amount safely
    _ensureSafeToBorrow(borrowAmount_);

    // make borrow, send borrowed amount to the receiver
    // we cannot transfer borrowed amount directly to receiver because the debt is incurred by amount receiver
    _pool.borrow(
      borrowAsset,
      borrowAmount_,
      RATE_MODE,
      0, // no referral code
      address(this)
    );

    // ensure that we have received required borrowed amount, send the amount to the receiver
    require(borrowAmount_ == IERC20(borrowAsset).balanceOf(address(this)) - collateralBalance[borrowAsset]
    , "APA:Wrong borrow balance");
    IERC20(borrowAsset).safeTransfer(receiver_, borrowAmount_);

    // register the borrow in DebtMonitor
    //!TODO: IDebtMonitor(controller.debtMonitor()).onBorrow(d.aTokenAddress, aTokensAmount, borrowAsset);

    // TODO: send aTokens anywhere?
  }

  /// @notice Revert if health factor will be below threshold after borrowing {amountToBorrow_}
  function _ensureSafeToBorrow(uint amountToBorrow_) internal view {
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

  function repay(
    uint amountToRepay_,
    address receiver_,
    bool closePosition
  ) external override {
    // ensure that we have received enough money on our balance just before repay was called
    uint borrowAmountOnBalance = IERC20(borrowAsset).balanceOf(address(this)) - collateralBalance[borrowAsset];
    require(closePosition || amountToRepay_ == borrowAmountOnBalance, "APA:Wrong repay balance");

    // transfer borrow amount back to the pool
    //TODO amount to be repaid, expressed in wei units.
    _pool.repay(borrowAsset, amountToRepay_, RATE_MODE, address(this)
    );

    if (closePosition) {
      // repay remain debt using aTokens
      _pool.repayWithATokens(borrowAsset, type(uint256).max, RATE_MODE);
    }

    // withdraw the collateral
    uint amountCollateralToReturn = closePosition
      ? type(uint).max
      : _getCollateralAmountToReturn(borrowAsset, amountToRepay_);
    _pool.withdraw(collateralAsset, amountCollateralToReturn, receiver_);

    // update borrow position status in DebtMonitor
    //TODO IDebtMonitor(controller.debtMonitor()).onRepay(d.aTokenAddress, aTokensAmount, borrowAsset);
  }

  /// @param amountToRepay_ Amount to be repaid [in borrowed tokens]
  /// @return Amount of collateral [in collateral tokens] to be returned in exchange of {borrowedAmount_}
  function _getCollateralAmountToReturn(address borrowAsset, uint amountToRepay_) internal returns (uint) {
    // get total amount of the borrow position
    (uint256 totalCollateralBase, uint256 totalDebtBase,,,,) = _pool.getUserAccountData(address(this));
    require(totalDebtBase != 0, "APA:zero totalDebtBase");

    // how much collateral we have provided?

    // the asset price in the base currency
    address[] memory assets = new address[](2);
    assets[0] = collateralAsset;
    assets[1] = borrowAsset;

    uint[] memory prices = _priceOracle.getAssetsPrices(assets);

    uint amountToRepayBase = amountToRepay_ * prices[0];
    return // == totalCollateral * amountToRepay / totalDebt
      totalCollateralBase * (10 ** IERC20Extended(collateralAsset).decimals()) //TODO we need to return the amount in wei units
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

  function getConfig() external view override returns (
    address pool,
    address user,
    address collateralAsset,
    address borrowAsset
  ) {
    return (address(_pool), user, collateralAsset, borrowAsset);
  }

  function getStatus() external view override returns (
    uint collateralAmount,
    uint amountsToPay,
    uint healthFactor
  ) {
    (uint256 totalCollateralBase,
     uint256 totalDebtBase,
     uint256 availableBorrowsBase,
     uint256 currentLiquidationThreshold,
     uint256 ltv,
     uint256 healthFactor
    ) = _pool.getUserAccountData(user);

    return (
      totalCollateralBase, //TODO: units
      totalDebtBase, //TODO: units
      healthFactor
    );
  }

  ///////////////////////////////////////////////////////
  ///                    Utils
  ///////////////////////////////////////////////////////

  /// @notice Ensure that the caller is TetuConveter
  function _onlyTC() internal view {
    require(controller.tetuConverter() == msg.sender, "not TC");
  }

  /// @notice Convert {amount} with [sourceDecimals} to new amount with {targetDecimals}
  function _toMantissa(uint amount, uint8 sourceDecimals, uint8 targetDecimals) internal pure returns (uint) {
    return sourceDecimals == targetDecimals
    ? amount
    : amount * (10 ** targetDecimals) / (10 ** sourceDecimals);
  }
}