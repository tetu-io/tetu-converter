import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BigNumber} from "ethers";
import {HundredFinanceHelper} from "../../../scripts/integration/helpers/HundredFinanceHelper";
import {HfPriceOracleMock, HfPriceOracleMock__factory} from "../../../typechain";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";

export class HundredFinanceChangePriceUtils {
  public static async setupPriceOracleMock(
    deployer: SignerWithAddress,
    cTokensList: string[]
  ) {
    const priceOracle = await HundredFinanceHelper.getPriceOracle(deployer);

    const comptroller = await HundredFinanceHelper.getComptroller(deployer);
    const admin = "0x1001009911e3FE1d5B45FF8Efea7732C33a6C012"; // await comptroller.admin();

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
    await comptrollerAsAdmin._setPriceOracle(mock.address);
  }

  public static async changeCTokenPrice(
    signer: SignerWithAddress,
    cToken: string,
    inc: boolean,
    times: number
  ) {
    const oracle = HfPriceOracleMock__factory.connect(
      (await HundredFinanceHelper.getPriceOracle(signer)).address,
      signer
    );
    const currentPrice: BigNumber = await oracle.getUnderlyingPrice(cToken);
    await oracle.setUnderlyingPrice(
      cToken,
      inc
        ? currentPrice.mul(times)
        : currentPrice.div(times)
    );
  }
}