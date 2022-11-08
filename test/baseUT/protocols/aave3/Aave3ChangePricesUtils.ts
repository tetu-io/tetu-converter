import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Aave3Helper} from "../../../../scripts/integration/helpers/Aave3Helper";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {DeployUtils} from "../../../../scripts/utils/DeployUtils";
import {
  Aave3PriceOracleMock,
  Aave3PriceOracleMock__factory,
  IAaveAddressesProvider__factory
} from "../../../../typechain";
import {BigNumber} from "ethers";

export class Aave3ChangePricesUtils {
  public static async setupPriceOracleMock(deployer: SignerWithAddress) {
    // get access to AAVE price oracle
    const aaveOracle = await Aave3Helper.getAavePriceOracle(deployer);

    // get admin address
    const aavePoolOwner = await DeployerUtils.startImpersonate(MaticAddresses.AAVE_V3_POOL_OWNER);

    // deploy mock
    const mock = (await DeployUtils.deployContract(deployer
      , "Aave3PriceOracleMock"
      , await aaveOracle.ADDRESSES_PROVIDER()
      , await aaveOracle.BASE_CURRENCY()
      , await aaveOracle.BASE_CURRENCY_UNIT()
      , await aaveOracle.getFallbackOracle()
    )) as Aave3PriceOracleMock;

    // copy current prices from real price oracle to the mock
    const aavePool = await Aave3Helper.getAavePool(deployer);
    const reserves = await aavePool.getReservesList();
    const prices = await aaveOracle.getAssetsPrices(reserves);
    await mock.setPrices(reserves, prices);

    // install the mock to the protocol
    const aaveAddressProviderAsOwner = IAaveAddressesProvider__factory.connect(
      await aavePool.ADDRESSES_PROVIDER()
      , aavePoolOwner
    );
    await aaveAddressProviderAsOwner.setPriceOracle(mock.address);
  }

  public static async changeAssetPrice(
    signer: SignerWithAddress,
    asset: string,
    inc: boolean,
    times: number
  ) {
    // setup new price oracle
    await this.setupPriceOracleMock(signer);

    // change a price of the given asset
    const oracle = Aave3PriceOracleMock__factory.connect(
      (await Aave3Helper.getAavePriceOracle(signer)).address
      , signer
    );
    const currentPrice: BigNumber = await oracle.getAssetPrice(asset);
    await oracle.setPrices(
      [
        asset
      ], [
        inc ? currentPrice.mul(times) : currentPrice.div(times)
      ]
    );
  }
}