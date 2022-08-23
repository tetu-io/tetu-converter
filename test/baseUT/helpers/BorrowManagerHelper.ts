import {MocksHelper} from "./MocksHelper";
import {CoreContractsHelper} from "./CoreContractsHelper";
import {BigNumber} from "ethers";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
    BorrowManager,
    Controller,
    MockERC20,
} from "../../../typechain";

export interface IPoolInfo {
    /** The length of array should be equal to the count of underlyings */
    borrowRateInTokens: (number|BigNumber)[],
    /** The length of array should be equal to the count of underlyings */
    availableLiquidityInTokens: number[]
}

export interface IBmInputParams {
    availablePools: IPoolInfo[],
    /** == liquidation threshold for collateral asset **/
    collateralFactor: number;
    priceSourceUSD: number;
    priceTargetUSD: number;
    sourceDecimals?: number;
    targetDecimals?: number;
}

export interface PoolInstanceInfo {
    pool: string;
    platformAdapter: string;
    converter: string;
    underlyingTocTokens: Map<string, string>;
}

export class BorrowManagerHelper {
    static async createBmTwoUnderlyings(
        signer: SignerWithAddress,
        tt: IBmInputParams,
        converterFabric?: () => Promise<string>
    ) : Promise<{
        bm: BorrowManager,
        sourceToken: MockERC20,
        targetToken: MockERC20,
        pools: PoolInstanceInfo[],
        controller: Controller
    }>{
        const sourceDecimals = tt.sourceDecimals || 18;
        const targetDecimals = tt.targetDecimals || 6;

        const underlyingDecimals = [sourceDecimals, targetDecimals];
        const cTokenDecimals = [sourceDecimals, targetDecimals];
        const collateralFactors = [tt.collateralFactor, 0.6];
        const pricesUSD = [tt.priceSourceUSD, tt.priceTargetUSD];

        const underlyings = await MocksHelper.createTokens(underlyingDecimals);

        const controller = await CoreContractsHelper.createController(signer);
        const bm = await CoreContractsHelper.createBorrowManager(signer, controller);
        const dm = await MocksHelper.createDebtsMonitorStub(signer, false);
        await controller.setBorrowManager(bm.address);
        await controller.setDebtMonitor(dm.address);

        const pools: PoolInstanceInfo[] = [];

        for (const poolInfo of tt.availablePools) {
            const cTokens = await MocksHelper.createCTokensMocks(
                signer,
                cTokenDecimals,
                underlyings.map(x => x.address)
            );
            const pool = await MocksHelper.createPoolStub(signer);

            const r = await CoreContractsHelper.addPool(signer,
                controller,
                pool,
                poolInfo,
                collateralFactors,
                underlyings,
                cTokens,
                pricesUSD.map((x, index) => BigNumber.from(10)
                    .pow(18 - 2)
                    .mul(x * 100)),
              converterFabric
                    ? await converterFabric()
                    : undefined
            );
            const mapCTokens = new Map<string, string>();
            for (let i = 0; i < underlyings.length; ++i) {
                mapCTokens.set(underlyings[i].address, cTokens[i].address);
            }
            pools.push({
                pool: pool.address,
                platformAdapter: r.platformAdapter.address,
                converter: r.templatePoolAdapter,
                underlyingTocTokens: mapCTokens
            });
        }

        const sourceToken = underlyings[0];
        const targetToken = underlyings[1];

        return {bm, sourceToken, targetToken, pools, controller};
    }

    static getBmInputParamsThreePools(bestBorrowRate: number = 27) : IBmInputParams {
        return {
            collateralFactor: 0.8,
            priceSourceUSD: 0.1,
            priceTargetUSD: 4,
            sourceDecimals: 24,
            targetDecimals: 12,
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

    static getBmInputParamsSinglePool(
        bestBorrowRate: number = 27,
        priceSourceUSD: number = 0.1,
        priceTargetUSD: number = 4,
    ) : IBmInputParams {
        return {
            collateralFactor: 0.8,
            priceSourceUSD: priceSourceUSD || 0.1,
            priceTargetUSD: priceTargetUSD || 4,
            sourceDecimals: 24,
            targetDecimals: 12,
            availablePools: [
                {   // source, target
                    borrowRateInTokens: [0, bestBorrowRate],
                    availableLiquidityInTokens: [0, 200_000]
                }
            ]
        };
    }
}