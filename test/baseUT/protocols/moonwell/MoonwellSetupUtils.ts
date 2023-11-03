import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BigNumber} from "ethers";
import {IMoonwellComptroller__factory, MoonwellOracleMock} from "../../../../typechain";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {DeployUtils} from "../../../../scripts/utils/DeployUtils";
import {BaseAddresses} from "../../../../scripts/addresses/BaseAddresses";
import {MoonwellHelper} from "../../../../scripts/integration/moonwell/MoonwellHelper";

export class MoonwellSetupUtils {
  public static async setupPriceOracleMock(deployer: SignerWithAddress, copyPrices: boolean = true) : Promise<MoonwellOracleMock> {
    const cTokensList = [
      BaseAddresses.MOONWELL_WETH,
      BaseAddresses.MOONWELL_DAI,
      BaseAddresses.MOONWELL_CBETH,
      BaseAddresses.MOONWELL_USDC,
      BaseAddresses.MOONWELL_USDBC
    ];
    const priceOracle = await MoonwellHelper.getPriceOracle(deployer);
    const comptroller = await MoonwellHelper.getComptroller(deployer);
    const admin = await DeployerUtils.startImpersonate(await comptroller.admin());
    const mock = (await DeployUtils.deployContract(deployer, "MoonwellOracleMock")) as MoonwellOracleMock;

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

  public static async changeCTokenPrice(oracle: MoonwellOracleMock, cToken: string, inc: boolean, times: number) {
    const currentPrice: BigNumber = await oracle.getUnderlyingPrice(cToken);
    const newPrice = inc
      ? currentPrice.mul(times)
      : currentPrice.div(times);
    await oracle.setUnderlyingPrice(cToken, newPrice);
    console.log(`Price of asset ${cToken} was changed from ${currentPrice} to ${newPrice}`);
  }

  public static async setBorrowCapacity(deployer: SignerWithAddress, cToken: string, amount: BigNumber) {
    const comptroller = await MoonwellHelper.getComptroller(deployer);
    const admin = await comptroller.admin();

    const comptrollerAsAdmin = IMoonwellComptroller__factory.connect(
      comptroller.address,
      await DeployerUtils.startImpersonate(admin)
    );
    await comptrollerAsAdmin._setMarketBorrowCaps([cToken], [amount]);
  }

  public static async setMintPaused(deployer: SignerWithAddress, cToken: string, paused: boolean = true) {
    const comptroller = await MoonwellHelper.getComptroller(deployer);
    const admin = await comptroller.admin();

    const comptrollerAsAdmin = IMoonwellComptroller__factory.connect(
      comptroller.address,
      await DeployerUtils.startImpersonate(admin)
    );
    await comptrollerAsAdmin._setMintPaused(cToken, paused);
  }

  public static async setBorrowPaused(deployer: SignerWithAddress, cToken: string, paused: boolean = true) {
    const comptroller = await MoonwellHelper.getComptroller(deployer);
    const admin = await comptroller.admin();

    const comptrollerAsAdmin = IMoonwellComptroller__factory.connect(
      comptroller.address,
      await DeployerUtils.startImpersonate(admin)
    );
    await comptrollerAsAdmin._setBorrowPaused(cToken, paused);
  }
}