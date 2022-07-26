import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../interfaces/IPoolAdapter.sol";
import "../../core/DebtMonitor.sol";
import "../../integrations/aave/IAavePool.sol";

/// @notice Implementation of IPoolAdapter for AAVE-protocol, see https://docs.aave.com/hub/
/// @dev Instances of this contract are created using proxy-minimal pattern, so no constructor
contract AavePoolAdapter is IPoolAdapter {
  using SafeERC20 for IERC20;

  /// @notice 1 - stable, 2 - variable
  uint constant public RATE_MODE = 2;

  address public override collateralToken;
  address public override pool;
  address public override user;

  IController public controller;

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
    pool = pool_;
    user = user_;
    collateralToken = collateralUnderline_;
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
  function borrow(
    uint collateralAmount_,
    address borrowedToken_,
    uint borrowedAmount_,
    address receiver_
  ) external override {
    _onlyTC();
    IAavePool aavePool = IAavePool(pool);

    //a-tokens
    DataTypes.ReserveData memory d = aavePool.getReserveData(borrowedToken_);
    uint aTokensBalance = IERC20(d.aTokenAddress).balanceOf(address(this));

    // check received amount
    require(collateralAmount_ == IERC20(collateralToken).balanceOf(address(this)) - collateralBalance[collateralToken]
      , "APA:Wrong collateral balance");

    // Supplies an `amount` of underlying asset into the reserve, receiving in return overlying aTokens.
    // E.g. User supplies 100 USDC and gets in return 100 aUSDC
    IERC20(collateralToken).approve(pool, collateralAmount_);
    aavePool.supply(
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
    aavePool.borrow(
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
    IAavePool aavePool = IAavePool(pool);

    (uint256 totalCollateralBase,
    uint256 totalDebtBase,
    uint256 availableBorrowsBase,
    uint256 currentLiquidationThreshold,
    uint256 ltv,
    ) = aavePool.getUserAccountData(address(this));

    //TODO
  }


  ///////////////////////////////////////////////////////
  ///                 Repay logic
  ///////////////////////////////////////////////////////

  /// @notice Repay borrowed amount, return collateral to the user
  function repay(
    address borrowedToken_,
    uint borrowedAmount_,
    address receiver_
  ) external override {
    //TODO
    // ensure that we have received enough money on our balance just before repay was called

    // transfer borrow amount back to the pool

    // claim collateral and send it back to receiver

    // update borrow position status in DebtMonitor
  }

  ///////////////////////////////////////////////////////
  ///         View current status
  ///////////////////////////////////////////////////////

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
}