import {IConverterController__factory, IPoolAdapter__factory, ITetuConverter__factory} from "../../typechain";
import {ethers} from "hardhat";
import {Misc} from "../../scripts/utils/Misc";
import {HardhatUtils, POLYGON_NETWORK_ID} from "../../scripts/utils/HardhatUtils";

describe("Try to call repayTheBorrow @skip-on-coverage", () => {
  before(async function () {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
  });

  it("should close the given borrow", async () => {
    const signer = (await ethers.getSigners())[1];

    const openedPoolAdapters = [
      "0x67874287b175eAe2e1bc51E1fEf505C6d2fFad84",
    ];
    const tetuConverter = "0x5E1226f7e743cA56537B3fab0C1A9ea2FAe7BAb1";
    const converterController = "0x2df21e2a115fcB3d850Fbc67237571bBfB566e99";

    const governance = await IConverterController__factory.connect(converterController, signer).governance();
    const tetuConverterAsGov = ITetuConverter__factory.connect(
      tetuConverter,
      await Misc.impersonate(governance)
    );

    // state before the closing
    for (const pa of openedPoolAdapters) {
      const status = await IPoolAdapter__factory.connect(pa, signer).getStatus();
      const config = await IPoolAdapter__factory.connect(pa, signer).getConfig();
      console.log("Pool adapter", pa, "Config", config, "status", status);
    }

    // close positions
    for (const pa of openedPoolAdapters) {
      await tetuConverterAsGov.repayTheBorrow(pa, true);
    }

    // state after the closing
    for (const pa of openedPoolAdapters) {
      const status = await IPoolAdapter__factory.connect(pa, signer).getStatus();
      const config = await IPoolAdapter__factory.connect(pa, signer).getConfig();
      console.log("Pool adapter", pa, "Config", config, "status", status);
    }

  });
});