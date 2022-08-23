import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {
  BorrowManager,
  IPoolAdapter,
  IPoolAdapter__factory,
  PlatformAdapterStub,
  PriceOracleMock
} from "../../typechain";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {BorrowManagerHelper} from "../baseUT/helpers/BorrowManagerHelper";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import {CoreContractsHelper} from "../baseUT/helpers/CoreContractsHelper";
import {MocksHelper} from "../baseUT/helpers/MocksHelper";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";
import {DeployUtils} from "../../scripts/utils/DeployUtils";

describe("BorrowManagerBase (IPoolAdaptersManager)", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;
  let user4: SignerWithAddress;
  let user5: SignerWithAddress;
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
    user4 = signers[5];
    user5 = signers[6];
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
  describe("registerPoolAdapter", () => {
    describe("Good paths", () => {
      describe("Single platformAdapter + templatePoolAdapter", () => {
        it("should create instance of the required template contract", async () => {
          // create borrow manager (BM) with single pool
          const tt = BorrowManagerHelper.getBmInputParamsSinglePool();
          const {bm, sourceToken, targetToken, pools}
            = await BorrowManagerHelper.createBmTwoUnderlyings(deployer, tt);

          // register pool adapter
          const converter = pools[0].converter;
          const user = ethers.Wallet.createRandom().address;
          const collateral = sourceToken.address;

          await bm.registerPoolAdapter(converter, user, collateral, targetToken.address);
          const poolAdapter = await bm.getPoolAdapter(converter, user, collateral, targetToken.address);

          // get data from the pool adapter
          const pa: IPoolAdapter = IPoolAdapter__factory.connect(
            poolAdapter, await DeployerUtils.startImpersonate(user)
          );

          const paConfig = await pa.getConfig();
          const ret = [
            paConfig.originConverter,
            paConfig.collateralAsset,
            paConfig.user,
            paConfig.borrowAsset
          ].join("\n");

          const expected = [
            pools[0].converter,
            sourceToken.address,
            user,
            targetToken.address
          ].join("\n");

          expect(ret).equal(expected);
        });
      });
    });
    describe("Bad paths", () => {
      describe("Wrong pool address", () => {
        it("should revert with template contract not found", async () => {
          expect.fail("TODO");
        });
      });
    });
  });

  describe("getPoolAdapter", () => {
    describe("Good paths", () => {
      it("should TODO", async () => {
        expect.fail("TODO");
      });
    });
    describe("Bad paths", () => {
      it("should TODO", async () => {
        expect.fail("TODO");
      });
    });
  });

  describe("getInfo", () => {
    describe("Good paths", () => {
      it("should TODO", async () => {
        expect.fail("TODO");
      });
    });
    describe("Bad paths", () => {
      it("should TODO", async () => {
        expect.fail("TODO");
      });
    });
  });
//endregion Unit tests

});