import {CoreContracts} from "./CoreContracts";
import {BigNumber} from "ethers";
import {MocksHelper} from "../baseUT/MocksHelper";
import {UserBorrowRepayUCs} from "../../typechain";

export interface IParamsUS11 {
    sourceToken: string,
    sourceAmount: BigNumber,
    targetToken: string,
    borrowPeriodInBlocks: BigNumber,
    healthFactorOptional?: BigNumber
}

export interface IParamsUS12 {
    collateralToken: string,
    borrowedToken: string,
}

/**
 * US1. Conversion
 * US1.1 Conversion using borrow-strategy
 * US1.2 Repay by user’s claim
 */
export class ConversionUsesCases {

    /**
     * Completely repay all amounts of the given borrowed token
     *
     * 1) UC asks TC for info about opened positions and provides: collateral token, borrowed token
     * 2) TC returns a list of related (PA. borrowed token, amount to repay)
     * 3) UC asks each PA to close the position for the given borrowed token
     *      3.1) UC transfers amount to repay on balance of PA
     *      3.2) UC calls PA::repay()
     *      3.3) PA repays the borrow, receives collateral
     *           and transfers the collateral to the provided address (i.e. to balance of UC)
     */
    public static async makeRepayUS12(
        userAddress: string,
        receiverAddress: string,
        core: CoreContracts,
        pp: IParamsUS12
    ) {
        const userContract = await MocksHelper.deployUserBorrowRepayUCs(userAddress, core.controller);
        await userContract.makeRepayUS12(pp.collateralToken, pp.borrowedToken, receiverAddress);
    }
}