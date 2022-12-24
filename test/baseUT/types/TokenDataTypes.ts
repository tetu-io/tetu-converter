import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {IERC20Metadata, IERC20Metadata__factory} from "../../../typechain";

export class TokenDataTypes {
  public readonly address: string;
  public readonly token: IERC20Metadata;
  public readonly decimals: number;
  constructor (token: IERC20Metadata, decimals: number) {
    this.address = token.address;
    this.token = token;
    this.decimals = decimals;
  }

  public static async Build(deployer: SignerWithAddress, address: string) : Promise<TokenDataTypes> {
    const token = IERC20Metadata__factory.connect(address, deployer);
    const decimals = await token.decimals();
    return new TokenDataTypes(token, decimals);
  }
}

export interface ITokenWithHolder {
  asset: string;
  holder: string;
}