import {MaticDeploySolutionUtils} from "../../../scripts/chains/polygon/deploy/MaticDeploySolutionUtils";
import {ethers} from "hardhat";
import {
  ConverterController__factory,
  IConverterController__factory,
  IERC20Metadata__factory,
  IOps__factory,
  ITetuConverter__factory
} from "../../../typechain";
import {BASE_NETWORK_ID, HardhatUtils, POLYGON_NETWORK_ID, ZKEVM_NETWORK_ID} from "../../../scripts/utils/HardhatUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BaseDeploySolutionUtils} from "../../../scripts/chains/base/deploy/BaseDeploySolutionUtils";
import {ZkEvmDeploySolutionUtils} from "../../../scripts/chains/zkEvm/deploy/ZkEvmDeploySolutionUtils";
import {ZkevmAddresses} from "../../../scripts/addresses/ZkevmAddresses";
import {BaseAddresses} from "../../../scripts/addresses/BaseAddresses";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {TokenUtils} from "../../../scripts/utils/TokenUtils";

// depends on network
describe("deploySolutionTest @skip-on-coverage", () => {
  let signer: SignerWithAddress;
  before(async function () {
    signer = (await ethers.getSigners())[0];
  });

  describe("Polygon chain", () => {
    before(async function () {
      await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);
    });

    it("should return expected values", async () => {
      const gelato = "0x527a819db1eb0e34426297b03bae11F2f8B3A19E";
      const proxyUpdater = MaticAddresses.TETU_CONTROLLER;

      console.log("gelato", await IOps__factory.connect(gelato, signer).taskTreasury());

      const r = await MaticDeploySolutionUtils.runMain((await ethers.getSigners())[0], gelato, proxyUpdater);
      console.log(r);
    });
  });

  describe("Base chain", () => {
    before(async function () {
      await HardhatUtils.setupBeforeTest(BASE_NETWORK_ID);
    });

    it("should return expected values", async () => {
      const proxyUpdater = BaseAddresses.TETU_CONTROLLER;

      const r = await BaseDeploySolutionUtils.runMain((await ethers.getSigners())[0], proxyUpdater);
      console.log(r);
    });
  });

  describe("zkEVM chain", () => {
    before(async function () {
      await HardhatUtils.setupBeforeTest(ZKEVM_NETWORK_ID);
    });

    it("should deploy and make test borrow/repay successfully", async () => {
      const proxyUpdater = ZkevmAddresses.TETU_CONTROLLER;

      const r = await ZkEvmDeploySolutionUtils.runMain((await ethers.getSigners())[0], proxyUpdater);
      console.log(r);

      // whitelist the user
      await ConverterController__factory.connect(r.controller, signer).setWhitelistValues([signer.address], true);

      //try to make borrow and revert
      const tetuConverter = ITetuConverter__factory.connect(r.tetuConverter, signer);
      await TokenUtils.getToken(ZkevmAddresses.USDC, signer.address, parseUnits("1", 6));
      await TokenUtils.getToken(ZkevmAddresses.USDT, signer.address, parseUnits("1", 6));
      await IERC20Metadata__factory.connect(ZkevmAddresses.USDC, signer).approve(tetuConverter.address, parseUnits("1", 6));

      const plan = await tetuConverter.findBorrowStrategies(
        "0x",
        ZkevmAddresses.USDC,
        parseUnits("1", 6),
        ZkevmAddresses.USDT,
        1000
      );
      console.log("plan", plan);

      console.log("collateral amount initial", +formatUnits(await IERC20Metadata__factory.connect(ZkevmAddresses.USDC, signer).balanceOf(signer.address), 6));
      console.log("borrowed amount initial", +formatUnits(await IERC20Metadata__factory.connect(ZkevmAddresses.USDT, signer).balanceOf(signer.address), 6));

      await tetuConverter.borrow(
        plan.converters[0],
        ZkevmAddresses.USDC,
        plan.collateralAmountsOut[0],
        ZkevmAddresses.USDT,
        plan.amountToBorrowsOut[0],
        signer.address
      );

      console.log("collateral amount after borrow", +formatUnits(await IERC20Metadata__factory.connect(ZkevmAddresses.USDC, signer).balanceOf(signer.address), 6));
      console.log("borrowed amount after borrow", +formatUnits(await IERC20Metadata__factory.connect(ZkevmAddresses.USDT, signer).balanceOf(signer.address), 6));

      const debt = await tetuConverter.getDebtAmountStored(signer.address, ZkevmAddresses.USDC, ZkevmAddresses.USDT, true);
      console.log("totalDebtAmountOut", +formatUnits(debt.totalDebtAmountOut, 6));
      console.log("totalCollateralAmountOut", +formatUnits(debt.totalCollateralAmountOut, 6));
      await IERC20Metadata__factory.connect(ZkevmAddresses.USDT, signer).transfer(tetuConverter.address, debt.totalDebtAmountOut);

      await tetuConverter.repay(ZkevmAddresses.USDC, ZkevmAddresses.USDT, debt.totalDebtAmountOut, signer.address);
      console.log("borrowed amount final", +formatUnits(await IERC20Metadata__factory.connect(ZkevmAddresses.USDT, signer).balanceOf(signer.address), 6));
      console.log("collateral amount final", +formatUnits(await IERC20Metadata__factory.connect(ZkevmAddresses.USDC, signer).balanceOf(signer.address), 6));
    });
  });
});
