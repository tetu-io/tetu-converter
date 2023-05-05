import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {MocksHelper} from "../baseUT/helpers/MocksHelper";
import {TetuConverterApp} from "../baseUT/helpers/TetuConverterApp";
import {
  Borrower,
  IERC20__factory, IERC20Metadata__factory, Keeper__factory
} from "../../typechain";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {Aave3PlatformFabric} from "../baseUT/fabrics/Aave3PlatformFabric";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import {BalanceUtils} from "../baseUT/utils/BalanceUtils";
import {parseUnits} from "ethers/lib/utils";
import {Misc} from "../../scripts/utils/Misc";

describe("Keeper test for reconversion @skip-on-coverage", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
    user1 = signers[2];
    user2 = signers[3];
    user3 = signers[4];
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
  /**
   * Study how much gas Keeper.checks() can take.
   * We need to select MAX_COUNT_TO_CHECK value in so way that the total gas consumption will be less 10ml
   */
  describe.skip("Study: 50 opened positions, check gas @skip-on-coverage", () => {
    it("should return expected values", async () => {
      const COUNT_USERS = 51;
      const core = await TetuConverterApp.buildApp(deployer, [new Aave3PlatformFabric()]);
      const userContracts: Borrower[] = [];
      for (let i = 0; i < COUNT_USERS; i++) {
        const userContract = await MocksHelper.deployBorrower(deployer.address, core.controller, 4000);
        await core.controller.connect(await DeployerUtils.startImpersonate(await core.controller.governance())).setWhitelistValues([userContract.address], true);

        await BalanceUtils.getRequiredAmountFromHolders(
          parseUnits("1", 6),
          IERC20Metadata__factory.connect(MaticAddresses.USDC, deployer),
          [MaticAddresses.HOLDER_USDC],
          userContract.address
        );
        await IERC20__factory.connect(MaticAddresses.USDC, await DeployerUtils.startImpersonate(userContract.address)).approve(
          await core.controller.tetuConverter(), parseUnits("1", 6)
        );

        userContracts.push(userContract);
      }

      const plan = (await core.tc.connect(await Misc.impersonate(userContracts[0].address)).callStatic.findConversionStrategy(
        "0x",
        MaticAddresses.USDC,
        parseUnits("1", 6),
        MaticAddresses.USDT,
        1111
      ));

      for (const userContract of userContracts) {
        await core.tc.connect(await Misc.impersonate(userContract.address)).borrow(
          plan.converter,
          MaticAddresses.USDC,
          plan.collateralAmountOut,
          MaticAddresses.USDT,
          plan.amountToBorrowOut,
          userContract.address
        );
      }

      const gasUsed = await Keeper__factory.connect(await core.controller.keeper(), deployer).estimateGas.checker();
      console.log(gasUsed);
    });
  });
//endregion Unit tests
});
