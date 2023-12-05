import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BigNumber} from "ethers";
import {IKeomComptroller__factory, KeomOracleMock} from "../../../../typechain";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {DeployUtils} from "../../../../scripts/utils/DeployUtils";
import {KeomUtilsPolygon} from "./KeomUtilsPolygon";
import {KeomHelper} from "../../../../scripts/integration/keom/KeomHelper";
import {ZkevmAddresses} from "../../../../scripts/addresses/ZkevmAddresses";

export class KeomSetupUtils {
  public static async setupPriceOracleMock(deployer: SignerWithAddress, copyPrices: boolean = true) : Promise<KeomOracleMock> {
    const cTokensList = KeomUtilsPolygon.getAllCTokens();
    const priceOracle = await KeomHelper.getPriceOracle(deployer, ZkevmAddresses.ZEROVIX_COMPTROLLER);
    const comptroller = await KeomHelper.getComptroller(deployer, ZkevmAddresses.ZEROVIX_COMPTROLLER);
    const admin = await DeployerUtils.startImpersonate(await comptroller.admin());
    const mock = (await DeployUtils.deployContract(deployer, "KeomOracleMock")) as KeomOracleMock;

    // copy current prices from real price oracle to the mock
    if (copyPrices) {
      for (const cToken of cTokensList) {
        const price = await priceOracle.getUnderlyingPrice(cToken);
        await mock.setUnderlyingPrice(cToken, price);
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
    await oracle.setUnderlyingPrice(cToken, newPrice);
    console.log(`Price of asset ${cToken} was changed from ${currentPrice} to ${newPrice}`);
  }

  public static async setBorrowCapacity(deployer: SignerWithAddress, cToken: string, amount: BigNumber) {
    const comptroller = await KeomHelper.getComptroller(deployer, ZkevmAddresses.ZEROVIX_COMPTROLLER);
    const admin = await comptroller.admin();

    const comptrollerAsAdmin = IKeomComptroller__factory.connect(
      comptroller.address,
      await DeployerUtils.startImpersonate(admin)
    );
    await comptrollerAsAdmin._setMarketBorrowCaps([cToken], [amount]);
  }

  public static async setMintPaused(deployer: SignerWithAddress, cToken: string, paused: boolean = true) {
    const comptroller = await KeomHelper.getComptroller(deployer, ZkevmAddresses.ZEROVIX_COMPTROLLER);
    const admin = await comptroller.admin();

    const comptrollerAsAdmin = IKeomComptroller__factory.connect(
      comptroller.address,
      await DeployerUtils.startImpersonate(admin)
    );
    await comptrollerAsAdmin._setMintPaused(cToken, paused);
  }

  public static async setBorrowPaused(deployer: SignerWithAddress, cToken: string, paused: boolean = true) {
    const comptroller = await KeomHelper.getComptroller(deployer, ZkevmAddresses.ZEROVIX_COMPTROLLER);
    const admin = await comptroller.admin();

    const comptrollerAsAdmin = IKeomComptroller__factory.connect(
      comptroller.address,
      await DeployerUtils.startImpersonate(admin)
    );
    await comptrollerAsAdmin._setBorrowPaused(cToken, paused);
  }
}