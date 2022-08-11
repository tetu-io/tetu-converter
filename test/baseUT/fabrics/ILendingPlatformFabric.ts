import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {IController} from "../../../typechain";
import {IERC20} from "../../../typechain";

export interface ILendingPlatformFabric {
    /** return addresses of pools */
    createAndRegisterPools: (deployer: SignerWithAddress, controller: IController) => Promise<IERC20[]>;
}