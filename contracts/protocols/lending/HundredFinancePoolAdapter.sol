import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../interfaces/IPoolAdapter.sol";
import "../../core/DebtMonitor.sol";

/// @notice Implementation of IPoolAdapter for HundredFinance-protocol, see https://docs.hundred.finance/
/// @dev Instances of this contract are created using proxy-minimal pattern, so no constructor
contract HundredFinancePoolAdapter is IPoolAdapter {
  using SafeERC20 for IERC20;


  address public override collateralToken;
  address public override user;

  IController public controller;
  address private _pool;

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
    _pool = pool_;
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

    //c-tokens

    // check received amount

    // Supplies an `amount` of underlying asset into the reserve, receiving in return overlying aTokens.
    // E.g. User supplies 100 USDC and gets in return 100 aUSDC

    // ensure that we received a-tokens

    // ensure that we can borrow allowed amount safely

    // make borrow, send borrow money from the pool to the receiver

    // ensure that we have received required borrowed amount, send the amount to the receiver

    // register the borrow in DebtMonitor
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

    // transfer borrow amount back to the pool

    // withdraw the collateral

    // update borrow position status in DebtMonitor
    //TODO IDebtMonitor(controller.debtMonitor()).onRepay(d.aTokenAddress, aTokensAmount, borrowedToken_);

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