import {ethers} from "hardhat";
import {
  ConverterController__factory,
  IPoolAdapter__factory,
  Keeper__factory,
  ProxyControlled__factory
} from "../../typechain";
import {Misc} from "../../scripts/utils/Misc";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {MocksHelper} from "../baseUT/helpers/MocksHelper";
import {DForceChangePriceUtils} from "../baseUT/protocols/dforce/DForceChangePriceUtils";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {Aave3ChangePricesUtils} from "../baseUT/protocols/aave3/Aave3ChangePricesUtils";

// depends on network
describe.skip("SCB672 - update keeper, check fixHealth", () => {
  it("should return expected values", async () => {
    const converterControllerV14 = "0x2df21e2a115fcB3d850Fbc67237571bBfB566e99";
    const signer = (await ethers.getSigners())[0];
    const controller = ConverterController__factory.connect(converterControllerV14, signer);

    const governance = await controller.governance();
    const proxyUpdater = await controller.proxyUpdater();

    // upgrade Keeper to new version
    const keeperProxy = ProxyControlled__factory.connect(await controller.keeper(), await Misc.impersonate(proxyUpdater));
    const newImplementation = (await DeployUtils.deployContract(signer, "Keeper")).address;
    await keeperProxy.upgrade(newImplementation);

    // deploy test keeper-caller and register it as an operator
    const keeperCaller = await MocksHelper.createKeeperCaller(signer);
    await keeperCaller.setupKeeper(keeperProxy.address, keeperProxy.address);

    const borrows = [
      "0x75D7D6F10CddE9759Fcdf8c60c050fF905F78f8f",
      "0xB017a780F228C472ed6C9f3D3daf74be049782F2",
      "0x0204B5625337563307973CCBE89429309A9FF3a5"
    ]

    const keeper = Keeper__factory.connect(keeperProxy.address, await Misc.impersonate(governance));
    await keeper.changeOperatorStatus(keeperCaller.address, true);

    const before = await keeper.checker();
    console.log("Before change price", before);

    for (const b of borrows) {
      const status = await IPoolAdapter__factory.connect(b, signer).getStatus();
      console.log("Status1", status);
    }

    // todo change prices to force call of fixHealth

    for (const b of borrows) {
      const status = await IPoolAdapter__factory.connect(b, signer).getStatus();
      console.log("Status2", status);
    }

    const after = await keeper.checker();
    console.log("After change price", after);

    await keeperCaller.callChecker();
  });
});
