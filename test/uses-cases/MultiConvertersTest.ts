import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {DForceChangePriceUtils} from "../baseUT/protocols/dforce/DForceChangePriceUtils";
import {TetuConverterApp} from "../baseUT/helpers/TetuConverterApp";
import {Aave3PlatformFabric} from "../baseUT/fabrics/Aave3PlatformFabric";
import {CoreContractsHelper} from "../baseUT/helpers/CoreContractsHelper";
import {AaveTwoPlatformFabric} from "../baseUT/fabrics/AaveTwoPlatformFabric";
import {DForcePlatformFabric} from "../baseUT/fabrics/DForcePlatformFabric";
import {IPlatformAdapter, IPlatformAdapter__factory, ITetuConverter} from "../../typechain";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {parseUnits} from "ethers/lib/utils";
import {expect} from "chai";
import {GAS_LIMIT} from "../baseUT/GasLimit";
import {HardhatUtils, POLYGON_NETWORK_ID} from "../../scripts/utils/HardhatUtils";

describe("MultiConvertersTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let platformAdapters: IPlatformAdapter[];
  let tetuConverter: ITetuConverter;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);

    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    // we use signers[1] instead signers[0] here because of weird problem
    // if signers[0] is used than newly created TetuConverter contract has not-zero USDC balance
    // and some tests don't pass
    deployer = signers[1];

    // We need to replace DForce price oracle by custom one
    // because when we run all tests
    // DForce-prices deprecate before DForce tests are run
    // and we have TC-4 (zero price) error in DForce-tests
    await DForceChangePriceUtils.setupPriceOracleMock(deployer);

    // set up TetuConverter app with all known lending platforms
    const app = await TetuConverterApp.buildApp(
      deployer,
      [
        new Aave3PlatformFabric(),
        new AaveTwoPlatformFabric(),
        new DForcePlatformFabric(),
        // new HundredFinancePlatformFabric()
      ],
      {priceOracleFabric: async () => (await CoreContractsHelper.createPriceOracle(deployer)).address} // disable swap, enable price oracle
    );
    platformAdapters = app.pools.map(x => IPlatformAdapter__factory.connect(x.platformAdapter, deployer));
    tetuConverter = app.tc;
  });

  after(async function () {
    await TimeUtils.rollback(snapshot);
  });

  beforeEach(async function () {
    snapshotForEach = await TimeUtils.snapshot();
  });

  afterEach(async function () {
    await TimeUtils.rollback(snapshotForEach);
  });
//endregion before, after

//region Unit tests
  describe("USDC:DAI - the pair is available on all platforms", () => {
    it("should return expected converters", async () => {
      const r = await tetuConverter.findBorrowStrategies(
        "0x",
        MaticAddresses.USDC,
        parseUnits("1", 6),
        MaticAddresses.DAI,
        1,
        {gasLimit: GAS_LIMIT}
      );
      console.log(r);

      const ret = r.converters.map((x: string) => x.toLowerCase()).sort().join("\n");
      const expected =  (await Promise.all(
        platformAdapters.map(async x => {
            const converters = await x.converters();
            return converters.length === 1
              ? converters[0]
              : converters[1]; // AAVE3 has 2 converters: normal and efficient mode. We need second one
          }
        )
      )).map(x => x.toLowerCase()).sort().join("\n");

      expect(ret.toLowerCase()).eq(expected.toLowerCase());
    });
  });
  describe("USDC:BAL - the pair is available on AAVE3 and AAVETwo only", () => {
    it("should return expected count of possible conversions", async () => {
      const r = await tetuConverter.findBorrowStrategies(
        "0x",
        MaticAddresses.USDC,
        parseUnits("1", 6),
        MaticAddresses.BALANCER,
        1,
        {gasLimit: GAS_LIMIT}
      );
      console.log(r);

      // AAVE3 - ok
      // AAVETwo - BAL is frozen at this moment (21.02.2023)
      expect(r.converters.length).eq(1);
    });
  });

//endregion Unit tests
});