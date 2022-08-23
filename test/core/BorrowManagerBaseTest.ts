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

//region Utils
  interface IAssetPair {
    smallerAddress: string;
    biggerAddress: string;
  }

  async function getPairsList(bm: BorrowManager, pairs: IAssetPair[]): Promise<string[]> {
    const dest: string[] = [];
    for (const pair of pairs) {
      const len = (await bm.pairsListLength(pair.smallerAddress, pair.biggerAddress)).toNumber();
      for (let i = 0; i < len; ++i) {
        dest.push(await bm.pairsListAt(pair.smallerAddress, pair.biggerAddress, i));
      }
    }
    return dest;
  }

  async function getAllRegisteredPairs(bm: BorrowManager, platformAdapter: string) : Promise<IAssetPair[]> {
    const dest: IAssetPair[] = [];
    const len = (await bm.platformAdapterPairsLength(platformAdapter)).toNumber();
    for (let i = 0; i < len; ++i) {
      const r = await bm.platformAdapterPairsAt(platformAdapter, i);
      if (r.assetLeft < r.assetRight) {
        dest.push({
          smallerAddress: r.assetLeft,
          biggerAddress: r.assetRight
        });
      } else {
        dest.push({
          smallerAddress: r.assetRight,
          biggerAddress: r.assetLeft
        });
      }
    }
    return dest;
  }

  function getAllPairs(underlying: string[]) : IAssetPair[] {
    const dest: IAssetPair[] = [];
    for (let i = 0; i < underlying.length; ++i) {
      for (let j = i + 1; j < underlying.length; ++j) {
        if (underlying[i] < underlying[j]) {
          dest.push({
            smallerAddress: underlying[i]
            , biggerAddress: underlying[j]
          });
        } else {
          dest.push({
            smallerAddress: underlying[j]
            , biggerAddress: underlying[i]
          });
        }
      }
    }
    return  dest;
  }

  async function initializeAssetPairs(
    converters: string[],
    pairs: IAssetPair[]
  ) : Promise<{
    bm: BorrowManager,
    platformAdapter: PlatformAdapterStub
  }>{
    const controller = await CoreContractsHelper.createController(deployer);
    const bm = await CoreContractsHelper.createBorrowManager(deployer, controller);
    const dm = await MocksHelper.createDebtsMonitorStub(deployer, false);
    await controller.assignBatch(
      [await controller.borrowManagerKey(), await controller.debtMonitorKey()]
      , [bm.address, dm.address]
    );

    const platformAdapter = await MocksHelper.createPlatformAdapterStub(deployer, converters);

    // generate all possible pairs of underlying
    await bm.addAssetPairs(
      platformAdapter.address
      , pairs.map(x => x.smallerAddress)
      , pairs.map(x => x.biggerAddress)
    );

    return {bm, platformAdapter};
  }

