import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {TokenDataTypes} from "../../../baseUT/types/TokenDataTypes";
import {BigNumber} from "ethers";
import {
  IMakeBorrowAndRepayResults
} from "../../../baseUT/protocols/aaveShared/aaveBorrowAndRepayUtils";
import {Aave3TestUtils} from "../../../baseUT/protocols/aave3/Aave3TestUtils";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {BalanceUtils, IUserBalances} from "../../../baseUT/utils/BalanceUtils";
import {transferAndApprove} from "../../../baseUT/utils/transferUtils";
import {GAS_LIMIT} from "../../../baseUT/types/GasLimit";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {parseUnits} from "ethers/lib/utils";
import {HardhatUtils, POLYGON_NETWORK_ID} from "../../../../scripts/utils/HardhatUtils";
import {TetuConverterApp} from "../../../baseUT/app/TetuConverterApp";
import {MaticCore} from "../../../baseUT/chains/maticCore";
import {ConverterController, IERC20Metadata__factory} from "../../../../typechain";

describe("Aave3SingleBlockTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let deployer: SignerWithAddress;
  let converterInstance: ConverterController;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(POLYGON_NETWORK_ID);

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
        MaticCore.getCoreAave3(),
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

      await d.userContract.makeRepayRepay(collateralToken.address, borrowToken.address, d.userContract.address, amountToRepay);

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
  describe("study: repay, borrow per single block @skip-on-coverage", () => {
    /* Make full or partial repay. Set amountToRepay for partial repay, leave it undefined to full repay */
    async function makeBorrowThenRepayBorrow(
      collateralToken: TokenDataTypes,
      collateralHolder: string,
      collateralAmountRequired: BigNumber | undefined,
      borrowToken: TokenDataTypes,
      borrowHolder: string,
      amountToRepay: BigNumber,
      initialBorrowAmountOnUserBalance: BigNumber,
    ) : Promise<IMakeBorrowAndRepayResults> {

      // register AAVE3 pool adapter
      const d = await Aave3TestUtils.prepareToBorrow(
        deployer,
        MaticCore.getCoreAave3(),
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

      // make borrow on AAVE3
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

      // make repay of {amountToRepay} then borrow the same amount in the same block
      await d.userContract.makeRepayBorrow(collateralToken.address, borrowToken.address, d.userContract.address, amountToRepay);

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

    it("should make repay and borrow in the same block successfully", async() => {
      const collateralAsset = MaticAddresses.USDC;
      const borrowAsset = MaticAddresses.USDT;

      const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
      const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

      const r = await makeBorrowThenRepayBorrow(
        collateralToken,
        MaticAddresses.HOLDER_USDC,
        parseUnits("10000", 6),
        borrowToken,
        MaticAddresses.HOLDER_USDT,
        parseUnits("5000", 6),
        parseUnits("7000", 6)
      );
      console.log("Results", r);
    })
  });
  describe("study: borrow, repay per single block @skip-on-coverage", () => {
    /* Make full or partial repay. Set amountToRepay for partial repay, leave it undefined to full repay */
    async function makeBorrowRepay(
      collateralToken: TokenDataTypes,
      collateralHolder: string,
      collateralAmountRequired: BigNumber | undefined,
      borrowToken: TokenDataTypes,
      borrowHolder: string,
      initialBorrowAmountOnUserBalance: BigNumber,
    ) : Promise<IMakeBorrowAndRepayResults> {

      // register AAVE3 pool adapter
      const d = await Aave3TestUtils.prepareToBorrow(
        deployer,
        MaticCore.getCoreAave3(),
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

      // make borrow on AAVE3
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

      // make borrow and repay in the same block on AAVE3
      await BalanceUtils.getAmountFromHolder(collateralToken.address, collateralHolder, d.userContract.address, d.collateralAmount);
      await d.userContract.makeBorrowRepay(collateralToken.address, borrowToken.address, d.userContract.address, d.collateralAmount);

      // check results
      const afterRepay: IUserBalances = {
        collateral: await collateralToken.token.balanceOf(d.userContract.address),
        borrow: await borrowToken.token.balanceOf(d.userContract.address)
      };
      console.log("afterRepay", afterRepay);

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

    it("should NOT be able to make borrow and repay in the same block", async() => {
      const collateralAsset = MaticAddresses.USDC;
      const borrowAsset = MaticAddresses.USDT;

      const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
      const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

      const r = await makeBorrowRepay(
        collateralToken,
        MaticAddresses.HOLDER_USDC,
        parseUnits("10000", 6),
        borrowToken,
        MaticAddresses.HOLDER_USDT,
        parseUnits("8000", 6)
      );
      console.log("Results", r);

      // todo This test should revert with AAVE3 error: SAME_BLOCK_BORROW_REPAY = '48', but it doesn't
    })
  });

//endregion Unit tests
});