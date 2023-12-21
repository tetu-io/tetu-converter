import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BigNumber} from "ethers";
import {IKeomApi3Oracle, IKeomComptroller__factory, IKeomPythOracle, KeomOracleMock} from "../../../../typechain";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {DeployUtils} from "../../../../scripts/utils/DeployUtils";
import {KeomHelper} from "../../../../scripts/integration/keom/KeomHelper";
import {IKeomCore} from "./IKeomCore";
import {Misc} from "../../../../scripts/utils/Misc";
import {parseUnits} from "ethers/lib/utils";
import {ZkevmAddresses} from "../../../../scripts/addresses/ZkevmAddresses";

export class KeomSetupUtils {
  /** Increase heartbeat significantly to prevent the error "Update time (heartbeat) exceeded" */
  public static async disableHeartbeat(signer: SignerWithAddress, core: IKeomCore) {
    console.log("disableHeartbeat");
    const priceOracle = await KeomHelper.getPriceOracle(signer, core.comptroller);
    const admin = await priceOracle.admin();
    for (const kToken of core.utils.getAllCTokens()) {
      if (kToken) {
        await priceOracle.connect(await Misc.impersonate(admin)).setHeartbeat(kToken, parseUnits("1", 27));
      }
    }
  }

  public static async disableHeartbeatZkEvm(signer: SignerWithAddress, core: IKeomCore) {
    console.log("disableHeartbeatZkEvm");
    const priceOracle = await KeomHelper.getPriceOracle(signer, core.comptroller);
    const owner = ZkevmAddresses.ZEROVIX_PRICE_ORACLE_OWNER;
    for (const kToken of core.utils.getAllCTokens()) {
      if (kToken) {
        await priceOracle.connect(await Misc.impersonate(owner)).setHeartbeat(kToken, parseUnits("1", 27));
      }
    }
  }

  public static async setupPriceOracleMock(deployer: SignerWithAddress, core: IKeomCore, copyPrices: boolean = true) : Promise<KeomOracleMock> {
    const cTokensList = core.utils.getAllCTokens();
    const priceOracle = await KeomHelper.getPriceOracle(deployer, core.comptroller);
    const comptroller = await KeomHelper.getComptroller(deployer, core.comptroller);
    const admin = await DeployerUtils.startImpersonate(await comptroller.admin());
    const mock = (await DeployUtils.deployContract(deployer, "KeomOracleMock")) as KeomOracleMock;

    // copy current prices from real price oracle to the mock
    if (copyPrices) {
      for (const cToken of cTokensList) {
        const price = await priceOracle.getUnderlyingPrice(cToken);
        await mock._setUnderlyingPrice(cToken, price);
      }
    }

    // install the mock to the protocol
    console.log("Change price oracle...");
    await comptroller.connect(admin)._setPriceOracle(mock.address);
    console.log("Price oracle is changed");

    return mock;
  }

  public static async changeCTokenPrice(oracle: KeomOracleMock, cToken: string, inc: boolean, times: number) {
    const currentPrice: BigNumber = await oracle.getUnderlyingPrice(cToken);
    const newPrice = inc
      ? currentPrice.mul(times)
      : currentPrice.div(times);
    await oracle._setUnderlyingPrice(cToken, newPrice);
    console.log(`Price of asset ${cToken} was changed from ${currentPrice} to ${newPrice}`);
  }

  public static async setBorrowCapacity(deployer: SignerWithAddress, comptrollerAddress: string, cToken: string, amount: BigNumber) {
    const comptroller = await KeomHelper.getComptroller(deployer, comptrollerAddress);
    const admin = await comptroller.admin();

    const comptrollerAsAdmin = IKeomComptroller__factory.connect(
      comptroller.address,
      await DeployerUtils.startImpersonate(admin)
    );
    await comptrollerAsAdmin._setMarketBorrowCaps([cToken], [amount]);
  }

  public static async setMintPaused(deployer: SignerWithAddress, comptrollerAddress: string, cToken: string, paused: boolean = true) {
    const comptroller = await KeomHelper.getComptroller(deployer, comptrollerAddress);
    const admin = await comptroller.admin();

    const comptrollerAsAdmin = IKeomComptroller__factory.connect(
      comptroller.address,
      await DeployerUtils.startImpersonate(admin)
    );
    await comptrollerAsAdmin._setMintPaused(cToken, paused);
  }

  public static async setBorrowPaused(deployer: SignerWithAddress, comptrollerAddress: string, cToken: string, paused: boolean = true) {
    const comptroller = await KeomHelper.getComptroller(deployer, comptrollerAddress);
    const admin = await comptroller.admin();

    const comptrollerAsAdmin = IKeomComptroller__factory.connect(
      comptroller.address,
      await DeployerUtils.startImpersonate(admin)
    );
    await comptrollerAsAdmin._setBorrowPaused(cToken, paused);
  }
}