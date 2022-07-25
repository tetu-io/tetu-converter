import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../interfaces/IPoolAdapter.sol";

/// @notice Implementation of IPoolAdapter for AAVE-protocol, see https://docs.aave.com/hub/
/// @dev Instances of this contract are created using proxy-minimal pattern, so no constructor
contract AavePoolAdapter is IPoolAdapter {
  using SafeERC20 for IERC20;

  ///////////////////////////////////////////////////////
  ///                Initialization
  ///////////////////////////////////////////////////////

  function initialize(address pool_, address user_, address collateralUnderline_) override external {
    //TODO
  }

  ///////////////////////////////////////////////////////
  ///                 Borrow logic
  ///////////////////////////////////////////////////////

  /// @notice Supply collateral to the pool and borrow {borrowedAmount_} in {borrowedToken_}
  function borrow(
    uint collateralAmount_,
    address borrowedToken_,
    uint borrowedAmount_,
    address receiverBorrowedAmount_
  ) external override {
    //TODO
  }


  ///////////////////////////////////////////////////////
  ///                 Repay logic
  ///////////////////////////////////////////////////////

  /// @notice Repay borrowed amount, return collateral to the user
  function repay(
    address borrowedToken_,
    uint borrowedAmount_,
    address receiverCollateralAmount_
  ) external override {
    //TODO
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

  ///////////////////////////////////////////////////////
  ///         Trivial view functions
  ///////////////////////////////////////////////////////

  function collateralToken() external view override returns (address) {
    return address(0); //TODO
  }
  function collateralFactor() external view override returns (uint) {
    return 0; //TODO
  }
  function pool() external view override returns (address) {
    return address(0); //TODO
  }
  function user() external view override returns (address) {
    return address(0); //TODO
  }

}