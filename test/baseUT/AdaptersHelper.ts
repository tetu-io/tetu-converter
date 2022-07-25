import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {AavePlatformAdapter} from "../../typechain";
import {DeployUtils} from "../../scripts/utils/DeployUtils";

export class AdaptersHelper {
//region AAVE
    public static async createAavePlatformAdapter(signer: SignerWithAddress) : Promise<AavePlatformAdapter> {
        return (await DeployUtils.deployContract(signer, "AavePlatformAdapter")) as AavePlatformAdapter;
    }
//endregion AAVE
}