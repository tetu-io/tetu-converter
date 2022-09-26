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

export interface IBorrowInputParams {
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
    static async createBmTwoAssets(
        signer: SignerWithAddress,
        tt: IBorrowInputParams,
        converterFabric?: () => Promise<string>
    ) : Promise<{
        borrowManager: BorrowManager,
        sourceToken: MockERC20,
        targetToken: MockERC20,
        pools: PoolInstanceInfo[],
        controller: Controller
    }>{
        const sourceDecimals = tt.sourceDecimals || 18;
        const targetDecimals = tt.targetDecimals || 6;

        const assetDecimals = [sourceDecimals, targetDecimals];
        const cTokenDecimals = [sourceDecimals, targetDecimals];
        const collateralFactors = [tt.collateralFactor, 0.6];
        const pricesUSD = [tt.priceSourceUSD, tt.priceTargetUSD];

        const assets = await MocksHelper.createTokens(assetDecimals);

        const controller = await CoreContractsHelper.createController(signer);
        const borrowManager = await CoreContractsHelper.createBorrowManager(signer, controller);
        const debtMonitor = await MocksHelper.createDebtsMonitorStub(signer, false);
        const tetuConverter = await CoreContractsHelper.createTetuConverter(signer, controller);
        await controller.setBorrowManager(borrowManager.address);
        await controller.setDebtMonitor(debtMonitor.address);
        await controller.setTetuConverter(tetuConverter.address);

        const pools: PoolInstanceInfo[] = [];

        for (const poolInfo of tt.availablePools) {
            const cTokens = await MocksHelper.createCTokensMocks(
                signer,
                cTokenDecimals,
                assets.map(x => x.address)
            );
            const pool = await MocksHelper.createPoolStub(signer);

            const r = await CoreContractsHelper.addPool(signer,
                controller,
                pool,
                poolInfo,
                collateralFactors,
                assets,
                cTokens,
                pricesUSD.map((x, index) => BigNumber.from(10)
                    .pow(18 - 2)
                    .mul(x * 100)),
              converterFabric
                    ? await converterFabric()
                    : undefined
            );
            const mapCTokens = new Map<string, string>();
            for (let i = 0; i < assets.length; ++i) {
                mapCTokens.set(assets[i].address, cTokens[i].address);
            }
            pools.push({
                pool: pool.address,
                platformAdapter: r.platformAdapter.address,
                converter: r.templatePoolAdapter,
                underlyingTocTokens: mapCTokens
            });
        }

        const sourceToken = assets[0];
        const targetToken = assets[1];

        return {borrowManager: borrowManager, sourceToken, targetToken, pools, controller};
    }

    static getBmInputParamsSinglePool(
        bestBorrowRate: number = 27,
        priceSourceUSD: number = 0.1,
        priceTargetUSD: number = 4,
    ) : IBorrowInputParams {
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