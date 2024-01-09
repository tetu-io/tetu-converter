import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {AppUtilsFacade, IERC20Metadata__factory, MockERC20} from "../../typechain";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {parseUnits} from "ethers/lib/utils";
import {HARDHAT_NETWORK_ID, HardhatUtils} from "../../scripts/utils/HardhatUtils";

describe("AppUtils", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let facade: AppUtilsFacade;

  let usdc: MockERC20;
  let dai: MockERC20;
  let matic: MockERC20;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(HARDHAT_NETWORK_ID);

    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
    facade = await DeployUtils.deployContract(deployer, "AppUtilsFacade") as AppUtilsFacade;

    usdc = await DeployUtils.deployContract(deployer, 'MockERC20', 'USDC', 'USDC', 6) as MockERC20;
    dai = await DeployUtils.deployContract(deployer, 'MockERC20', 'Dai', 'DAI', 18) as MockERC20;
    matic = await DeployUtils.deployContract(deployer, 'MockERC20', 'Matic', 'MATIC', 18) as MockERC20;
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
  describe("toMantissa", () => {
    describe("Good paths", () => {
      it("should return expected values, decimals 10, 27", async () => {
        const ret = await facade.toMantissa(
          parseUnits("9", 18),
          10,
          27
        );
        expect(ret.eq(parseUnits("9", 35)));
      });
      it("should return expected values, decimals 0, 0", async () => {
        const ret = await facade.toMantissa(
          parseUnits("9", 18),
          0,
          0
        );
        expect(ret.eq(parseUnits("9", 18)));
      });
    });
  });

  describe("removeLastItems (address)", () => {
    it("remove 2 items - should return expected values", async () => {
      const src = [dai.address, matic.address, usdc.address];
      const expected = [dai.address];
      const ret = await facade["removeLastItems(address[],uint256)"](src, 1);
      expect(ret.join().toLowerCase()).eq(expected.join().toLowerCase());
    });
    it("remove 1 item - should return expected values", async () => {
      const src = [dai.address, matic.address, usdc.address];
      const expected = [dai.address, matic.address];
      const ret = await facade["removeLastItems(address[],uint256)"](src, 2);
      expect(ret.join().toLowerCase()).eq(expected.join().toLowerCase());
    });
    it("remove 0 items - should return expected values", async () => {
      const src = [dai.address, matic.address, usdc.address];
      const expected = [dai.address, matic.address, usdc.address];
      const ret = await facade["removeLastItems(address[],uint256)"](src, 3);
      expect(ret.join().toLowerCase()).eq(expected.join().toLowerCase());
    });
    it("remove all items - should return empty array", async () => {
      const src = [dai.address, matic.address, usdc.address];
      const ret = await facade["removeLastItems(address[],uint256)"](src, 0);
      expect(ret.join().toLowerCase()).eq([].join().toLowerCase());
    });
  });

  describe("removeLastItems (uint)", () => {
    it("remove 2 items - should return expected values", async () => {
      const src = [1, 2, 3];
      const expected = [1];
      const ret = await facade["removeLastItems(uint256[],uint256)"](src, 1);
      expect(ret.join().toLowerCase()).eq(expected.join().toLowerCase());
    });
    it("remove 1 item - should return expected values", async () => {
      const src = [1, 2, 3];
      const expected = [1, 2];
      const ret = await facade["removeLastItems(uint256[],uint256)"](src, 2);
      expect(ret.join().toLowerCase()).eq(expected.join().toLowerCase());
    });
    it("remove 0 items - should return expected values", async () => {
      const src = [1, 2, 3];
      const expected = [1, 2, 3];
      const ret = await facade["removeLastItems(uint256[],uint256)"](src, 3);
      expect(ret.join().toLowerCase()).eq(expected.join().toLowerCase());
    });
    it("remove all items - should return empty array", async () => {
      const src = [1, 2, 3];
      const ret = await facade["removeLastItems(uint256[],uint256)"](src, 0);
      expect(ret.join().toLowerCase()).eq([].join().toLowerCase());
    });
  });

  describe("approxEqual", () => {
    it("should return true", async () => {
      const amount1 = parseUnits("1", 18).add(1e9);
      const amount2 = parseUnits("1", 18).add(2e9);
      console.log(amount1.toString(), amount2.toString());
      const ret = await facade.approxEqual(amount1, amount2, 1e10);
      expect(ret).eq(true);
    });
    it("should return false", async () => {
      const amount1 = parseUnits("1", 18).add(1e11);
      const amount2 = parseUnits("1", 18).add(2e11);
      console.log(amount1.toString(), amount2.toString());
      const ret = await facade.approxEqual(amount1, amount2, 1e10);
      expect(ret).eq(false);
    });
  });

  describe("_sortAsc", () => {
    interface ISortAscParams {
      items: number[];
      startIndex: number;
      length: number;
    }
    interface ISortAscResults {
      indices: number[];
    }

    async function sortAsc(p: ISortAscParams): Promise<ISortAscResults> {
      const indices = await facade._sortAsc(p.startIndex, p.length, p.items);
      return {
        indices: indices.map(x => x.toNumber())
      }
    }

    it("should success if there are no items", async () => {
      const {indices} = await sortAsc({
        items: [],
        startIndex: 0,
        length: 0
      });
      expect(indices.join()).eq([].join());
    });

    it("should return expected indices when all items are sorted", async () => {
      const {indices} = await sortAsc({
        items: [7, 1, 3, 2],
        startIndex: 0,
        length: 4
      });
      expect(indices.join()).eq([1, 3, 2, 0].join());
    });

    it("should return expected indices when the end-part of items are sorted", async () => {
      const {indices} = await sortAsc({
        items: [7, 1, 3, 2, 14],
        startIndex: 2,
        length: 3
      });
      expect(indices.join()).eq([0, 0, 3, 2, 4].join());
    });

    it("should return expected indices when the first-part of items are sorted", async () => {
      const {indices} = await sortAsc({
        items: [7, 1, 3, 2, 14],
        startIndex: 0,
        length: 3
      });
      expect(indices.join()).eq([1, 2, 0, 0, 0].join());
    });

    it("should return expected indices when the middle-part of items are sorted", async () => {
      const {indices} = await sortAsc({
        items: [7, 14, 3, 2, 14],
        startIndex: 1,
        length: 3
      });
      expect(indices.join()).eq([0, 3, 2, 1, 0].join());
    });
  });

  describe("setAllowance", () => {
    const SPENDER = ethers.Wallet.createRandom().address;
    it("should set initial approve", async () => {
       await facade.setAllowance(usdc.address, SPENDER, parseUnits("1.2", 6));
       const allowance = await usdc.allowance(facade.address, SPENDER);
       expect(allowance).eq(parseUnits("1.2", 6));
    });
    it("should increase approve", async () => {
      await facade.setAllowance(usdc.address, SPENDER, parseUnits("1.2", 6));
      await facade.setAllowance(usdc.address, SPENDER, parseUnits("2.3", 6));
      const allowance = await usdc.allowance(facade.address, SPENDER);
      expect(allowance).eq(parseUnits("2.3", 6));
    });
    it("should decrease approve", async () => {
      await facade.setAllowance(usdc.address, SPENDER, parseUnits("1.2", 6));
      await facade.setAllowance(usdc.address, SPENDER, parseUnits("0.1", 6));
      const allowance = await usdc.allowance(facade.address, SPENDER);
      expect(allowance).eq(parseUnits("0.1", 6));
    });
  });
//endregion Unit tests

});
