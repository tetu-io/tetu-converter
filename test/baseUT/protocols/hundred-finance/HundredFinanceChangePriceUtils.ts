import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BigNumber} from "ethers";
import {HundredFinanceHelper} from "../../../../scripts/integration/helpers/HundredFinanceHelper";
import {HfPriceOracleMock} from "../../../../typechain";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {DeployUtils} from "../../../../scripts/utils/DeployUtils";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";

export class HundredFinanceChangePriceUtils {
  public static async setupPriceOracleMock(deployer: SignerWithAddress) : Promise<HfPriceOracleMock> {
    const cTokensList = [
      MaticAddresses.hDAI,
      MaticAddresses.hMATIC,
      MaticAddresses.hUSDC,
      MaticAddresses.hETH,
      MaticAddresses.hUSDT,
      MaticAddresses.hWBTC,
      MaticAddresses.hFRAX,
      MaticAddresses.hLINK,
    ];
    const priceOracle = await HundredFinanceHelper.getPriceOracle(deployer);

    const comptroller = await HundredFinanceHelper.getComptroller(deployer);
    const admin = await comptroller.admin();

    // deploy mock
    const mock = (await DeployUtils.deployContract(deployer, "HfPriceOracleMock")) as HfPriceOracleMock;

    // copy current prices from real price oracle to the mock
    const comptrollerAsAdmin = await HundredFinanceHelper.getComptroller(
      await DeployerUtils.startImpersonate(admin)
    );
    for (const cToken of cTokensList) {
      const price = await priceOracle.getUnderlyingPrice(cToken);
      await mock.setUnderlyingPrice(cToken, price);
    }

    // install the mock to the protocol
    console.log("Change price oracle...");
    await comptrollerAsAdmin._setPriceOracle(mock.address);
    console.log("Price oracle is changed");

    return mock;
  }

  public static async changeCTokenPrice(
    oracle: HfPriceOracleMock,
    signer: SignerWithAddress,
    cToken: string,
    inc: boolean,
    times: number
  ) {
    console.log("changeCTokenPrice");
    const currentPrice: BigNumber = await oracle.getUnderlyingPrice(cToken);
    const newPrice = inc
      ? currentPrice.mul(times)
      : currentPrice.div(times);
    await oracle.setUnderlyingPrice(
      cToken,
      newPrice
    );
    console.log(`Price of asset ${cToken} was changed from ${currentPrice} to ${newPrice}`);
  }
}