import {ethers} from "hardhat";
import {IBorrowManager__factory, IConverterController__factory, ITetuConverter__factory} from "../../../typechain";
import {Misc} from "../../../scripts/utils/Misc";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {parseUnits} from "ethers/lib/utils";
import {HardhatUtils, POLYGON_NETWORK_ID} from "../../../scripts/utils/HardhatUtils";

describe("AddPairTest - register new asset pairs in borrow manager", () => {
  before(async function () {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
  });

  it("should return expected values", async () => {
    const tetuConverterAddress = "0x2df21e2a115fcB3d850Fbc67237571bBfB566e99";
    const aave3platformAdapter = "0xEE97B67609cD92dAD3772bC9c0A672c38EFfAF6c";

    const left = [MaticAddresses.WETH];
    const right = [MaticAddresses.wstETH];

    const signer = (await ethers.getSigners())[0];

    // know governance
    const controller = await IConverterController__factory.connect(tetuConverterAddress, signer);
    const governance = await controller.governance();

    const borrowManagerAsGovernance = IBorrowManager__factory.connect(
      await controller.borrowManager(),
      await Misc.impersonate(governance)
    );

    await borrowManagerAsGovernance.addAssetPairs(aave3platformAdapter, left, right);

    // check
    const tetuConverter = await ITetuConverter__factory.connect(
      await controller.tetuConverter(),
      signer
    );
    const plan = await tetuConverter.findBorrowStrategies(
      "0x",
      MaticAddresses.WETH,
      parseUnits("1", 18),
      MaticAddresses.wstETH,
      1
    );
    console.log("Plan", plan);
  });
});