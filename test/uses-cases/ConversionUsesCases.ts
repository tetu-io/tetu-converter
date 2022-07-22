import {CoreContracts} from "./CoreContracts";
import {BigNumber} from "ethers";
import {IERC20__factory, IPoolAdapter__factory, TetuConverter__factory} from "../../typechain";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";

interface IParamsUS11 {
    sourceToken: string,
    sourceAmount: string,
    targetToken: string,
    borrowPeriodInBlocks: BigNumber,
    healthFactorOptional?: number
}

interface IParamsUS12 {
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
     * Borrow max amount of borrow-token using given collateral amount.
     *
     * UC: user
     * TC: TestConverter contract
     * PA: selected PoolAdapter
     * DM: DebtsMonitor
     *
     * 1) UC asks TC for the best conversion strategy
     * 2) TC finds the best conversion strategy and returns: pool, target amount, cost of the money for the given period.
     *    Let’s suppose here that the best strategy is to borrow.
     * 3) UC transfer collateral to TC
     * 4) UC calls TC::borrow()
     * 5) TC gets (pool, UC-address, collateral token) from UC and checks if corresponded PA is already created
     *    If PA does not exist TC creates it; otherwise TC uses exist PA
     * 6) TC re-transfer the collateral to PA
     * 7) PA borrows target amount and transfer it to UC
     * 8) PA registers borrowed amount in DM
     */
    public static async makeBorrowUS11(
        userAddress: string,
        receiverAddress: string,
        core: CoreContracts,
        pp: IParamsUS11
    ) {
        const user = await DeployerUtils.startImpersonate(userAddress);

        // ask TC for the best conversion strategy
        const way = await core.tc.findBestConversionStrategy(
            pp.sourceToken
            , pp.sourceAmount
            , pp.targetToken
            , pp.healthFactorOptional || 0
            , pp.borrowPeriodInBlocks
        );

        // transfer collateral to TC
        await IERC20__factory.connect(pp.sourceToken, user)
            .transfer(core.tc.address, pp.sourceAmount);

        // borrow and receive borrowed-amount to receiver's balance
        const tcAsUser = TetuConverter__factory.connect(core.tc.address, user);
        await tcAsUser.convert(way.outPool
            , pp.sourceToken
            , pp.sourceAmount
            , pp.targetToken
            , way.outMaxTargetAmount
            , receiverAddress
        );
    }

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
        const user = await DeployerUtils.startImpersonate(userAddress);

        // get all opened positions for the given user
        const tcAsUser = TetuConverter__factory.connect(core.tc.address, user);
        const bb = await tcAsUser.findBorrows(pp.collateralToken, pp.borrowedToken);

        for (let i = 0; i < bb.outCountItems; ++i) {
            const poolAdapterAddress = bb.outPoolAdapters[i];
            const amountToPayBT = bb.outAmountsToPay[i];

            const paAsUser = IPoolAdapter__factory.connect(poolAdapterAddress, user);

            // transfer borrowed amount to Pool Adapter
            await IERC20__factory.connect(pp.borrowedToken, user)
                .transfer(poolAdapterAddress, amountToPayBT);

            // repay borrowed amount and receive collateral to receiver's balance
            await paAsUser.repay(pp.borrowedToken, amountToPayBT, receiverAddress);
        }
    }
}