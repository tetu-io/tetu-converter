import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {IController} from "../../../typechain/contracts/interfaces/IController";
import {IERC20} from "../../../typechain/contracts/openzeppelin/IERC20";

export interface ILendingPlatformFabric {
    /** return addresses of pools */
    createAndRegisterPools: (deployer: SignerWithAddress, controller: IController) => Promise<IERC20[]>;
}