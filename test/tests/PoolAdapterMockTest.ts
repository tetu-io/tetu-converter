import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {
  BorrowManager__factory,
  CTokenMock__factory,
  IPoolAdapter,
  IPoolAdapter__factory, MockERC20__factory,
  PoolAdapterMock__factory
} from "../../typechain";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {BorrowManagerHelper} from "../baseUT/helpers/BorrowManagerHelper";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";
import {CoreContractsHelper} from "../baseUT/helpers/CoreContractsHelper";
import {MocksHelper} from "../baseUT/helpers/MocksHelper";
import {BalanceUtils, IContractToInvestigate} from "../baseUT/utils/BalanceUtils";

describe("PoolAdapterMock", () => {
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


//endregion Utils

//region Unit tests
  describe("", () => {
    describe("Good paths", () => {
      describe("Borrow and repay", () => {
        it("should set expected state", async () => {
          // create template-pool-adapter
          const priceSourceUSD = 0.1;
          const priceTargetUSD = 2;
          const blocksBetweenBorrowAndRepay = 20;
          const converter = await MocksHelper.createPoolAdapterMock(deployer);
          const bestBorrowRate = 1;
          const tt = BorrowManagerHelper.getBmInputParamsSinglePool(1
            , priceSourceUSD, priceTargetUSD);
          const borrowRatePerBlock18 = getBigNumberFrom(bestBorrowRate, tt.targetDecimals);
          const amountCollateral = getBigNumberFrom(10000, tt.sourceDecimals);
          const amountBorrowLiquidityInPool = getBigNumberFrom(1e10, tt.targetDecimals);
          const amountToBorrow = getBigNumberFrom(100, tt.targetDecimals);
          const amountBorrowedUserInitial = getBigNumberFrom(1000, tt.targetDecimals);

          // create borrow manager (BM) with single pool and DebtMonitor (DM)
          const {core, sourceToken, targetToken, pools} = await BorrowManagerHelper.initAppPoolsWithTwoAssets(deployer
            , tt
            , async () => converter.address
          );

          // register pool adapter
          const pool = pools[0].pool;
          const user = ethers.Wallet.createRandom().address;
          const collateral = sourceToken.address;

          const bmAsTc = BorrowManager__factory.connect(
            core.bm.address,
            await DeployerUtils.startImpersonate(core.tc.address)
          );
          await bmAsTc.registerPoolAdapter(pools[0].converter, user, collateral, targetToken.address);

          // pool adapter is a copy of templatePoolAdapter, created using minimal-proxy pattern
          // this is a mock, we need to configure it
          const poolAdapterAddress = await core.bm.getPoolAdapter(pools[0].converter, user, collateral
            , targetToken.address);
          const cToken = CTokenMock__factory.connect(
            pools[0].asset2cTokens.get(sourceToken.address) || ""
            , deployer
          );

          // get data from the pool adapter
          const pa: IPoolAdapter = IPoolAdapter__factory.connect(
            poolAdapterAddress, await DeployerUtils.startImpersonate(user)
          );
          console.log("Pool adapter", pa.address);
          console.log("User", user);

          // prepare initial balances
          await targetToken.mint(pool, amountBorrowLiquidityInPool);

          await sourceToken.mint(user, amountCollateral);
          console.log("Mint collateral to user", amountCollateral);
          await targetToken.mint(user, amountBorrowedUserInitial);
          console.log("Mint borrowed token to user", amountBorrowedUserInitial);

          const contractsToInvestigate: IContractToInvestigate[] = [
            {name: "user", contract: user},
            {name: "pa", contract: pa.address},
            {name: "pool", contract: pool},
          ];
          const tokensToInvestigate = [sourceToken.address, targetToken.address, cToken.address];

          const before = await BalanceUtils.getBalances(deployer
            , contractsToInvestigate, tokensToInvestigate);
          console.log("Before borrow", before);

          // borrow
          await MockERC20__factory.connect(sourceToken.address, await DeployerUtils.startImpersonate(user))
            .transfer(pa.address, amountCollateral); // user transfers collateral to pool adapter
          console.log("Transfer collateral to PA", amountCollateral);
          await pa.borrow(amountCollateral, amountToBorrow, user);
          console.log("Borrow", amountToBorrow);

          const afterBorrow = await BalanceUtils.getBalances(deployer
            , contractsToInvestigate, tokensToInvestigate);
          console.log("After borrow", afterBorrow);

          // assume, that some time is passed and the borrow debt is increased
          await PoolAdapterMock__factory.connect(pa.address, deployer)
            .setPassedBlocks(blocksBetweenBorrowAndRepay);
          console.log(`amountToBorrow=${amountToBorrow.toString()} blocksBetweenBorrowAndRepay=${blocksBetweenBorrowAndRepay.toString()} borrowRatePerBlock18=${borrowRatePerBlock18.toString()}`);
          const expectedDebt = amountToBorrow
            .mul(blocksBetweenBorrowAndRepay)
            .mul(borrowRatePerBlock18)
            .div(BigNumber.from(10).pow(18));
          console.log("Time passed, blocks=", blocksBetweenBorrowAndRepay, "+debt", expectedDebt);

          // repay immediately
          // how much we should repay?
          const amountToRepay = (await pa.getStatus()).amountToPay;
          console.log("We need to repay", amountToRepay);
          await pa.syncBalance(false);
          await MockERC20__factory.connect(targetToken.address, await DeployerUtils.startImpersonate(user))
            .transfer(pa.address, amountToRepay); // user transfers collateral to pool adapter
          console.log("Transfer borrowed token to PA", amountToRepay);
          await pa.repay(amountToRepay, user, false);

          const afterRepay = await BalanceUtils.getBalances(deployer
            , contractsToInvestigate, tokensToInvestigate);
          console.log("After repay", afterRepay);

          const ret = [...before, "after borrow", ...afterBorrow, "after repay", ...afterRepay]
            .map(x => BalanceUtils.toString(x)).join("\r");

          const expectedAmounts = [
            // before
            // source token, target token, cToken
            "user", amountCollateral, amountBorrowedUserInitial, 0,
            "pa", 0, 0, 0,
            "pool", 0, amountBorrowLiquidityInPool, 0,

            "after borrow",
            // source token, target token, cToken
            "user", 0, amountBorrowedUserInitial.add(amountToBorrow), 0,
            "pa", 0, 0, amountCollateral,
            "pool", amountCollateral, amountBorrowLiquidityInPool.sub(amountToBorrow), 0,

            "after repay",
            "user", amountCollateral, amountBorrowedUserInitial.sub(expectedDebt), 0,
            "pa", 0, 0, 0,
            "pool", 0, amountBorrowLiquidityInPool.add(expectedDebt), 0,
          ];
          const expected = expectedAmounts.map(x => BalanceUtils.toString(x)).join("\r");


          expect(ret).equal(expected);
        });
      });
    });
    describe("Bad paths", () => {
    });
  });
//endregion Unit tests

});