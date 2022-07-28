import {IERC20Extended, IERC20Extended__factory} from "../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

export class TokenWrapper {
    public readonly address: string;
    public readonly token: IERC20Extended;
    public readonly decimals: number;
    constructor (token: IERC20Extended, decimals: number) {
        this.address = token.address;
        this.token = token;
        this.decimals = decimals;
    }

    public static async Build(deployer: SignerWithAddress, address: string) : Promise<TokenWrapper> {
        const token = IERC20Extended__factory.connect(address, deployer);
        const decimals = await token.decimals();
        return new TokenWrapper(token, decimals);
    }
}