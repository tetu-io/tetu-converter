import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BASE_NETWORK_ID, HardhatUtils} from "../../../../scripts/utils/HardhatUtils";
import {BaseAddresses} from "../../../../scripts/addresses/BaseAddresses";
import {CompoundLibFacade, ICompoundPriceOracle__factory, IMToken__factory, IERC20, IERC20Metadata, IERC20Metadata__factory, IMToken} from "../../../../typechain";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {DeployUtils} from "../../../../scripts/utils/DeployUtils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {expect} from "chai";
import {ethers} from "hardhat";
import {formatUnits, parseUnits} from "ethers/lib/utils";

describe("MoonwellPlatformAdapterTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let deployer: SignerWithAddress;
  let facade: CompoundLibFacade;
  let usdc: IERC20Metadata;
  let cbEth: IERC20Metadata;
  let dai: IERC20Metadata;
  let weth: IERC20Metadata;

  let cUsdc: IMToken;
  let cCbEth: IMToken;
  let cDai: IMToken;
  let cWeth: IMToken;

//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(BASE_NETWORK_ID);
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
    facade = await DeployUtils.deployContract(deployer, "CompoundLibFacade") as CompoundLibFacade;

    usdc = IERC20Metadata__factory.connect(BaseAddresses.USDC, deployer);
    cbEth = IERC20Metadata__factory.connect(BaseAddresses.cbETH, deployer);
    dai = IERC20Metadata__factory.connect(BaseAddresses.DAI, deployer);
    weth = IERC20Metadata__factory.connect(BaseAddresses.WETH, deployer);

    cUsdc = IMToken__factory.connect(BaseAddresses.MOONWELL_USDC, deployer);
    cCbEth = IMToken__factory.connect(BaseAddresses.MOONWELL_CBETH, deployer);
    cDai = IMToken__factory.connect(BaseAddresses.MOONWELL_DAI, deployer);
    cWeth = IMToken__factory.connect(BaseAddresses.MOONWELL_WETH, deployer);
  });

  after(async function () {
    await TimeUtils.rollback(snapshot);
  });

//endregion before, after

//region Unit tests
  describe("getMarketsInfo", () = > {

  });

  describe("getConversionPlan", () = > {

  });
//endregion Unit tests
});