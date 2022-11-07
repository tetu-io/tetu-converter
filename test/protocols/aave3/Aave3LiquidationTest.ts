import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {expect} from "chai";
import {Aave3TestUtils, IPrepareToBorrowResults} from "../../baseUT/protocols/aave3/Aave3TestUtils";
import {TokenDataTypes} from "../../baseUT/types/TokenDataTypes";
import {BigNumber} from "ethers";
import {IPoolAdapterStatus} from "../../baseUT/types/BorrowRepayDataTypes";
import {Aave3ChangePricesUtils} from "../../baseUT/protocols/aave3/Aave3ChangePricesUtils";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";

describe("Aave3LiquidationTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
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

  beforeEach(async function () {
    snapshotForEach = await TimeUtils.snapshot();
  });

  afterEach(async function () {
    await TimeUtils.rollback(snapshotForEach);
  });
//endregion before, after

//region TestImpl
  interface IPrepareToLiquidationResults {
    status: IPoolAdapterStatus
  }

  async function prepareToLiquidation(
    d: IPrepareToBorrowResults,
  ) : Promise<IPrepareToLiquidationResults> {
    // make a borrow
    await Aave3TestUtils.makeBorrow(deployer, d, undefined);

    // reduce price of collateral to reduce health factor below 1
    await Aave3ChangePricesUtils.changeAssetPrice(deployer, d.collateralToken.address, false, 10);

    const status = await d.aavePoolAdapterAsTC.getStatus();
    return {status};
  }
//endregion TestImpl

//region Unit tests
  describe("Make borrow, change prices, make health factor < 1", () => {
    interface IMakeTestLiquidationResults {
      d: IPrepareToBorrowResults;
      results: IPrepareToLiquidationResults;
    }
    async function makeTestLiquidation(
      collateralToken: TokenDataTypes,
      collateralHolder: string,
      collateralAmount: BigNumber,
      borrowToken: TokenDataTypes,
    ) : Promise<IMakeTestLiquidationResults> {
      const d = await Aave3TestUtils.prepareToBorrow(deployer,
        collateralToken,
        [collateralHolder],
        collateralAmount,
        borrowToken,
        false
      );
      const results = await prepareToLiquidation(d);
      return {
        d,
        results
      }
    }
    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;

        const collateralAsset = MaticAddresses.DAI;
        const collateralHolder = MaticAddresses.HOLDER_DAI;
        const borrowAsset = MaticAddresses.WMATIC;

        const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
        const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

        const collateralAmount = getBigNumberFrom(100_000, collateralToken.decimals);

        const ret = await makeTestLiquidation(collateralToken, collateralHolder, collateralAmount, borrowToken);
        const healthFactorNum = Number(ethers.utils.formatUnits(ret.results.status.healthFactor18));
        console.log(ret.results.status);
        expect(healthFactorNum).below(1);
      });
    });
  });
//endregion Unit tests
});