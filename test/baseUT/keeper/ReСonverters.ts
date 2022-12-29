import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Borrower__factory, IPoolAdapter__factory} from "../../../typechain";

export interface IReConverter {
  // eslint-disable-next-line no-unused-vars
  do: (poolAdapter: string, signer: SignerWithAddress) => Promise<void>;
}

/** Do reconversion using pool adapter */
export class ReConverterUsingPA implements  IReConverter {
  async do(poolAdapterAddress: string, signer: SignerWithAddress): Promise<void> {
    const poolAdapter = IPoolAdapter__factory.connect(poolAdapterAddress, signer);
    const poolAdapterConfig = await poolAdapter.getConfig();
    const user = poolAdapterConfig.user;

    // const userAsSigner = Borrower__factory.connect(user, signer);
    // TODO: await userAsSigner.requireReconversion(poolAdapterAddress);
  }
}

/** Ensure that reconversion is used for the particular pool adapter */
export class ReConverterMock implements IReConverter {
  public poolAdapters: string[] = [];
  async do(poolAdapterAddress: string, signer: SignerWithAddress): Promise<void> {
    this.poolAdapters.push(poolAdapterAddress);
  }
  ensureExpectedPA(poolAdapterAddress: string) : boolean {
    console.log(`ensureExpectedPA poolAdapterAddress=${poolAdapterAddress} poolAdapters=${this.poolAdapters}`)
    return this.poolAdapters.length === 1 && this.poolAdapters[0] === poolAdapterAddress;
  }
}
