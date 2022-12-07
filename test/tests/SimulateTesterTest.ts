import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {IERC20__factory, IERC20Metadata__factory, SimulateContainer, SimulateTester} from "../../typechain";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {parseUnits} from "ethers/lib/utils";
import {BalanceUtils} from "../baseUT/utils/BalanceUtils";
import {ITetuLiquidator__factory} from "../../typechain/factories/contracts/interfaces";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";

describe("Test simulate tester", () => {
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

  it("stub-swap should return expected values", async () => {
    const simulateContainer = await DeployUtils.deployContract(deployer, "SimulateContainer") as SimulateContainer;
    const simulateTester = await DeployUtils.deployContract(deployer, "SimulateTester") as SimulateTester;

    // const makeSwapCall = simulateTester.interface.encodeFunctionData("makeSwap", [2]);
    await simulateTester.callSimulateMakeSwapStub(simulateContainer.address);
  });

  it("real-swap-using-simulate should return expected values", async () => {
    const simulateContainer = await DeployUtils.deployContract(deployer, "SimulateContainer") as SimulateContainer;
    const simulateTester = await DeployUtils.deployContract(deployer, "SimulateTester") as SimulateTester;

    // const makeSwapCall = simulateTester.interface.encodeFunctionData("makeSwap", [2]);

    await BalanceUtils.getRequiredAmountFromHolders(
      parseUnits("100", 6),
      IERC20Metadata__factory.connect(MaticAddresses.USDT, deployer),
      [MaticAddresses.HOLDER_USDT_1],
      simulateContainer.address
    );
    const usdt = IERC20__factory.connect(MaticAddresses.USDT, deployer);
    const dai = IERC20__factory.connect(MaticAddresses.DAI, deployer);
    console.log("simulateTester", simulateTester.address);
    console.log("simulateContainer", simulateContainer.address);
    console.log("usdt balance before", (await usdt.balanceOf(simulateContainer.address)).toString());
    console.log("dai balance before", (await dai.balanceOf(simulateContainer.address)).toString());
    await simulateTester.callSimulateMakeSwapUsingTetuLiquidator(
      simulateContainer.address,
      MaticAddresses.TETU_LIQUIDATOR,
      MaticAddresses.USDT,
      parseUnits("100", 6),
      MaticAddresses.DAI
    );
    const ret = await simulateTester.callStatic.callSimulateMakeSwapUsingTetuLiquidator(
      simulateContainer.address,
      MaticAddresses.TETU_LIQUIDATOR,
      MaticAddresses.USDT,
      parseUnits("100", 6),
      MaticAddresses.DAI
    );
    const gasUsed = await simulateTester.estimateGas.callSimulateMakeSwapUsingTetuLiquidator(
      simulateContainer.address,
      MaticAddresses.TETU_LIQUIDATOR,
      MaticAddresses.USDT,
      parseUnits("100", 6),
      MaticAddresses.DAI
    );
    console.log("ret", ret.toString());
    console.log("gasUsed", gasUsed.toString());
    console.log("usdt balance after", (await usdt.balanceOf(simulateContainer.address)).toString());
    console.log("dai balance after", (await dai.balanceOf(simulateContainer.address)).toString());
  });

  it("try to make real swap and check gas", async () => {
    const swapper = ethers.Wallet.createRandom().address;
    await BalanceUtils.getRequiredAmountFromHolders(
      parseUnits("100", 6),
      IERC20Metadata__factory.connect(MaticAddresses.USDT, deployer),
      [MaticAddresses.HOLDER_USDT_1],
      swapper
    );
    const usdtAsSwapper = IERC20__factory.connect(MaticAddresses.USDT, await DeployerUtils.startImpersonate(swapper));
    const dai = IERC20__factory.connect(MaticAddresses.DAI, await DeployerUtils.startImpersonate(swapper));
    console.log("swapper", swapper);
    console.log("usdt balance before", (await usdtAsSwapper.balanceOf(swapper)).toString());
    console.log("dai balance before", (await dai.balanceOf(swapper)).toString());
    const tetuLiquidator = ITetuLiquidator__factory.connect(
      MaticAddresses.TETU_LIQUIDATOR,
      await DeployerUtils.startImpersonate(swapper)
    );

    await usdtAsSwapper.approve(tetuLiquidator.address, parseUnits("100", 6));
    const gasUsed = await tetuLiquidator.estimateGas.liquidate(
      MaticAddresses.USDT,
      MaticAddresses.DAI,
      parseUnits("100", 6),
      2000
    );
    await tetuLiquidator.liquidate(
      MaticAddresses.USDT,
      MaticAddresses.DAI,
      parseUnits("100", 6),
      2000
    );

    console.log("gasUsed", gasUsed.toString());
    console.log("usdt balance after", (await usdtAsSwapper.balanceOf(swapper)).toString());
    console.log("dai balance after", (await dai.balanceOf(swapper)).toString());
  });

  it("real-swap-using-try-catch should return expected values", async () => {
    const simulateContainer = await DeployUtils.deployContract(deployer, "SimulateContainer") as SimulateContainer;
    const simulateTester = await DeployUtils.deployContract(deployer, "SimulateTester") as SimulateTester;

    // const makeSwapCall = simulateTester.interface.encodeFunctionData("makeSwap", [2]);

    await BalanceUtils.getRequiredAmountFromHolders(
      parseUnits("100", 6),
      IERC20Metadata__factory.connect(MaticAddresses.USDT, deployer),
      [MaticAddresses.HOLDER_USDT_1],
      simulateTester.address
    );
    const usdt = IERC20__factory.connect(MaticAddresses.USDT, deployer);
    const dai = IERC20__factory.connect(MaticAddresses.DAI, deployer);
    console.log("simulateTester", simulateTester.address);
    console.log("simulateContainer", simulateContainer.address);
    console.log("usdt balance before", (await usdt.balanceOf(simulateTester.address)).toString());
    console.log("dai balance before", (await dai.balanceOf(simulateTester.address)).toString());
    await simulateContainer.callTryCatchSwapUsingTetuLiquidator(
      simulateTester.address,
      MaticAddresses.TETU_LIQUIDATOR,
      MaticAddresses.USDT,
      parseUnits("100", 6),
      MaticAddresses.DAI
    );
    const ret = await simulateContainer.callStatic.callTryCatchSwapUsingTetuLiquidator(
      simulateTester.address,
      MaticAddresses.TETU_LIQUIDATOR,
      MaticAddresses.USDT,
      parseUnits("100", 6),
      MaticAddresses.DAI
    );
    const gasUsed = await simulateContainer.estimateGas.callTryCatchSwapUsingTetuLiquidator(
      simulateTester.address,
      MaticAddresses.TETU_LIQUIDATOR,
      MaticAddresses.USDT,
      parseUnits("100", 6),
      MaticAddresses.DAI
    );
    console.log("ret", ret.toString());
    console.log("gasUsed", gasUsed.toString());
    console.log("usdt balance after", (await usdt.balanceOf(simulateTester.address)).toString());
    console.log("dai balance after", (await dai.balanceOf(simulateTester.address)).toString());
  });
});