import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BigNumber} from "ethers";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {DeployUtils} from "../../../../scripts/utils/DeployUtils";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {DForcePriceOracleMock, IDForceController__factory, IDForceCToken__factory} from "../../../../typechain";
import {DForceHelper} from "../../../../scripts/integration/helpers/DForceHelper";

export class DForceChangePriceUtils {
  public static async setupPriceOracleMock(deployer: SignerWithAddress) : Promise<DForcePriceOracleMock> {
    const cTokensList = [
      MaticAddresses.dForce_iDAI,
      MaticAddresses.dForce_iMATIC,
      MaticAddresses.dForce_iUSDC,
      MaticAddresses.dForce_iWETH,
      MaticAddresses.dForce_iUSDT,
      MaticAddresses.dForce_iWBTC,
      MaticAddresses.dForce_iEUX,
      MaticAddresses.dForce_iCRV,
      MaticAddresses.dForce_iDF,
      MaticAddresses.DF
    ];
    const priceOracle = await DForceHelper.getPriceOracle(await DForceHelper.getController(deployer), deployer);

    const comptroller = await DForceHelper.getController(deployer);
    const owner = await comptroller.owner();

    // deploy mock
    const mock = (await DeployUtils.deployContract(deployer, "DForcePriceOracleMock")) as DForcePriceOracleMock;

    // copy current prices from real price oracle to the mock
    const comptrollerAsAdmin = await DForceHelper.getController(
      await DeployerUtils.startImpersonate(owner)
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
    oracle: DForcePriceOracleMock,
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

  public static async setBorrowCapacity(
    deployer: SignerWithAddress,
    cToken: string,
    amount: BigNumber
  ) {
    const comptroller = await DForceHelper.getController(deployer);
    const owner = await comptroller.owner();

    const comptrollerAsOwner = IDForceController__factory.connect(
      comptroller.address,
      await DeployerUtils.startImpersonate(owner)
    );
    await comptrollerAsOwner._setBorrowCapacity(cToken, amount);
  }

  public static async setSupplyCapacity(
    deployer: SignerWithAddress,
    cToken: string,
    amount: BigNumber
  ) {
    const comptroller = await DForceHelper.getController(deployer);
    const owner = await comptroller.owner();

    const comptrollerAsOwner = IDForceController__factory.connect(
      comptroller.address,
      await DeployerUtils.startImpersonate(owner)
    );
    await comptrollerAsOwner._setSupplyCapacity(cToken, amount);
  }
}