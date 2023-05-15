import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {
  Aave3PoolAdapter__factory,
  DebtMonitor__factory,
  BorrowManager__factory,
  IERC20Metadata__factory,
  IPoolAdapter__factory,
  ConverterController,
  Aave3PoolAdapter,
  Aave3PoolMock__factory,
  ITetuConverter__factory,
} from "../../../typechain";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {TokenDataTypes} from "../../baseUT/types/TokenDataTypes";
import {Misc} from "../../../scripts/utils/Misc";
import {IAave3UserAccountDataResults} from "../../baseUT/apr/aprAave3";
import {
  AaveRepayToRebalanceUtils, IAaveMakeRepayToRebalanceResults,
  IMakeRepayToRebalanceResults
} from "../../baseUT/protocols/aaveShared/aaveRepayToRebalanceUtils";
import {
  AaveBorrowToRebalanceUtils,
  IMakeBorrowToRebalanceBadPathParams,
  IMakeBorrowToRebalanceResults
} from "../../baseUT/protocols/aaveShared/aaveBorrowToRebalanceUtils";
import {
  IMakeRepayRebalanceBadPathParams,
  IMakeRepayToRebalanceInputParams
} from "../../baseUT/protocols/shared/sharedDataTypes";
import {SharedRepayToRebalanceUtils} from "../../baseUT/protocols/shared/sharedRepayToRebalanceUtils";
import {makeInfinityApprove, transferAndApprove} from "../../baseUT/utils/transferUtils";
import {
  Aave3TestUtils,
  IPrepareToBorrowResults,
  IBorrowResults,
  IMakeBorrowOrRepayBadPathsParams
} from "../../baseUT/protocols/aave3/Aave3TestUtils";
import {AdaptersHelper} from "../../baseUT/helpers/AdaptersHelper";
import {TetuConverterApp} from "../../baseUT/helpers/TetuConverterApp";
import {MocksHelper} from "../../baseUT/helpers/MocksHelper";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {areAlmostEqual} from "../../baseUT/utils/CommonUtils";
import {IPoolAdapterStatus} from "../../baseUT/types/BorrowRepayDataTypes";
import {Aave3ChangePricesUtils} from "../../baseUT/protocols/aave3/Aave3ChangePricesUtils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {controlGasLimitsEx} from "../../../scripts/utils/hardhatUtils";
import {GAS_FULL_REPAY, GAS_LIMIT} from "../../baseUT/GasLimit";
import {IMakeRepayBadPathsParams} from "../../baseUT/protocols/aaveShared/aaveBorrowUtils";
import {RepayUtils} from "../../baseUT/protocols/shared/repayUtils";

describe("Aave3PoolAdapterUnitTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let deployer: SignerWithAddress;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
  });

  after(async function () {
    await TimeUtils.rollback(snapshot);
  });
//endregion before, after

//region Initial fixtures
  /**
   * Create TetuConverter app instance with default configuration,
   * no platform adapters and no assets are registered.
   */
  async function createControllerDefaultFixture() : Promise<ConverterController> {
    return  TetuConverterApp.createController(deployer);
  }
//endregion Initial fixtures

//region Unit tests
  describe("salvage", () => {
    const receiver = ethers.Wallet.createRandom().address;
    let snapshotLocal: string;
    before(async function () {
      snapshotLocal = await TimeUtils.snapshot();
    });
    after(async function () {
      await TimeUtils.rollback(snapshotLocal);
    });

    interface IPrepareResults {
      init: IPrepareToBorrowResults;
      governance: string;
    }
    async function prepare() : Promise<IPrepareResults> {
      const controller = await loadFixture(createControllerDefaultFixture);
      const collateralToken = await TokenDataTypes.Build(deployer, MaticAddresses.USDC);
      const borrowToken = await TokenDataTypes.Build(deployer, MaticAddresses.USDT);
      const init = await Aave3TestUtils.prepareToBorrow(
        deployer,
        controller,
        collateralToken,
        [MaticAddresses.HOLDER_USDC],
        parseUnits("1", collateralToken.decimals),
        borrowToken,
        false,
      );
      const governance = await init.controller.governance();
      return {init, governance};
    }
    async function salvageToken(
      p: IPrepareResults,
      tokenAddress: string,
      holder: string,
      amountNum: string,
      caller?: string
    ) : Promise<number>{
      const token = await IERC20Metadata__factory.connect(tokenAddress, deployer);
      const decimals = await token.decimals();
      const amount = parseUnits(amountNum, decimals);
      await BalanceUtils.getRequiredAmountFromHolders(amount, token,[holder], p.init.aavePoolAdapterAsTC.address);
      await p.init.aavePoolAdapterAsTC.connect(await Misc.impersonate(caller || p.governance)).salvage(receiver, tokenAddress, amount);
      return +formatUnits(await token.balanceOf(receiver), decimals);
    }
    describe("Good paths", () => {
      it("should salvage collateral asset", async () => {
        const controller = await TetuConverterApp.createController(deployer);
        const collateralToken = await TokenDataTypes.Build(deployer, MaticAddresses.USDC);
        const borrowToken = await TokenDataTypes.Build(deployer, MaticAddresses.USDT);
        // const init = await Aave3TestUtils.prepareToBorrow(
        //   deployer,
        //   controller,
        //   collateralToken,
        //   [MaticAddresses.HOLDER_USDC],
        //   parseUnits("1", collateralToken.decimals),
        //   borrowToken,
        //   false,
        // );
        // expect(await salvageToken(p, MaticAddresses.USDC, MaticAddresses.HOLDER_USDC, "800")).eq(800);
      });
      it.skip("should salvage borrow asset", async () => {
        const p = await loadFixture(prepare);
        expect(await salvageToken(p, MaticAddresses.USDT, MaticAddresses.HOLDER_USDT, "800")).eq(800);
      });
    });
  });
//endregion Unit tests

});
