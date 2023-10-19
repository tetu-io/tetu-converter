import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {BigNumber} from "ethers";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {AaveTwoHelper} from "../../../../scripts/integration/aaveTwo/AaveTwoHelper";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {TokenDataTypes} from "../../../baseUT/types/TokenDataTypes";
import {transferAndApprove} from "../../../baseUT/utils/transferUtils";
import {AaveTwoTestUtils} from "../../../baseUT/protocols/aaveTwo/AaveTwoTestUtils";
import {parseUnits} from "ethers/lib/utils";
import {GAS_LIMIT} from "../../../baseUT/types/GasLimit";
import {HardhatUtils, POLYGON_NETWORK_ID} from "../../../../scripts/utils/HardhatUtils";
import {TetuConverterApp} from "../../../baseUT/app/TetuConverterApp";
import {ConverterController} from "../../../../typechain";

describe.skip("AaveTwoPoolAdapterIntDustTokensTest (study)", () => {
//region Global vars for all tests
  let snapshot: string;
  let snapshotForEach: string;
  let deployer: SignerWithAddress;
  let converterController: ConverterController;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);

    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];

    converterController = await TetuConverterApp.createController(deployer, {networkId: POLYGON_NETWORK_ID,});
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
  describe("repay, study @skip-on-coverage", () =>{
    interface IMakeBorrowAndRepayDustTokensTestParams {
      collateralAmountRequired?: BigNumber;
      borrowAmountRequired?: BigNumber;
      amountToRepay?: BigNumber,
      borrowRepayDistanceInBlocks?: number;
      initialBorrowAmountOnUserBalance?: BigNumber;
    }
    interface IMakeBorrowAndRepayDustTokensTestResults {
      fullRepayResult: {
        collateralAmountOut: BigNumber;
        returnedBorrowAmountOut: BigNumber;
        swappedLeftoverCollateralOut: BigNumber;
        swappedLeftoverBorrowOut: BigNumber;
      } | undefined;
      totalAmountBorrowAssetRepaid: BigNumber;
      makeRepayCompleteAmountToRepay: BigNumber;
      makeRepayCompletePaidAmount: BigNumber;
    }

    async function makeBorrowAndRepayDustTokensTest(
      collateralToken: TokenDataTypes,
      collateralHolder: string,
      borrowToken: TokenDataTypes,
      borrowHolder: string,
      params: IMakeBorrowAndRepayDustTokensTestParams
    ) : Promise<IMakeBorrowAndRepayDustTokensTestResults>{
      const d = await AaveTwoTestUtils.prepareToBorrow(
        deployer,
        converterController,
        collateralToken,
        collateralHolder,
        params.collateralAmountRequired,
        borrowToken,
      );
      const collateralData = await AaveTwoHelper.getReserveInfo(deployer,
        d.aavePool,
        d.dataProvider,
        collateralToken.address
      );
      const borrowAmount = params.borrowAmountRequired || d.amountToBorrow;

      // put initial amount on user's balance
      if (params.initialBorrowAmountOnUserBalance) {
        await borrowToken.token
          .connect(await DeployerUtils.startImpersonate(borrowHolder))
          .transfer(d.userContract.address, params.initialBorrowAmountOnUserBalance);
      }

      // make borrow
      await transferAndApprove(
        collateralToken.address,
        d.userContract.address,
        await d.controller.tetuConverter(),
        d.collateralAmount,
        d.aavePoolAdapterAsTC.address
      );
      await d.aavePoolAdapterAsTC.borrow(d.collateralAmount, borrowAmount, d.userContract.address, {gasLimit: GAS_LIMIT});
      console.log("borrowAmount", borrowAmount.toString());

      await TimeUtils.advanceNBlocks(params.borrowRepayDistanceInBlocks || 0);

      let fullRepayResult: {
        collateralAmountOut: BigNumber;
        returnedBorrowAmountOut: BigNumber;
        swappedLeftoverCollateralOut: BigNumber;
        swappedLeftoverBorrowOut: BigNumber;
      } | undefined;

      if (params.amountToRepay) {
        const poolAdapterAsCaller = d.aavePoolAdapterAsTC.connect(await DeployerUtils.startImpersonate(deployer.address));

        // make partial repay
        await transferAndApprove(
          borrowToken.address,
          d.userContract.address,
          deployer.address,
          params.amountToRepay,
          d.aavePoolAdapterAsTC.address
        );
        await poolAdapterAsCaller.repay(params.amountToRepay, d.userContract.address, false, {gasLimit: GAS_LIMIT});
      } else {
        fullRepayResult = await d.userContract.callStatic.makeRepayComplete(
          collateralToken.address, borrowToken.address, d.userContract.address
        );
        await d.userContract.makeRepayComplete(collateralToken.address, borrowToken.address, d.userContract.address);
      }

      return {
        fullRepayResult,
        totalAmountBorrowAssetRepaid: await d.userContract.totalAmountBorrowAssetRepaid(),
        makeRepayCompleteAmountToRepay: await d.userContract.makeRepayCompleteAmountToRepay(),
        makeRepayCompletePaidAmount: await d.userContract.makeRepayCompletePaidAmount()
      }
    }

    describe("Borrow max available amount using all available collateral", () => {
      describe("DAI => USDC", () => {
        it("estimate amount of dust tokens", async () => {
          const ret = await makeBorrowAndRepayDustTokensTest(
            await TokenDataTypes.Build(deployer, MaticAddresses.DAI),
            MaticAddresses.HOLDER_DAI,
            await TokenDataTypes.Build(deployer, MaticAddresses.USDC),
            MaticAddresses.HOLDER_USDC,
            {
              borrowRepayDistanceInBlocks: 1, // 100_0000, (!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!)
              initialBorrowAmountOnUserBalance: parseUnits("5000", 6) // it should be enough for repay needs
            }
          );
          console.log(ret);
        });
      });
    });
  });

//endregion Unit tests

});