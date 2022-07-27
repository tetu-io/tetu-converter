import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Aave3PlatformAdapter} from "../../typechain";
import {DeployUtils} from "../../scripts/utils/DeployUtils";

export class AdaptersHelper {
//region AAVE
    public static async createAave3PlatformAdapter(signer: SignerWithAddress) : Promise<Aave3PlatformAdapter> {
        return (await DeployUtils.deployContract(signer, "Aave3PlatformAdapter")) as Aave3PlatformAdapter;
    }
//endregion AAVE
}