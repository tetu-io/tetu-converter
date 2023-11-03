import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Aave3Helper} from "../../../../scripts/integration/aave3/Aave3Helper";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {DeployUtils} from "../../../../scripts/utils/DeployUtils";
import {
  Aave3PriceOracleMock,
  Aave3PriceOracleMock__factory,
  IAaveAddressesProvider__factory,
  IAavePoolConigurator__factory,
  IERC20Metadata__factory
} from "../../../../typechain";
import {BigNumber} from "ethers";
import {parseUnits} from "ethers/lib/utils";
import {ICoreAave3} from "./Aave3DataTypes";

export class Aave3ChangePricesUtils {
  public static async setupPriceOracleMock(deployer: SignerWithAddress, core: ICoreAave3) : Promise<Aave3PriceOracleMock> {
    // get access to AAVE price oracle
    const aaveOracle = await Aave3Helper.getAavePriceOracle(deployer, core.pool);

    // get admin address
    const aavePoolOwner = await DeployerUtils.startImpersonate(core.poolOwner);

    // deploy mock
    const mock = (await DeployUtils.deployContract(deployer,
      "Aave3PriceOracleMock",
      await aaveOracle.ADDRESSES_PROVIDER(),
      await aaveOracle.BASE_CURRENCY(),
      await aaveOracle.BASE_CURRENCY_UNIT(),
      await aaveOracle.getFallbackOracle(),
    )) as Aave3PriceOracleMock;

    // copy current prices from real price oracle to the mock
    const aavePool = await Aave3Helper.getAavePool(deployer, core.pool);
    const reserves = await aavePool.getReservesList();
    const prices = await aaveOracle.getAssetsPrices(reserves);
    await mock.setPrices(reserves, prices);

    // install the mock to the protocol
    const aaveAddressProviderAsOwner = IAaveAddressesProvider__factory.connect(
      await aavePool.ADDRESSES_PROVIDER(),
      aavePoolOwner
    );
    await aaveAddressProviderAsOwner.setPriceOracle(mock.address);
    console.log("Set AAVE.v3 price oracle mock", mock.address);

    return mock;
  }

  public static async changeAssetPrice(
    signer: SignerWithAddress,
    core: ICoreAave3,
    asset: string,
    inc: boolean,
    times: number
  ) {
    // setup new price oracle
    await this.setupPriceOracleMock(signer, core);

    // change a price of the given asset
    const oracle = Aave3PriceOracleMock__factory.connect(
      (await Aave3Helper.getAavePriceOracle(signer, core.pool)).address
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

  public static async setAssetPrice(
    signer: SignerWithAddress,
    core: ICoreAave3,
    asset: string,
    newPrice: BigNumber
  ) {
    console.log("setAssetPrice.begin");
    // change a price of the given asset
    const oracle = Aave3PriceOracleMock__factory.connect(
      (await Aave3Helper.getAavePriceOracle(signer, core.pool)).address,
      signer
    );
    await oracle.setPrices([asset], [newPrice]);
    console.log("setAssetPrice.end");
  }

  public static async setReservePaused(
    signer: SignerWithAddress,
    core: ICoreAave3,
    reserve: string,
    paused: boolean = true
  ) {
    const aaveEmergencyAdmin = await DeployerUtils.startImpersonate(core.emergencyAdmin);
    const aavePool = await Aave3Helper.getAavePool(signer, core.pool);
    const aaveAddressProvider = IAaveAddressesProvider__factory.connect(
      await aavePool.ADDRESSES_PROVIDER(),
      signer
    );

    const poolConfiguratorAsAdmin = IAavePoolConigurator__factory.connect(
      await aaveAddressProvider.getPoolConfigurator(),
      aaveEmergencyAdmin
    );
    console.log("setReservePause");
    await poolConfiguratorAsAdmin.setReservePause(reserve, paused);
    console.log("success");
  }

  public static async setReserveFreeze(
    signer: SignerWithAddress,
    core: ICoreAave3,
    reserve: string,
    freeze: boolean = true
  ) {
    const aavePoolAdmin = await DeployerUtils.startImpersonate(core.poolOwner);
    const aavePool = await Aave3Helper.getAavePool(signer, core.pool);
    const aaveAddressProvider = IAaveAddressesProvider__factory.connect(
      await aavePool.ADDRESSES_PROVIDER(),
      signer
    );

    const poolConfiguratorAsAdmin = IAavePoolConigurator__factory.connect(
      await aaveAddressProvider.getPoolConfigurator(),
      aavePoolAdmin
    );
    console.log("setReserveFreeze");
    await poolConfiguratorAsAdmin.setReserveFreeze(reserve, freeze);
    console.log("successs");
  }

  /**
   * Set fixed supply cap.
   * If a value of the supply cap is not provided then
   *    get total supply value and set supply cap to almost same value.
   *    so, next attempt to supply of large enough amount should fail.
   */
  public static async setSupplyCap(
    signer: SignerWithAddress,
    core: ICoreAave3,
    reserve: string,
    supplyCapValue?: BigNumber
  ) {
    const aavePoolAdmin = await DeployerUtils.startImpersonate(core.poolOwner);
    const aavePool = await Aave3Helper.getAavePool(signer, core.pool);
    const aaveAddressProvider = IAaveAddressesProvider__factory.connect(
      await aavePool.ADDRESSES_PROVIDER(),
      signer
    );

    const poolConfiguratorAsAdmin = IAavePoolConigurator__factory.connect(
      await aaveAddressProvider.getPoolConfigurator(),
      aavePoolAdmin
    );

    let capValue;
    if (supplyCapValue) {
      capValue = supplyCapValue;
    } else {
      const dp = await Aave3Helper.getAaveProtocolDataProvider(signer, core.pool);
      const r = await dp.getReserveData(reserve);
      capValue = r.totalAToken.div(
        parseUnits("1", await IERC20Metadata__factory.connect(reserve, signer).decimals())
      );
    }

    console.log("setSupplyCap", capValue);
    await poolConfiguratorAsAdmin.setSupplyCap(reserve, capValue);
    console.log("successs");
  }

  public static async setBorrowCap(
    signer: SignerWithAddress,
    core: ICoreAave3,
    reserve: string,
    borrowCapValue?: BigNumber,
    delta?: string
  ) {
    const aavePoolAdmin = await DeployerUtils.startImpersonate(core.poolOwner);
    const aavePool = await Aave3Helper.getAavePool(signer, core.pool);
    const aaveAddressProvider = IAaveAddressesProvider__factory.connect(
      await aavePool.ADDRESSES_PROVIDER(),
      signer
    );

    const poolConfiguratorAsAdmin = IAavePoolConigurator__factory.connect(
      await aaveAddressProvider.getPoolConfigurator(),
      aavePoolAdmin
    );

    const dp = await Aave3Helper.getAaveProtocolDataProvider(signer, core.pool);
    const r = await dp.getReserveData(reserve);
    const decimals = await IERC20Metadata__factory.connect(reserve, signer).decimals();
    const capValue = borrowCapValue
      ? borrowCapValue
      : r.totalVariableDebt
        .add(r.totalStableDebt)
        .add(parseUnits(delta ?? "0", decimals))
        .div(parseUnits("1", decimals))

    console.log("setBorrowCap", capValue);
    await poolConfiguratorAsAdmin.setBorrowCap(reserve, capValue);
    console.log("successs");
  }
}