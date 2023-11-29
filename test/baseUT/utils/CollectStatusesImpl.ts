import {BorrowManager, IERC20Metadata__factory, IPoolAdapter__factory} from "../../../typechain";
import {IPoolAdapterStatus} from "../types/BorrowRepayDataTypes";
import {formatUnits} from "ethers/lib/utils";

export interface IGetStatus {
  collateralAmount: number;
  amountToPay: number;
  healthFactor18: number;
  collateralAmountLiquidated: number;
}
export interface IGetStatusesResults {
  statuses: Map<number, IGetStatus>;
}

export class CollectStatusesImpl {
  static async getStatuses(
    borrowManager: BorrowManager,
    poolAdaptersIndices: Map<string, number>,
  ) : Promise<IGetStatusesResults> {
    // enumerate all registered pool adapters
    const statuses = new Map<number, IGetStatus>();
    const countPoolAdapters = (await borrowManager.listPoolAdaptersLength()).toNumber();
    for (let i = 0; i < countPoolAdapters; ++i) {
      const poolAdapterAddress = await borrowManager.listPoolAdapters(i);
      let index = poolAdaptersIndices.get(poolAdapterAddress);
      if (index === undefined) {
        // new pool adapter is detected
        index = poolAdaptersIndices.size;
        poolAdaptersIndices.set(poolAdapterAddress, index);
      }

      const poolAdapter = await IPoolAdapter__factory.connect(poolAdapterAddress, borrowManager.signer);
      const status: IPoolAdapterStatus = await poolAdapter.getStatus();
      const config = await poolAdapter.getConfig();
      statuses.set(index, {
        amountToPay: +formatUnits(status.amountToPay, await IERC20Metadata__factory.connect(config.borrowAsset, borrowManager.signer).decimals()),
        collateralAmount: +formatUnits(status.collateralAmount, await IERC20Metadata__factory.connect(config.collateralAsset, borrowManager.signer).decimals()),
        collateralAmountLiquidated: +formatUnits(status.collateralAmountLiquidated, await IERC20Metadata__factory.connect(config.collateralAsset, borrowManager.signer).decimals()),
        healthFactor18: +formatUnits(status.healthFactor18, 18)
      });
    }

    return  {statuses};
  }
}