//endregion Utils

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

  describe("addAssetPairs", () => {
    describe("Good paths", () => {
      describe("Register single pool", () => {
        it("should set BM to expected state", async () => {
          const converters: string[] = [
            ethers.Wallet.createRandom().address
            , ethers.Wallet.createRandom().address
          ];
          const underlying = [
            ethers.Wallet.createRandom().address
            , ethers.Wallet.createRandom().address
            , ethers.Wallet.createRandom().address
            , ethers.Wallet.createRandom().address
          ];
          const pairs = getAllPairs(underlying).sort(
            (x, y) => (x.smallerAddress + x.biggerAddress).localeCompare(y.smallerAddress + y.biggerAddress)
          );
          const {bm, platformAdapter} = await initializeAssetPairs(converters, pairs);
          const registeredPairs = await getAllRegisteredPairs(bm, platformAdapter.address);
          const lenPlatformAdapters = (await bm.platformAdaptersLength()).toNumber()

          const ret = [
            lenPlatformAdapters,
            lenPlatformAdapters == 0 ? "" : await bm.platformAdaptersAt(0),

            registeredPairs.map(x => x.smallerAddress + ":" + x.biggerAddress).join(";"),

            (await getPairsList(bm, pairs)).join(";")
          ].join("\n");

          const expected = [
            1,
            platformAdapter.address,

            pairs.map(x => x.smallerAddress + ":" + x.biggerAddress).join(";"),

            [...Array(pairs.length).keys()].map(x => platformAdapter.address).join(";")
          ].join("\n");

          expect(ret).equal(expected);
        });
      });
    });
    describe("Bad paths", () => {
      describe("Wrong lengths", () => {
        it("should revert with WRONG_LENGTHS", async () => {
          expect.fail("TODO");
        });
      });
    });
  });

  describe("removeAssetPairs", () => {
    describe("Good paths", () => {
      describe("Register single pool", () => {
        describe("Remove all asset pairs", () => {
          it("should completely remove pool from BM", async () => {
            const converters: string[] = [
              ethers.Wallet.createRandom().address
              , ethers.Wallet.createRandom().address
            ];
            const underlying = [
              ethers.Wallet.createRandom().address
              , ethers.Wallet.createRandom().address
              , ethers.Wallet.createRandom().address
              , ethers.Wallet.createRandom().address
            ];
            const pairs = getAllPairs(underlying).sort(
              (x, y) => (x.smallerAddress + x.biggerAddress).localeCompare(y.smallerAddress + y.biggerAddress)
            );
            const {bm, platformAdapter} = await initializeAssetPairs(converters, pairs);

            await bm.removeAssetPairs(
              platformAdapter.address
              , pairs.map(x => x.smallerAddress)
              , pairs.map(x => x.biggerAddress)
            );

            const registeredPairs = await getAllRegisteredPairs(bm, platformAdapter.address);
            const foundPlatformAdapters = await getPairsList(bm, pairs);
            const lenPlatformAdapters = (await bm.platformAdaptersLength()).toNumber()

            const ret = [
              lenPlatformAdapters,

              registeredPairs.map(x => x.smallerAddress + ":" + x.biggerAddress).join(";"),

              (await getPairsList(bm, pairs)).join(";")
            ].join("\n");

            const expected = [
              0,
              "",
              "",
            ].join("\n");

            expect(ret).equal(expected);
          });
        });
        describe("Remove single asset pair", () => {
          it("should set BM to expected state", async () => {
            const converters: string[] = [
              ethers.Wallet.createRandom().address
              , ethers.Wallet.createRandom().address
            ];
            const underlying = [
              ethers.Wallet.createRandom().address
              , ethers.Wallet.createRandom().address
              , ethers.Wallet.createRandom().address
              , ethers.Wallet.createRandom().address
            ];
            const pairs = getAllPairs(underlying).sort(
              (x, y) => (x.smallerAddress + x.biggerAddress).localeCompare(y.smallerAddress + y.biggerAddress)
            );
            const {bm, platformAdapter} = await initializeAssetPairs(converters, pairs);

            // remove last pair only
            const pairToRemove = pairs.pop();
            if (pairToRemove) {
              await bm.removeAssetPairs(
                platformAdapter.address
                , [pairToRemove.smallerAddress]
                , [pairToRemove.biggerAddress]
              );
            }

            const registeredPairs = await getAllRegisteredPairs(bm, platformAdapter.address);
            const lenPlatformAdapters = (await bm.platformAdaptersLength()).toNumber();

            const ret = [
              !!pairToRemove,

              lenPlatformAdapters,
              lenPlatformAdapters == 0 ? "" : await bm.platformAdaptersAt(0),

              registeredPairs.map(x => x.smallerAddress + ":" + x.biggerAddress).join(";"),

              (await getPairsList(bm, pairs)).join(";")
            ].join("\n");

            const expected = [
              true,

              1,
              platformAdapter.address,

              pairs.map(x => x.smallerAddress + ":" + x.biggerAddress).join(";"),

              [...Array(pairs.length).keys()].map(x => platformAdapter.address).join(";")
            ].join("\n");

            expect(ret).equal(expected);
          });
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