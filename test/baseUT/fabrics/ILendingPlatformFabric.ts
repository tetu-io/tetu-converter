import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {IController, IERC20} from "../../../typechain";

/**
 * Result of ILendingPlatformFabric.createAndRegisterPools()
 */
export interface ILendingPlatformPoolInfo {
  /** Lending pool, i.e. AAVE3 pool */
  pool: IERC20;
  /** Platform adapter created for the pool and registered in TetuConverter app */
  platformAdapter: string;
}

export interface ILendingPlatformFabric {
  /** return addresses of pools */
  // eslint-disable-next-line no-unused-vars
  createAndRegisterPools: (deployer: SignerWithAddress, controller: IController) => Promise<ILendingPlatformPoolInfo>;
}