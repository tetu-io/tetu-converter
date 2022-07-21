import {MocksHelper} from "./MocksHelper";
import {CoreContractsHelper} from "./CoreContractsHelper";
import {BigNumber} from "ethers";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BorrowManager, IController, LendingPlatformMock, MockERC20, PoolAdapterMock} from "../../typechain";

export interface IPoolInfo {
    /** The length of array should be equal to the count of underlines */
    borrowRateInTokens: number[],
    /** The length of array should be equal to the count of underlines */
    availableLiquidityInTokens: number[]
}

export interface IBmInputParams {
    availablePools: IPoolInfo[],
    targetCollateralFactor: number;
    priceSourceUSD: number;
    priceTargetUSD: number;
    sourceAmount: number;
    healthFactor: number;
    sourceDecimals?: number;
    targetDecimals?: number;
}

export class BorrowManagerHelper {
    static async createBmTwoUnderlines(
        signer: SignerWithAddress,
        tt: IBmInputParams,
    ) : Promise<{
        bm: BorrowManager,
        sourceToken: MockERC20,
        targetToken: MockERC20,
        pools: string[],
        platformAdapters: LendingPlatformMock[],
        templatePoolAdapters: PoolAdapterMock[],
        controller: IController
    }>{
        const sourceDecimals = tt.sourceDecimals || 18;
        const targetDecimals = tt.targetDecimals || 6;

        const underlineDecimals = [sourceDecimals, targetDecimals];
        const cTokenDecimals = [sourceDecimals, targetDecimals];
        const collateralFactors = [0.6, tt.targetCollateralFactor];
        const pricesUSD = [tt.priceSourceUSD, tt.priceTargetUSD];

        const underlines = await MocksHelper.createTokens(underlineDecimals);

        const controller = await CoreContractsHelper.createControllerWithPrices(
            signer,
            underlines,
            pricesUSD.map(x => BigNumber.from(10).pow(16).mul(x * 100))
        );
        const bm = await CoreContractsHelper.createBorrowManager(signer, controller);
        const pools: string[] = [];
        const platformAdapters: LendingPlatformMock[] = [];
        const templatePoolAdapters: PoolAdapterMock[] = [];

        for (const poolInfo of tt.availablePools) {
            const cTokens = await MocksHelper.createCTokensMocks(
                signer,
                cTokenDecimals,
                underlines.map(x => x.address)
            );
            const pool = await MocksHelper.createPoolMock(signer, cTokens);
            const r = await CoreContractsHelper.addPool(signer,
                bm,
                pool,
                poolInfo,
                collateralFactors,
                underlines
            );
            pools.push(pool.address);
            platformAdapters.push(r.platformAdapter);
            templatePoolAdapters.push(r.templatePoolAdapter);
        }

        const sourceToken = underlines[0];
        const targetToken = underlines[1];

        return {bm, sourceToken, targetToken, pools, platformAdapters, templatePoolAdapters, controller};
    }

    static getBmInputParamsThreePools(bestBorrowRate: number = 27) : IBmInputParams {
        return {
            targetCollateralFactor: 0.8,
            priceSourceUSD: 0.1,
            priceTargetUSD: 4,
            sourceDecimals: 24,
            targetDecimals: 12,
            sourceAmount: 100_000,
            healthFactor: 4,
            availablePools: [
                {   // source, target
                    borrowRateInTokens: [0, bestBorrowRate],
                    availableLiquidityInTokens: [0, 100] //not enough money
                },
                {   // source, target
                    borrowRateInTokens: [0, bestBorrowRate], //best rate
                    availableLiquidityInTokens: [0, 2000] //enough cash
                },
                {   // source, target   -   pool 2 is the best
                    borrowRateInTokens: [0, bestBorrowRate+1], //the rate is worse
                    availableLiquidityInTokens: [0, 2000000000] //a lot of cash
                },
            ]
        };
    }

    static getBmInputParamsSinglePool(bestBorrowRate: number = 27) : IBmInputParams {
        return {
            targetCollateralFactor: 0.8,
            priceSourceUSD: 0.1,
            priceTargetUSD: 4,
            sourceDecimals: 24,
            targetDecimals: 12,
            sourceAmount: 100_000,
            healthFactor: 4,
            availablePools: [
                {   // source, target
                    borrowRateInTokens: [0, bestBorrowRate],
                    availableLiquidityInTokens: [0, 200_000]
                }
            ]
        };
    }
}