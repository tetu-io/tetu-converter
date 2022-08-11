import {IBorrower__factory, IDebtMonitor, IPoolAdapter__factory, ITetuConverter} from "../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

/**
 * Implementation of UC2.4
 * */
export class Keeper {
    dm: IDebtMonitor;
    healthFactor2: number;
    periodBlocks: number;
    constructor(
        dm: IDebtMonitor,
        healthFactor2: number,
        periodBlocks: number
    ) {
        this.dm = dm;
        this.healthFactor2 = healthFactor2;
        this.periodBlocks = periodBlocks;
    }

    /** Find all positions that should be reconverted and reconvert them */
    async makeKeeperJob(signer: SignerWithAddress) {
        const maxCountToCheck = 3;
        const maxCountToReturn = 2;
        let startIndex0 = 0;
        const poolAdaptersToReconvert: string[] = [];

        // let's find all pool adapters that should be reconverted
        do {
            const ret = await this.dm.checkForReconversion(
                startIndex0
                , maxCountToCheck
                , maxCountToReturn
                , this.healthFactor2
                , this.periodBlocks
            );
            for (let i = 0; i < ret.countFoundItems.toNumber(); ++i) {
                poolAdaptersToReconvert.push(ret.poolAdapters[i]);
            }
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