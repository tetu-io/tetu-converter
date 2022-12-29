import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {IController, IERC20} from "../../../typechain";

export interface ILendingPlatformFabric {
  /** return addresses of pools */
  // eslint-disable-next-line no-unused-vars
  createAndRegisterPools: (deployer: SignerWithAddress, controller: IController) => Promise<IERC20[]>;
}