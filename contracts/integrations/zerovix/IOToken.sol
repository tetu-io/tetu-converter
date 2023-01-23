//SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./I0vixComptroller.sol";
import "./IInterestRateModel.sol";
import "./IEIP20NonStandard.sol";
import "./IEIP20.sol";

interface IOToken is IEIP20 {
    /**
     * @notice Indicator that this is a OToken contract (for inspection)
     */
    function isOToken() external view returns(bool);


    /*** Market Events ***/

    /**
     * @notice Event emitted when interest is accrued
     */
    event AccrueInterest(uint cashPrior, uint interestAccumulated, uint borrowIndex, uint totalBorrows);

    /**
     * @notice Event emitted when tokens are minted
     */
    event Mint(address minter, uint mintAmount, uint mintTokens);

    /**
     * @notice Event emitted when tokens are redeemed
     */
    event Redeem(address redeemer, uint redeemAmount, uint redeemTokens);

    /**
     * @notice Event emitted when underlying is borrowed
     */
    event Borrow(address borrower, uint borrowAmount, uint accountBorrows, uint totalBorrows);

    /**
     * @notice Event emitted when a borrow is repaid
     */
    event RepayBorrow(address payer, address borrower, uint repayAmount, uint accountBorrows, uint totalBorrows);

    /**
     * @notice Event emitted when a borrow is liquidated
     */
    event LiquidateBorrow(address liquidator, address borrower, uint repayAmount, address oTokenCollateral, uint seizeTokens);


    /*** Admin Events ***/

    /**
     * @notice Event emitted when pendingAdmin is changed
     */
    event NewPendingAdmin(address oldPendingAdmin, address newPendingAdmin);

    /**
     * @notice Event emitted when pendingAdmin is accepted, which means admin is updated
     */
    event NewAdmin(address oldAdmin, address newAdmin);

    /**
     * @notice Event emitted when comptroller is changed
     */
    event NewComptroller(I0vixComptroller oldComptroller, I0vixComptroller newComptroller);

    /**
     * @notice Event emitted when interestRateModel is changed
     */
    event NewMarketInterestRateModel(IInterestRateModel oldInterestRateModel, IInterestRateModel newInterestRateModel);

    /**
     * @notice Event emitted when the reserve factor is changed
     */
    event NewReserveFactor(uint oldReserveFactorMantissa, uint newReserveFactorMantissa);

    /**
     * @notice Event emitted when the protocol seize share is changed
     */
    event NewProtocolSeizeShare(uint oldProtocolSeizeShareMantissa, uint newProtocolSeizeShareMantissa);

    /**
     * @notice Event emitted when the reserves are added
     */
    event ReservesAdded(address benefactor, uint addAmount, uint newTotalReserves);

    /**
     * @notice Event emitted when the reserves are reduced
     */
    event ReservesReduced(address admin, uint reduceAmount, uint newTotalReserves);

    function accrualBlockTimestamp() external returns(uint256);

    /*** User Interface ***/
    function balanceOfUnderlying(address owner) external returns (uint);
    function getAccountSnapshot(address account) external view returns (uint, uint, uint, uint);
    function borrowRatePerTimestamp() external view returns (uint);
    function supplyRatePerTimestamp() external view returns (uint);
    function totalBorrowsCurrent() external returns (uint);
    function borrowBalanceCurrent(address account) external returns (uint);
    function borrowBalanceStored(address account) external view returns (uint);
    function exchangeRateCurrent() external returns (uint);
    function exchangeRateStored() external view returns (uint);
    function getCash() external view returns (uint);
    function accrueInterest() external returns (uint);
    function seize(address liquidator, address borrower, uint seizeTokens) external returns (uint);

    function totalBorrows() external view returns(uint);
    function comptroller() external view returns(I0vixComptroller);
    function borrowIndex() external view returns(uint);
    function reserveFactorMantissa() external view returns(uint);


    /*** Admin Functions ***/

    function _setPendingAdmin(address payable newPendingAdmin) external returns (uint);
    function _acceptAdmin() external returns (uint);
    function _setComptroller(I0vixComptroller newComptroller) external returns (uint);
    function _setReserveFactor(uint newReserveFactorMantissa) external returns (uint);
    function _reduceReserves(uint reduceAmount) external returns (uint);
    function _setInterestRateModel(I0vixComptroller newInterestRateModel) external returns (uint);
    function _setProtocolSeizeShare(uint newProtocolSeizeShareMantissa) external returns (uint);

    /// @notice Model which tells what the current interest rate should be
    function interestRateModel() external view returns (address);
    /**
         * @notice Total amount of reserves of the underlying held in this market
     */
    function totalReserves() external view returns (uint256);
    /**
        * @notice Total number of tokens in circulation
     */
}
