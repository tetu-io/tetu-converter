import {MocksHelper} from "./MocksHelper";
import {BigNumber} from "ethers";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
    MockERC20, PriceOracleMock, TetuLiquidatorMock__factory,
} from "../../../typechain";
import {CoreContracts} from "../types/CoreContracts";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {TetuConverterApp} from "./TetuConverterApp";
import {CoreContractsHelper} from "./CoreContractsHelper";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {HARDHAT_NETWORK_ID} from "../../../scripts/utils/HardhatUtils";

export interface IPoolInfo {
    /** The length of array should be equal to the count of underlying */
    borrowRateInTokens: (number|BigNumber)[],
    /** The length of array should be equal to the count of underlying */
    availableLiquidityInTokens: number[]
}

export interface IBorrowInputParamsBasic {
    /* == liquidation threshold for collateral asset */
    collateralFactor: number;
    priceSourceUSD: number;
    priceTargetUSD: number;
    sourceDecimals?: number;
    targetDecimals?: number;
}

export interface IBorrowInputParams extends IBorrowInputParamsBasic {
    availablePools: IPoolInfo[],
}

export interface IPoolInstanceInfo {
    pool: string;
    platformAdapter: string;
    converter: string;
    asset2cTokens: Map<string, string>;
}

export interface IMockPoolParams {
    pool: string;
    converters: string[];
    assets: string[];
    cTokens: string[];
    assetPrices: BigNumber[];
    assetLiquidityInPool: BigNumber[];
}

export interface IPrepareContractsSetupParams {
    entryData?: string;
    setupTetuLiquidatorToSwapBorrowToCollateral?: boolean;
    /**
     * Optional price impact for Swap Manager.
     * It should be in the range [0... TetuLiquidatorMock.PRICE_IMPACT_NUMERATOR]
     * === [0...100_000]
     */
    priceImpact?: number;

    /**
     * Don't register pool adaptera in prepareContracts
     * Leave the registration for TetuConverter.borrow()
     */
    skipPreregistrationOfPoolAdapters?: boolean;
}

export interface IInitAppPoolsWithTwoAssetsResults {
    sourceToken: MockERC20,
    targetToken: MockERC20,
    poolsInfo: IPoolInstanceInfo[],
}

export class BorrowManagerHelper {
    static async initAppPoolsWithTwoAssets(
        core: CoreContracts,
        signer: SignerWithAddress,
        tt: IBorrowInputParams,
        converterFabric?: () => Promise<string>,
        tetuAppSetupParams?: IPrepareContractsSetupParams
    ) : Promise<IInitAppPoolsWithTwoAssetsResults>{
        const sourceDecimals = tt.sourceDecimals || 18;
        const targetDecimals = tt.targetDecimals || 6;
        const assetDecimals = [sourceDecimals, targetDecimals];
        const assets = await MocksHelper.createTokens(assetDecimals);
        const cTokenDecimals = [sourceDecimals, targetDecimals];
        const collateralFactors = [tt.collateralFactor, 0.6];
        const pricesNum = [tt.priceSourceUSD, tt.priceTargetUSD];
        const prices = pricesNum.map((x,) => BigNumber.from(10)
          .pow(18 - 2)
          .mul(x * 100));

        if (tetuAppSetupParams?.setupTetuLiquidatorToSwapBorrowToCollateral) {
            // we assume here, that mock tetu liquidator is used
            const tetuLiquidator = TetuLiquidatorMock__factory.connect(await core.controller.tetuLiquidator(), signer);
            await tetuLiquidator.changePrices(
              [assets[0].address, assets[1].address],
              [prices[0], prices[1]]
            );
            if (tetuAppSetupParams.priceImpact) {
                await tetuLiquidator.setPriceImpact(tetuAppSetupParams.priceImpact);
            }
        }

        const pools: IPoolInstanceInfo[] = [];

        for (const poolInfo of tt.availablePools) {
            const cTokens = await MocksHelper.createCTokensMocks(
                signer,
                assets.map(x => x.address),
                cTokenDecimals,
            );
            const pool = await MocksHelper.createPoolStub(signer);

            const r = await MocksHelper.addMockPool(signer,
                core.controller,
                pool,
                poolInfo,
                collateralFactors,
                assets,
                cTokens,
                prices,
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
                asset2cTokens: mapCTokens
            });
        }

        const sourceToken = assets[0];
        const targetToken = assets[1];

        return {sourceToken, targetToken, poolsInfo: pools};
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

    static async initAppWithMockPools(
      signer: SignerWithAddress,
      poolParams: IMockPoolParams[]
    ) : Promise<{
        core: CoreContracts,
        pools: IPoolInstanceInfo[],
    }>{
        // initialize app
        const core = await CoreContracts.build(await TetuConverterApp.createController(signer, {networkId: HARDHAT_NETWORK_ID}));

        // create all platform adapters
        // and register all possible asset-pairs for each platform adapter in the borrow manager
        // we assume here, that all assets, converters and cToken are proper created and initialized
        const pools: IPoolInstanceInfo[] = [];
        for (const pp of poolParams) {
            const priceOracle = (await DeployUtils.deployContract(signer,
              "PriceOracleMock",
              pp.assets,
              pp.assetPrices
            )) as PriceOracleMock;

            const platformAdapter = await MocksHelper.createPlatformAdapterMock(
              signer,
              pp.pool,
              core.controller.address,
              priceOracle.address,
              pp.converters,
              pp.assets,
              pp.cTokens,
              pp.assetLiquidityInPool,
            );

            await MocksHelper.registerAllAssetPairs(
              platformAdapter.address,
              core.bm,
              pp.assets
            );

            for (const converter of pp.converters) {
                const asset2cTokens = new Map<string, string>();
                for (let i = 0; i < pp.assets.length; ++i) {
                    asset2cTokens.set(pp.assets[i], pp.cTokens[i]);
                }
                pools.push({
                    pool: pp.pool,
                    converter,
                    platformAdapter: platformAdapter.address,
                    asset2cTokens
                })
            }
        }

        return {core, pools};
    }
}