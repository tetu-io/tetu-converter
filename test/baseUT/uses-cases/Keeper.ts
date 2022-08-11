import {IBorrower__factory, IDebtMonitor, IPoolAdapter__factory, ITetuConverter} from "../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

/**
 * Implementation of UC2.4
 * */
export class Keeper {
    dm: IDebtMonitor;
    healthFactor2: number;
    periodBlocks: number;
    maxCountToCheck: number;
    maxCountToReturn: number;
    constructor(
        dm: IDebtMonitor,
        healthFactor2: number,
        periodBlocks: number,
        maxCountToCheck: number = 3,
        maxCountToReturn: number = 2
    ) {
        this.dm = dm;
        this.healthFactor2 = healthFactor2;
        this.periodBlocks = periodBlocks;
        this.maxCountToCheck = maxCountToCheck;
        this.maxCountToReturn = maxCountToReturn;
    }

    /** Find all positions that should be reconverted and reconvert them */
    async makeKeeperJob(signer: SignerWithAddress) {

        let startIndex0 = 0;
        const poolAdaptersToReconvert: string[] = [];

        // let's find all pool adapters that should be reconverted
        do {
            const ret = await this.dm.checkForReconversion(
                startIndex0
                , this.maxCountToCheck
                , this.maxCountToReturn
                , this.healthFactor2
                , this.periodBlocks
            );
            for (let i = 0; i < ret.countFoundItems.toNumber(); ++i) {
                poolAdaptersToReconvert.push(ret.poolAdapters[i]);
            }
            startIndex0 = ret.nextIndexToCheck0;
        } while (startIndex0 != 0);

        // let's reconvert all found pool adapters, each in the separate transaction
        for (let i = 0; i < poolAdaptersToReconvert.length; ++i) {
            const poolAdapter = IPoolAdapter__factory.connect(poolAdaptersToReconvert[i], signer);
            const poolAdapterConfig = await poolAdapter.getConfig();
            const user = poolAdapterConfig.user;

            const userAsSigner = IBorrower__factory.connect(user, signer);
            await userAsSigner.requireReconversion(poolAdapter);
        }
    }
}