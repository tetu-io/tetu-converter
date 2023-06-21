import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ConverterController, IERC20Metadata__factory, IPoolAdapter__factory} from "../../../typechain";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {TetuConverterApp} from "../../baseUT/helpers/TetuConverterApp";
import {TokenDataTypes} from "../../baseUT/types/TokenDataTypes";
import {BigNumber} from "ethers";
import {
  IBorrowAndRepayBadParams,
  IMakeBorrowAndRepayResults
} from "../../baseUT/protocols/aaveShared/aaveBorrowAndRepayUtils";
import {Aave3TestUtils} from "../../baseUT/protocols/aave3/Aave3TestUtils";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {IUserBalances} from "../../baseUT/utils/BalanceUtils";
import {transferAndApprove} from "../../baseUT/utils/transferUtils";
import {GAS_LIMIT} from "../../baseUT/GasLimit";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {parseUnits} from "ethers/lib/utils";

describe("Aave3SingleBlockTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let deployer: SignerWithAddress;
  let converterInstance: ConverterController;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    deployer = signers[0];
    converterInstance = await TetuConverterApp.createController(deployer);
  });

  after(async function () {
    await TimeUtils.rollback(snapshot);
  });
//endregion before, after

//region Unit tests
  describe("study: two repay per single block @skip-on-coverage", () => {

    /* Make full or partial repay. Set amountToRepay for partial repay, leave it undefined to full repay */
    async function makeBorrowAndRepay(
      collateralToken: TokenDataTypes,
      collateralHolder: string,
      collateralAmountRequired: BigNumber | undefined,
      borrowToken: TokenDataTypes,
      borrowHolder: string,
      amountToRepay: BigNumber,
      initialBorrowAmountOnUserBalance: BigNumber,
    ) : Promise<IMakeBorrowAndRepayResults>{
      const d = await Aave3TestUtils.prepareToBorrow(
        deployer,
        converterInstance,
        collateralToken,
        [collateralHolder],
        collateralAmountRequired,
        borrowToken,
        false
      );
      const collateralData = await d.h.getReserveInfo(deployer, d.aavePool, d.dataProvider, collateralToken.address);
      console.log("collateralAmountRequired", collateralAmountRequired);
      console.log("d.collateralAmount", d.collateralAmount);
      console.log("borrowAmount", d.amountToBorrow);

      await borrowToken.token
        .connect(await DeployerUtils.startImpersonate(borrowHolder))
        .transfer(d.userContract.address, initialBorrowAmountOnUserBalance);

      const beforeBorrow: IUserBalances = {
        collateral: await collateralToken.token.balanceOf(d.userContract.address),
        borrow: await borrowToken.token.balanceOf(d.userContract.address)
      };

      // make borrow
      await transferAndApprove(
        collateralToken.address,
        d.userContract.address,
        await d.controller.tetuConverter(),
        d.collateralAmount,
        d.aavePoolAdapterAsTC.address
      );

      await d.aavePoolAdapterAsTC.borrow(d.collateralAmount, d.amountToBorrow, d.userContract.address, {gasLimit: GAS_LIMIT});

      const afterBorrow: IUserBalances = {
        collateral: await collateralToken.token.balanceOf(d.userContract.address),
        borrow: await borrowToken.token.balanceOf(d.userContract.address)
      };
      console.log("afterBorrow", afterBorrow);

      await TimeUtils.advanceNBlocks(1000);

      await d.userContract.makeRepayCompleteTwoSteps(collateralToken.address, borrowToken.address, d.userContract.address, amountToRepay);

      // check results
      const afterRepay: IUserBalances = {
        collateral: await collateralToken.token.balanceOf(d.userContract.address),
        borrow: await borrowToken.token.balanceOf(d.userContract.address)
      };

      const ret = await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address);

      return {
        userBalancesBeforeBorrow: beforeBorrow,
        userBalancesAfterBorrow: afterBorrow,
        userBalancesAfterRepay: afterRepay,
        paATokensBalance: await IERC20Metadata__factory.connect(collateralData.data.aTokenAddress, deployer)
          .balanceOf(d.aavePoolAdapterAsTC.address),
        totalCollateralBase: ret.totalCollateralBase,
        totalDebtBase: ret.totalDebtBase,
        poolAdapter: d.aavePoolAdapterAsTC.address,
        collateralAmount: d.collateralAmount,
        borrowAmount: d.amountToBorrow
      }
    }

    it("should make both repay successfully", async() => {
      const collateralAsset = MaticAddresses.USDC;
      const borrowAsset = MaticAddresses.DAI;

      const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
      const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

      const r = await makeBorrowAndRepay(
        collateralToken,
        MaticAddresses.HOLDER_USDC,
        parseUnits("10000", 6),
        borrowToken,
        MaticAddresses.HOLDER_DAI,
        parseUnits("10", 18),
        parseUnits("100", 18)
      );
      console.log("Results", r)
    })
  });

//endregion Unit tests
});