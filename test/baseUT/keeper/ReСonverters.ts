import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {IBorrower__factory, IPoolAdapter__factory} from "../../../typechain";

export interface IReConverter {
    do: (poolAdapter: string, signer: SignerWithAddress) => Promise<void>;
}

/** Do reconversion using pool adapter */
export class ReConverterUsingPA implements  IReConverter {
    async do(poolAdapterAddress: string, signer: SignerWithAddress): Promise<void> {
        const poolAdapter = IPoolAdapter__factory.connect(poolAdapterAddress, signer);
        const poolAdapterConfig = await poolAdapter.getConfig();
        const user = poolAdapterConfig.user;

        const userAsSigner = IBorrower__factory.connect(user, signer);
        await userAsSigner.requireReconversion(poolAdapterAddress);
    }
}

/** Ensure that reconversion is used for the particular pool adapter */
export class ReConverterMock implements IReConverter {
    public poolAdapters: string[] = [];
    async do(poolAdapterAddress: string, signer: SignerWithAddress): Promise<void> {
        this.poolAdapters.push(poolAdapterAddress);
    }
    ensureExpectedPA(poolAdapterAddress: string) : boolean {
        return this.poolAdapters.length === 1 && this.poolAdapters[0] === poolAdapterAddress;
    }
}
