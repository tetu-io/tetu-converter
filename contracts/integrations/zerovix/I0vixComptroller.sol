//SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface I0vixComptroller {
    /// @notice Indicator that this is a Comptroller contract (for inspection)
    function isComptroller() external view returns(bool);

    /*** Assets You Are In ***/

    function enterMarkets(address[] calldata oTokens) external returns (uint[] memory);
    function exitMarket(address oToken) external returns (uint);

    /*** Policy Hooks ***/

    function mintAllowed(address oToken, address minter, uint mintAmount) external returns (uint);
    function mintVerify(address oToken, address minter, uint mintAmount, uint mintTokens) external;

    function redeemAllowed(address oToken, address redeemer, uint redeemTokens) external returns (uint);
    function redeemVerify(address oToken, address redeemer, uint redeemAmount, uint redeemTokens) external;

    function borrowAllowed(address oToken, address borrower, uint borrowAmount) external returns (uint);
    function borrowVerify(address oToken, address borrower, uint borrowAmount) external;

    function repayBorrowAllowed(
        address oToken,
        address payer,
        address borrower,
        uint repayAmount) external returns (uint);

    function liquidateBorrowAllowed(
        address oTokenBorrowed,
        address oTokenCollateral,
        address liquidator,
        address borrower,
        uint repayAmount) external returns (uint);

    function seizeAllowed(
        address oTokenCollateral,
        address oTokenBorrowed,
        address liquidator,
        address borrower,
        uint seizeTokens) external returns (uint);

    function seizeVerify(
        address oTokenCollateral,
        address oTokenBorrowed,
        address liquidator,
        address borrower,
        uint seizeTokens) external;

    function transferAllowed(address oToken, address src, address dst, uint transferTokens) external returns (uint);
    function transferVerify(address oToken, address src, address dst, uint transferTokens) external;

    /*** Liquidity/Liquidation Calculations ***/

    function liquidateCalculateSeizeTokens(
        address oTokenBorrowed,
        address oTokenCollateral,
        uint repayAmount) external view returns (uint, uint);



    function isMarket(address market) external view returns(bool);
    function getBoostManager() external view returns(address);
    function getAllMarkets() external view returns(address[] memory);
    function oracle() external view returns(address);

    function updateAndDistributeSupplierRewardsForToken(
        address oToken,
        address account
    ) external;

    function updateAndDistributeBorrowerRewardsForToken(
        address oToken,
        address borrower
    ) external;

    function _setRewardSpeeds(
        address[] memory oTokens,
        uint256[] memory supplySpeeds,
        uint256[] memory borrowSpeeds
    ) external;

    /// ComptrollerV1Storage
    function _mintGuardianPaused(address) external view returns (bool);
    function _borrowGuardianPaused(address) external view returns (bool);

    /// ComptrollerV2Storage
    struct Market {
        /// @notice Whether or not this market is listed
        bool isListed;

        bool autoCollaterize;
        /**
         * @notice Multiplier representing the most one can borrow against their collateral in this market.
         *  For instance, 0.9 to allow borrowing 90% of collateral value.
         *  Must be between 0 and 1, and stored as a mantissa.
         */
        uint collateralFactorMantissa;
    }
    function markets(address)
    external
    view
    returns (
        Market memory
    );

    /// ComptrollerV4Storage
    /// @notice The borrowCapGuardian can set borrowCaps to any number for any market. Lowering the borrow cap could disable borrowing on the given market.
    function borrowCapGuardian() external view returns (address);
    /// @notice Borrow caps enforced by borrowAllowed for each cToken address. Defaults to zero which corresponds to unlimited borrowing.
    /// @dev https://github.com/compound-finance/compound-protocol/blob/master/contracts/ComptrollerStorage.sol
    function borrowCaps(address cToken) external view returns (uint256);


    /// Comptroller
    /**
   * @notice Determine the current account liquidity wrt collateral requirements
   *         Return (possible error code (semi-opaque),
   *         account liquidity in excess of collateral requirements,
   *         account shortfall below collateral requirements)
   */
    function getAccountLiquidity(address account)
    external view returns (uint256 error, uint256 liquidity, uint256 shortfall);
}