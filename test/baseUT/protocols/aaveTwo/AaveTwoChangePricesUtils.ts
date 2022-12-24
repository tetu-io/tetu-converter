import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {AaveTwoHelper} from "../../../../scripts/integration/helpers/AaveTwoHelper";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {DeployUtils} from "../../../../scripts/utils/DeployUtils";
import {
  AaveTwoPriceOracleMock,
  AaveTwoPriceOracleMock__factory,
  IAaveTwoLendingPoolAddressesProvider__factory,
  IAaveTwoLendingPoolConfigurator__factory
} from "../../../../typechain";
import {BigNumber} from "ethers";

export class AaveTwoChangePricesUtils {
  public static async setupPriceOracleMock(deployer: SignerWithAddress) : Promise<AaveTwoPriceOracleMock> {
    // get access to AAVE price oracle
    const aaveOracle = await AaveTwoHelper.getAavePriceOracle(deployer);

    // get admin address
    const aavePoolOwner = await DeployerUtils.startImpersonate(MaticAddresses.AAVE_TWO_POOL_OWNER);

    // deploy mock
    const mock = (await DeployUtils.deployContract(deployer
      , "AaveTwoPriceOracleMock"
      , await aaveOracle.owner()
      , await aaveOracle.WETH()
      , await aaveOracle.getFallbackOracle()
    )) as AaveTwoPriceOracleMock;

    // copy current prices from real price oracle to the mock
    const aavePool = await AaveTwoHelper.getAavePool(deployer);
    const reserves = await aavePool.getReservesList();
    const prices = await aaveOracle.getAssetsPrices(reserves);
    await mock.setPrices(reserves, prices);

    // install the mock to the protocol
    const aaveAddressProviderAsOwner = IAaveTwoLendingPoolAddressesProvider__factory.connect(
      await aavePool.getAddressesProvider(),
      aavePoolOwner
    );
    await aaveAddressProviderAsOwner.setPriceOracle(mock.address);
    console.log("Set AAVE.TWO price oracle mock", mock.address);
    return mock;
  }

  public static async changeAssetPrice(
    signer: SignerWithAddress,
    asset: string,
    inc: boolean,
    times: number
  ) {
    // setup new price oracle
    await AaveTwoChangePricesUtils.setupPriceOracleMock(signer);

    // change a price of the given asset
    const oracle = AaveTwoPriceOracleMock__factory.connect(
      (await AaveTwoHelper.getAavePriceOracle(signer)).address,
      signer
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

  public static async setAssetPrice(
    signer: SignerWithAddress,
    asset: string,
    newPrice: BigNumber
  ) {
    const oracle = AaveTwoPriceOracleMock__factory.connect(
      (await AaveTwoHelper.getAavePriceOracle(signer)).address,
      signer
    );
    await oracle.setPrices([asset], [newPrice]);
  }

  public static async setReserveFreeze(
    signer: SignerWithAddress,
    reserve: string,
    freeze: boolean = true
  ) {
    const aavePoolAdmin = await DeployerUtils.startImpersonate(
      MaticAddresses.AAVE_TWO_POOL_ADMIN
    );
    const aavePoolOwner = await DeployerUtils.startImpersonate(
      MaticAddresses.AAVE_TWO_POOL_OWNER
    );
    const aavePool = await AaveTwoHelper.getAavePool(signer);
    const aaveAddressProviderAsOwner = IAaveTwoLendingPoolAddressesProvider__factory.connect(
      await aavePool.getAddressesProvider(),
      aavePoolOwner
    );

    const poolConfiguratorAsAdmin = IAaveTwoLendingPoolConfigurator__factory.connect(
      await aaveAddressProviderAsOwner.getLendingPoolConfigurator(),
      await DeployerUtils.startImpersonate(MaticAddresses.AAVE_TWO_LENDING_POOL_CONFIGURATOR_POOL_ADMIN)
    );
    console.log("freezeReserve");
    await poolConfiguratorAsAdmin.freezeReserve(reserve);
    console.log("successs");
  }
}