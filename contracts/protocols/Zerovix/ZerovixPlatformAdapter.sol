// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "./ZerovixAprLib.sol";
import "../../openzeppelin/SafeERC20.sol";
import "../../openzeppelin/IERC20.sol";
import "../../core/AppErrors.sol";
import "../../core/AppUtils.sol";
import "../../interfaces/IPlatformAdapter.sol";
import "../../interfaces/IPoolAdapterInitializerWithAP.sol";
import "../../interfaces/IController.sol";
import "../../interfaces/ITokenAddressProvider.sol";
import "../../integrations/zerovix/I0vixComptroller.sol";

/// @notice Adapter to read current pools info from 0vix, see https://docs.0vix.com/
contract ZerovixPlatformAdapter is IPlatformAdapter, ITokenAddressProvider {
    using SafeERC20 for IERC20;
    using AppUtils for uint;

    ///////////////////////////////////////////////////////
    ///   Variables
    ///////////////////////////////////////////////////////
    IController immutable public controller;
    I0vixComptroller immutable public comptroller;
    /// @notice Template of pool adapter
    address immutable public converter;
    /// @dev Same as controller.borrowManager(); we cache it for gas optimization
    address immutable public borrowManager;

    /// @notice All enabled pairs underlying : cTokens. All assets usable for collateral/to borrow.
    /// @dev There is no underlying for WMATIC, we store iMATIC:WMATIC
    mapping(address => address) public activeAssets;

    /// @notice True if the platform is frozen and new borrowing is not possible (at this moment)
    bool public override frozen;

    ///////////////////////////////////////////////////////
    ///               Events
    ///////////////////////////////////////////////////////
    event OnPoolAdapterInitialized(
        address converter,
        address poolAdapter,
        address user,
        address collateralAsset,
        address borrowAsset
    );
    event OnRegisterCTokens(address[] cTokens);

    ///////////////////////////////////////////////////////
    ///       Constructor and initialization
    ///////////////////////////////////////////////////////
    constructor (
        address controller_,
        address borrowManager_,
        address comptroller_,
        address templatePoolAdapter_,
        address[] memory activeCTokens_
    ) {
        require(
            comptroller_ != address(0)
            && borrowManager_ != address(0)
            && templatePoolAdapter_ != address(0)
            && controller_ != address(0),
            AppErrors.ZERO_ADDRESS
        );

        comptroller = I0vixComptroller(comptroller_);
        controller = IController(controller_);
        converter = templatePoolAdapter_;
        borrowManager = borrowManager_;

        _registerCTokens(activeCTokens_);
    }

    /// @notice Initialize {poolAdapter_} created from {converter_} using minimal proxy pattern
    function initializePoolAdapter(
        address converter_,
        address poolAdapter_,
        address user_,
        address collateralAsset_,
        address borrowAsset_
    ) external override {
        require(msg.sender == borrowManager, AppErrors.BORROW_MANAGER_ONLY);
        require(converter == converter_, AppErrors.CONVERTER_NOT_FOUND);

        // HF-pool-adapters support IPoolAdapterInitializer
        IPoolAdapterInitializerWithAP(poolAdapter_).initialize(
            address(controller),
            address(this),
            address(comptroller),
            user_,
            collateralAsset_,
            borrowAsset_,
            converter_
        );
        emit OnPoolAdapterInitialized(converter_, poolAdapter_, user_, collateralAsset_, borrowAsset_);
    }

    /// @notice Set platform to frozen/unfrozen state. In frozen state any new borrowing is forbidden.
    function setFrozen(bool frozen_) external {
        require(msg.sender == controller.governance(), AppErrors.GOVERNANCE_ONLY);
        frozen = frozen_;
    }

    /// @notice Register new CTokens supported by the market
    /// @dev It's possible to add CTokens only because, we can add unregister function if necessary
    function registerCTokens(address[] memory cTokens_) external {
        _onlyGovernance();
        _registerCTokens(cTokens_);
        emit OnRegisterCTokens(cTokens_);
    }

    function _registerCTokens(address[] memory cTokens_) internal {
        uint lenCTokens = cTokens_.length;
        for (uint i = 0; i < lenCTokens; i = i.uncheckedInc()) {
            // Special case: there is no underlying for WMATIC, so we store hMATIC:WMATIC
            activeAssets[ZerovixAprLib.getUnderlying(cTokens_[i])] = cTokens_[i];
        }
    }

    ///////////////////////////////////////////////////////
    ///                    Access
    ///////////////////////////////////////////////////////

    /// @notice Ensure that the caller is governance
    function _onlyGovernance() internal view {
        require(controller.governance() == msg.sender, AppErrors.GOVERNANCE_ONLY);
    }

    ///////////////////////////////////////////////////////
    ///                     View
    ///////////////////////////////////////////////////////

    function converters() external view override returns (address[] memory) {
        address[] memory dest = new address[](1);
        dest[0] = converter;
        return dest;
    }

    function getCTokenByUnderlying(address token1_, address token2_)
    external view override
    returns (address cToken1, address cToken2) {
        return (activeAssets[token1_], activeAssets[token2_]);
    }

    ///////////////////////////////////////////////////////
    ///       Get conversion plan
    ///////////////////////////////////////////////////////

    function getConversionPlan (
        address collateralAsset_,
        uint collateralAmount_,
        address borrowAsset_,
        uint16 healthFactor2_,
        uint countBlocks_
    ) external override view returns (
        AppDataTypes.ConversionPlan memory plan
    ) {
        require(collateralAsset_ != address(0) && borrowAsset_ != address(0), AppErrors.ZERO_ADDRESS);
        require(collateralAmount_ != 0 && countBlocks_ != 0, AppErrors.INCORRECT_VALUE);
        require(healthFactor2_ >= controller.minHealthFactor2(), AppErrors.WRONG_HEALTH_FACTOR);

        if (! frozen) {
            address cTokenCollateral = activeAssets[collateralAsset_];
            if (cTokenCollateral != address(0)) {

                address cTokenBorrow = activeAssets[borrowAsset_];
                if (cTokenBorrow != address(0)) {
                    (plan.ltv18, plan.liquidationThreshold18) = getMarketsInfo(cTokenCollateral, cTokenBorrow);
                    if (plan.ltv18 != 0 && plan.liquidationThreshold18 != 0) {
                        plan.converter = converter;

                        plan.maxAmountToBorrow = IOToken(cTokenBorrow).getCash();
                        uint borrowCap = comptroller.borrowCaps(cTokenBorrow);
                        if (borrowCap != 0) {
                            uint totalBorrows = IOToken(cTokenBorrow).totalBorrows();
                            if (totalBorrows > borrowCap) {
                                plan.maxAmountToBorrow = 0;
                            } else {
                                if (totalBorrows + plan.maxAmountToBorrow > borrowCap) {
                                    plan.maxAmountToBorrow = borrowCap - totalBorrows;
                                }
                            }
                        }

                        // it seems that supply is not limited in HundredFinance protocol
                        plan.maxAmountToSupply = type(uint).max; // unlimited

                        ZerovixAprLib.PricesAndDecimals memory vars;
                        vars.collateral10PowDecimals = 10**IERC20Metadata(collateralAsset_).decimals();
                        vars.borrow10PowDecimals = 10**IERC20Metadata(borrowAsset_).decimals();
                        vars.priceOracle = IPriceOracle(comptroller.oracle());
                        vars.priceCollateral36 = ZerovixAprLib.getPrice(vars.priceOracle, cTokenCollateral) * vars.collateral10PowDecimals;
                        vars.priceBorrow36 = ZerovixAprLib.getPrice(vars.priceOracle, cTokenBorrow) * vars.borrow10PowDecimals;

                        // calculate amount that can be borrowed
                        // split calculation on several parts to avoid stack too deep
                        plan.amountToBorrow =
                        100 * collateralAmount_ / uint(healthFactor2_)
                        * (vars.priceCollateral36 * plan.liquidationThreshold18 / vars.priceBorrow36)
                        / 1e18
                        * vars.borrow10PowDecimals
                        / vars.collateral10PowDecimals;

                        if (plan.amountToBorrow > plan.maxAmountToBorrow) {
                            plan.amountToBorrow = plan.maxAmountToBorrow;
                        }

                        // calculate current borrow rate and predicted APR after borrowing required amount
                        (plan.borrowCost36,
                        plan.supplyIncomeInBorrowAsset36
                        ) = ZerovixAprLib.getRawCostAndIncomes(
                            ZerovixAprLib.getCore(cTokenCollateral, cTokenBorrow),
                            collateralAmount_,
                            countBlocks_,
                            plan.amountToBorrow,
                            vars
                        );

                        plan.amountCollateralInBorrowAsset36 =
                        collateralAmount_ * (10**36 * vars.priceCollateral36 / vars.priceBorrow36)
                        / vars.collateral10PowDecimals;
                    }
                }
            }
        }

        return plan;
    }

    ///////////////////////////////////////////////////////
    ///  Calculate borrow rate after borrowing in advance
    ///////////////////////////////////////////////////////

    /// @notice Estimate value of variable borrow rate after borrowing {amountToBorrow_}
    function getBorrowRateAfterBorrow(address borrowAsset_, uint amountToBorrow_) external view override returns (uint) {
        address borrowCToken = activeAssets[borrowAsset_];
        return ZerovixAprLib.getEstimatedBorrowRate(
            IInterestRateModel(IOToken(borrowCToken).interestRateModel()),
            IOToken(borrowCToken),
            amountToBorrow_
        );
    }

    ///////////////////////////////////////////////////////
    ///                    Utils
    ///////////////////////////////////////////////////////

    /// @notice Check if the c-tokens are active and return LTV and liquidityThreshold values for the borrow
    function getMarketsInfo(address cTokenCollateral_, address cTokenBorrow_) public view returns (
        uint ltv18,
        uint liquidityThreshold18
    ) {
        I0vixComptroller comptrollerLocal = comptroller;
        if (
            !comptroller._borrowGuardianPaused(cTokenBorrow_) // borrowing is not paused
        && !comptroller._mintGuardianPaused(cTokenCollateral_) // minting is not paused
        ) {
            I0vixComptroller.Market memory market = comptrollerLocal.markets(cTokenBorrow_);
//            (bool isListed,, uint256 collateralFactorMantissa) = comptrollerLocal.markets(cTokenBorrow_);
            if (market.isListed) {
                ltv18 = market.collateralFactorMantissa;
                market = comptrollerLocal.markets(cTokenCollateral_);
//                (isListed, collateralFactorMantissa,) = comptrollerLocal.markets(cTokenCollateral_);
                if (market.isListed) {
                    liquidityThreshold18 = market.collateralFactorMantissa;
                } else {
                    ltv18 = 0; // not efficient, but it's error case
                }
            }
        }

        return (ltv18, liquidityThreshold18);
    }
}