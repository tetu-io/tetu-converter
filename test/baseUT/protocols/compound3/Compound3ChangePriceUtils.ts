import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {IComet__factory} from "../../../../typechain";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";

export class Compound3ChangePriceUtils {
  public static async setPaused(deployer: SignerWithAddress, comet: string, supplyPaused: boolean = true, withdrawPaused: boolean = true) {
    const cometContract = IComet__factory.connect(comet, deployer)
    const pauser = await DeployerUtils.startImpersonate(await cometContract.pauseGuardian())
    await cometContract.connect(pauser).pause(supplyPaused, false, withdrawPaused, false, false)
  }
}