import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {expect} from "chai";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";
import {DeployUtils} from "../../scripts/utils/DeployUtils";
import {
  BorrowManager,
  IERC20__factory,
  MockERC20,
  MockERC20__factory,
  TetuConverter, Borrower, PoolAdapterMock__factory, LendingPlatformMock__factory
} from "../../typechain";
import {IBorrowInputParams, BorrowManagerHelper, IPoolInstanceInfo} from "../baseUT/helpers/BorrowManagerHelper";
import {CoreContracts} from "../baseUT/types/CoreContracts";
import {CoreContractsHelper} from "../baseUT/helpers/CoreContractsHelper";
import {MocksHelper} from "../baseUT/helpers/MocksHelper";
import {DeployerUtils} from "../../scripts/utils/DeployerUtils";
import {BalanceUtils, ContractToInvestigate} from "../baseUT/utils/BalanceUtils";
import {BigNumber} from "ethers";
import {Misc} from "../../scripts/utils/Misc";

describe("TetuConverterTest", () => {
//region Constants
  const BLOCKS_PER_DAY = 6456;
//endregion Constants

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
  async function createTetuConverter(
    tt: IBorrowInputParams
  ) : Promise<{
    tetuConveter: TetuConverter,
    sourceToken: MockERC20,
    targetToken: MockERC20,
    borrowManager: BorrowManager,
    pools: IPoolInstanceInfo[]
  }> {
    const {core, sourceToken, targetToken, pools} = await BorrowManagerHelper.initAppPoolsWithTwoAssets(deployer, tt);

    const tetuConveter = await DeployUtils.deployContract(deployer
      , "TetuConverter", core.controller.address) as TetuConverter;

    return {tetuConveter, sourceToken, targetToken, borrowManager: core.bm, pools};
  }

  async function prepareContracts(
    tt: IBorrowInputParams,
  ) : Promise<{
    core: CoreContracts,
    pools: string[],
    cToken: string,
    userContract: Borrower,
    sourceToken: MockERC20,
    targetToken: MockERC20,
    poolAdapters: string[],
    platformAdapters: string[]
  }>{
    const healthFactor2 = 200;
    const periodInBlocks = 117;

    const {core, sourceToken, targetToken, pools} = await BorrowManagerHelper.initAppPoolsWithTwoAssets(deployer
      , tt
      , async () => (await MocksHelper.createPoolAdapterMock(deployer)).address
    );
    const userContract = await MocksHelper.deployBorrower(deployer.address, core.controller, periodInBlocks);

    let cToken: string | undefined;
    const poolAdapters: string[] = [];
    for (const pi of pools) {
      if (! cToken) {
        cToken = pi.asset2cTokens.get(sourceToken.address) || "";
      }

      // we need to set up a pool adapter
      await core.bm.registerPoolAdapter(
        pi.converter,
        userContract.address,
        sourceToken.address,
        targetToken.address
      );
      const poolAdapter: string = await core.bm.getPoolAdapter(
        pi.converter,
        userContract.address,
        sourceToken.address,
        targetToken.address
      );
      poolAdapters.push(poolAdapter);
      console.log("poolAdapter-mock is configured:", poolAdapter, targetToken.address);
    }

    return {
      core
      , pools: pools.map(x => x.pool)
      , cToken: cToken || ""
      , userContract
      , sourceToken
      , targetToken
      , poolAdapters
      , platformAdapters: pools.map(x => x.platformAdapter)
    };
  }
//endregion Utils

//region Test impl
  /**
   * 1. Create N pools
   * 2. Set initial BR for each pool
   * 3. Make borrow using pool with the lowest BR
   * 2. Chang BR to different values. Now different pool has the lowest BR
   * 5. Call reconvert
   * Borrow should be reconverted to expected pool
   */
  async function makeReconversion(
    tt: IBorrowInputParams,
    sourceAmountNumber: number,
    availableBorrowLiquidityNumber: number,
    mapOldNewBR: Map<string, BigNumber>
  ) : Promise<{
    balancesInitial: Map<string, (BigNumber | string)[]>,
    balancesAfterBorrow: Map<string, (BigNumber | string)[]>,
    balancesAfterReconversion: Map<string, (BigNumber | string)[]>,
    pools: string[],
    poolAdapters: string[],
    borrowsAfterBorrow: string[],
    borrowsAfterReconversion: string[]
  }> {
    const sourceAmount = getBigNumberFrom(sourceAmountNumber, tt.sourceDecimals);
    const availableBorrowLiquidity = getBigNumberFrom(availableBorrowLiquidityNumber, tt.targetDecimals);

    const {core, pools, cToken, userContract, sourceToken, targetToken, poolAdapters, platformAdapters} =
      await prepareContracts(tt);

    console.log("cToken is", cToken);
    console.log("Pool adapters:", poolAdapters.join("\n"));
    console.log("Pools:", pools.join("\n"));

    const contractsToInvestigate: ContractToInvestigate[] = [
      {name: "userContract", contract: userContract.address},
      {name: "tc", contract: core.tc.address},
      ...pools.map( (x, index) => ({name: `pool ${index}`, contract: x})),
      ...poolAdapters.map( (x, index) => ({name: `PA ${index}`, contract: x})),
    ];
    const tokensToInvestigate = [sourceToken.address, targetToken.address, cToken];

    // initialize balances
    await MockERC20__factory.connect(sourceToken.address, deployer).mint(userContract.address, sourceAmount);
    for (const pool of pools) {
      await MockERC20__factory.connect(targetToken.address, deployer).mint(pool, availableBorrowLiquidity);
    }
    // we need to put some amount on user balance - to be able to return debts
    await MockERC20__factory.connect(targetToken.address, deployer).mint(userContract.address, availableBorrowLiquidity);

    // get balances before start
    const balancesInitial = await BalanceUtils.getBalancesObj(deployer, contractsToInvestigate, tokensToInvestigate);
    console.log("before", before);

    // borrow
    await userContract.makeBorrowUC1_1(
      sourceToken.address,
      sourceAmount,
      targetToken.address,
      userContract.address
    );

    // get result balances
    const balancesAfterBorrow = await BalanceUtils.getBalancesObj(deployer, contractsToInvestigate, tokensToInvestigate);

    // get address of PA where the borrow was made
    const borrowsAfterBorrow = await userContract.getBorrows(sourceToken.address, targetToken.address);
    console.log("borrowsAfterBorrow", borrowsAfterBorrow);

    // change borrow rates
    for (let i = 0; i < poolAdapters.length; ++i) {
      // we need to change borrow rate in platform adapter (to select strategy correctly)
      // and in the already created pool adapters (to make new borrow correctly)
      // Probably it worth to move borrow rate to pool stub to avoid possibility of br-unsync
      const platformAdapter = await LendingPlatformMock__factory.connect(platformAdapters[i], deployer);
      const brOld = await platformAdapter.borrowRates(targetToken.address);
      const brNewValue = mapOldNewBR.get(brOld.toString()) || brOld;

      await PoolAdapterMock__factory.connect(poolAdapters[i], deployer).changeBorrowRate(brNewValue);
      await platformAdapter.changeBorrowRate(targetToken.address, brNewValue);
    }

    // reconvert the borrow
    // return borrowed amount to userContract (there are no debts in the mock, so the borrowed amount is enough)
    const status = await PoolAdapterMock__factory.connect(borrowsAfterBorrow[0], deployer).getStatus();
    const borrowTokenAsUser = IERC20__factory.connect(targetToken.address
      , await DeployerUtils.startImpersonate(userContract.address));
    await borrowTokenAsUser.transfer(userContract.address, status.amountToPay);
    console.log(`Borrow token, balance of user contract=${borrowTokenAsUser.balanceOf(userContract.address)}`);
    console.log(`Amount to pay=${(await status).amountToPay}`);

    await userContract.requireReconversion(borrowsAfterBorrow[0]);

    // get address of PA where the new borrow was made
    const borrowsAfterReconversion = await userContract.getBorrows(sourceToken.address, targetToken.address);
    console.log("borrowsAfterReconversion", borrowsAfterReconversion);

    // get result balances
    const balancesAfterReconversion = await BalanceUtils.getBalancesObj(deployer
      , contractsToInvestigate
      , tokensToInvestigate
    );

    return {
      balancesInitial,
      balancesAfterBorrow,
      balancesAfterReconversion,
      poolAdapters,
      pools,
      borrowsAfterBorrow,
      borrowsAfterReconversion,
    }
  }

//endregion Test impl

//region Unit tests
  describe("findBestConversionStrategy", () => {
    describe("Good paths", () => {
      describe("Lending is more efficient", () => {
        describe("Single suitable lending pool", () => {
          it("should return expected data", async () => {
            const period = BLOCKS_PER_DAY * 31;
            const targetDecimals = 12;
            const bestBorrowRate = getBigNumberFrom(1, targetDecimals - 8);

            const healthFactor = 2;
            const sourceAmount = 100_000;
            const input: IBorrowInputParams = {
              collateralFactor: 0.8,
              priceSourceUSD: 0.1,
              priceTargetUSD: 4,
              sourceDecimals: 24,
              targetDecimals: targetDecimals,
              availablePools: [
                {   // source, target
                  borrowRateInTokens: [
                    getBigNumberFrom(0, targetDecimals),
                    bestBorrowRate
                  ],
                  availableLiquidityInTokens: [0, 200_000]
                }
              ]
            };

            const data = await createTetuConverter(input);

            const ret = await data.tetuConveter.findConversionStrategy(
              data.sourceToken.address,
              getBigNumberFrom(sourceAmount, input.sourceDecimals),
              data.targetToken.address,
              getBigNumberFrom(healthFactor, 2),
              period
            );

            const expectedTargetAmount =
              input.collateralFactor
              * sourceAmount * input.priceSourceUSD
              / (input.priceTargetUSD)
              / healthFactor;


            const sret = [
              ret.converter,
              ret.maxTargetAmount,
              ret.aprForPeriod36
            ].join();

            const sexpected = [
              data.pools[0].converter
              , getBigNumberFrom(expectedTargetAmount, input.targetDecimals)
              , bestBorrowRate.mul(period).mul(Misc.WEI)
            ].join();

            expect(sret).equal(sexpected);
          });
        });
      });
      describe("Swap is more efficient", () => {
        it("TODO", async () => {
          expect.fail();
        });
      });
    });
    describe("Bad paths", () => {
      describe("Unsupported source asset", () => {
        it("should return 0", async () => {
          expect.fail();
        });
      });
      describe("Pool don't have enough liquidity", () => {
        it("should return 0", async () => {
          expect.fail();
        });
      });
    });
  });

  describe("convert", () => {
    describe("Good paths", () => {
      describe("UC11, mock", () => {
        it("should update balances in proper way", async () => {
          const user = ethers.Wallet.createRandom().address;
          const targetDecimals = 12;
          const sourceDecimals = 24;
          const sourceAmountNumber = 100_000;
          const availableBorrowLiquidityNumber = 200_000_000;
          const healthFactor = 2;
          const tt: IBorrowInputParams = {
            collateralFactor: 0.8,
            priceSourceUSD: 0.1,
            priceTargetUSD: 4,
            sourceDecimals: sourceDecimals,
            targetDecimals: targetDecimals,
            availablePools: [
              {   // source, target
                borrowRateInTokens: [
                  getBigNumberFrom(0, targetDecimals),
                  getBigNumberFrom(1, targetDecimals - 6), // 1e-6
                ],
                availableLiquidityInTokens: [0, availableBorrowLiquidityNumber]
              }
            ]
          };
          const sourceAmount = getBigNumberFrom(sourceAmountNumber, sourceDecimals);
          const availableBorrowLiquidity = getBigNumberFrom(availableBorrowLiquidityNumber, targetDecimals);

          const {core, pools, cToken, userContract, sourceToken, targetToken, poolAdapters} =
            await prepareContracts(tt);
          const pool = pools[0];
          const poolAdapter = poolAdapters[0];

          console.log("cToken is", cToken);

          const contractsToInvestigate: ContractToInvestigate[] = [
            {name: "userContract", contract: userContract.address},
            {name: "user", contract: user},
            {name: "pool", contract: pool},
            {name: "tc", contract: core.tc.address},
            {name: "poolAdapter", contract: poolAdapter},
          ];
          const tokensToInvestigate = [sourceToken.address, targetToken.address, cToken];

          // initialize balances
          await MockERC20__factory.connect(sourceToken.address, deployer)
            .mint(userContract.address, sourceAmount);
          await MockERC20__factory.connect(targetToken.address, deployer)
            .mint(pool, availableBorrowLiquidity);

          // get balances before start
          const before = await BalanceUtils.getBalances(deployer, contractsToInvestigate, tokensToInvestigate);
          console.log("before", before);

          // borrow
          await userContract.makeBorrowUC1_1(
            sourceToken.address,
            sourceAmount,
            targetToken.address,
            user
          );

          // get result balances
          const after = await BalanceUtils.getBalances(deployer, contractsToInvestigate, tokensToInvestigate);
          console.log("after", after);

          const ret = [...before, "after", ...after].map(x => BalanceUtils.toString(x)).join("\r");

          const expectedTargetAmount = getBigNumberFrom(
            tt.collateralFactor
            * sourceAmountNumber * tt.priceSourceUSD
            / (tt.priceTargetUSD)
            / healthFactor
            , targetDecimals
          );

          const expected = [
            //before
            //userContract, source, target, cToken
            "userContract", sourceAmount, 0, 0,
            //user: source, target, cToken
            "user", 0, 0, 0,
            //pool: source, target, cToken
            "pool", 0, availableBorrowLiquidity, 0,
            //tc: source, target, cToken
            "tc", 0, 0, 0,
            //pa: source, target, cToken
            "poolAdapter", 0, 0, 0,
            "after",
            //after borrowing
            //userContract: source, target, cToken
            "userContract", 0, 0, 0,
            //user: source, target, cToken
            "user", 0, expectedTargetAmount, 0,
            //pool: source, target, cToken
            "pool", sourceAmount, availableBorrowLiquidity.sub(expectedTargetAmount), 0,
            //tc: source, target, cToken
            "tc", 0, 0, 0,
            //pa: source, target, cToken
            "poolAdapter", 0, 0, sourceAmount //!TODO: we assume exchange rate 1:1

          ].map(x => BalanceUtils.toString(x)).join("\r");

          expect(ret).equal(expected);
        });
      });
      describe("UC12, mock", () => {
        it("should update balances in proper way", async () => {
          const user = ethers.Wallet.createRandom().address;
          const period = BLOCKS_PER_DAY * 31;
          const targetDecimals = 12;
          const sourceDecimals = 24;
          const sourceAmountNumber = 100_000;
          const availableBorrowLiquidityNumber = 200_000_000;
          const healthFactor = 2;
          const tt: IBorrowInputParams = {
            collateralFactor: 0.8,
            priceSourceUSD: 0.1,
            priceTargetUSD: 4,
            sourceDecimals: sourceDecimals,
            targetDecimals: targetDecimals,
            availablePools: [
              {   // source, target
                borrowRateInTokens: [
                  getBigNumberFrom(0, targetDecimals),
                  getBigNumberFrom(1, targetDecimals - 6), // 1e-6
                ],
                availableLiquidityInTokens: [0, availableBorrowLiquidityNumber]
              }
            ]
          };
          const sourceAmount = getBigNumberFrom(sourceAmountNumber, sourceDecimals);
          const availableBorrowLiquidity = getBigNumberFrom(availableBorrowLiquidityNumber, targetDecimals);

          const {core, pools, cToken, userContract, sourceToken, targetToken, poolAdapters} =
            await prepareContracts(tt);
          const pool = pools[0];
          const poolAdapter = poolAdapters[0];

          const contractsToInvestigate: ContractToInvestigate[] = [
            {name: "userContract", contract: userContract.address},
            {name: "user", contract: user},
            {name: "pool", contract: pool},
            {name: "tc", contract: core.tc.address},
            {name: "poolAdapter", contract: poolAdapter},
          ];
          const tokensToInvestigate = [sourceToken.address, targetToken.address, cToken];

          // initialize balances
          await MockERC20__factory.connect(sourceToken.address, deployer)
            .mint(userContract.address, sourceAmount);
          await MockERC20__factory.connect(targetToken.address, deployer)
            .mint(pool, availableBorrowLiquidity);

          // get balances before start
          const before = await BalanceUtils.getBalances(deployer, contractsToInvestigate, tokensToInvestigate);
          console.log("before", before);

          // borrow
          await userContract.makeBorrowUC1_1(
            sourceToken.address,
            sourceAmount,
            targetToken.address,
            user
          );

          // repay back immediately
          const targetTokenAsUser = IERC20__factory.connect(targetToken.address
            , await DeployerUtils.startImpersonate(user)
          );
          await targetTokenAsUser.transfer(userContract.address
            , targetTokenAsUser.balanceOf(user)
          );

          // user receives collateral and transfers it back to UserContract to restore same state as before
          await userContract.makeRepayUC1_2(
            sourceToken.address,
            targetToken.address,
            user
          );
          const sourceTokenAsUser = IERC20__factory.connect(sourceToken.address
            , await DeployerUtils.startImpersonate(user)
          );
          await sourceTokenAsUser.transfer(userContract.address
            , sourceAmount
          );

          // get result balances
          const after = await BalanceUtils.getBalances(deployer, contractsToInvestigate, tokensToInvestigate);
          console.log("after", after);

          const ret = [...before, "after", ...after].map(x => BalanceUtils.toString(x)).join("\r");

          const beforeExpected = [
            //before
            //userContract, source, target, cToken
            "userContract", sourceAmount, 0, 0,
            //user: source, target, cToken
            "user", 0, 0, 0,
            //pool: source, target, cToken
            "pool", 0, availableBorrowLiquidity, 0,
            //tc: source, target, cToken
            "tc", 0, 0, 0,
            //pa: source, target, cToken
            "poolAdapter", 0, 0, 0,
          ];

          // balances should be restarted in exactly same state as they were before the borrow
          const expected = [...beforeExpected, "after", ...beforeExpected]
            .map(x => BalanceUtils.toString(x)).join("\r");

          expect(ret).equal(expected);
        });
      });
    });

    describe("Bad paths", () => {
      describe("TODO", () => {
        it("TODO", async () => {
          expect.fail();
        });
      });
    });
  });

  describe("findBorrows", () => {
    describe("Good paths", () => {
      describe("TODO", () => {
        it("should update balance in proper way", async () => {
          expect.fail();
        });
      });
    });

    describe("Bad paths", () => {
      describe("TODO", () => {
        it("TODO", async () => {
          expect.fail();
        });
      });
    });
  });

  describe("reconvert", () => {
    describe("Good paths", () => {
      it("should make reconversion", async () => {
        const sourceAmountNumber = 100_000;
        const availableBorrowLiquidityNumber = 200_000_000;

        const bn0 = BigNumber.from(0);
        const targetDecimals = 12;
        const sourceDecimals = 24;
        // initial borrow rates
        const brPA1 = getBigNumberFrom(3, targetDecimals - 6); //3e-6 (lower)
        const brPA2 = getBigNumberFrom(5, targetDecimals - 6); //5e-6 (higher)
        // changed borrow rates
        const brPA1new = getBigNumberFrom(7, targetDecimals - 6); //7e-6 (higher)
        const brPA2new = getBigNumberFrom(2, targetDecimals - 6); //2e-6 (lower)

        const tt: IBorrowInputParams = {
          collateralFactor: 0.8,
          priceSourceUSD: 0.1,
          priceTargetUSD: 4,
          sourceDecimals: sourceDecimals,
          targetDecimals: targetDecimals,
          availablePools: [
            // POOL 1
            {   // source, target
              borrowRateInTokens: [bn0, brPA1],
              availableLiquidityInTokens: [0, availableBorrowLiquidityNumber]
            },
            // POOL 2
            {   // source, target
              borrowRateInTokens: [bn0, brPA2],
              availableLiquidityInTokens: [0, availableBorrowLiquidityNumber]
            },
          ]
        };
        const mapOldNewBr = new Map<string, BigNumber>();
        mapOldNewBr.set(brPA1.toString(), brPA1new);
        mapOldNewBr.set(brPA2.toString(), brPA2new);

        const ret = await makeReconversion(
          tt,
          sourceAmountNumber,
          availableBorrowLiquidityNumber,
          mapOldNewBr
        );

        const INDEX_BORROW_TOKEN = 1;

        const sret = [
          ret.borrowsAfterBorrow[0] == ret.poolAdapters[0],
          ret.borrowsAfterReconversion[0] == ret.poolAdapters[1],

          // user balance of borrow token
          ret.balancesAfterBorrow.get("userContract")![INDEX_BORROW_TOKEN].toString(),
          ret.balancesAfterReconversion.get("userContract")![INDEX_BORROW_TOKEN].toString(),
        ].join("\n");

        console.log(ret);

        const borrowedAmount = ret.balancesInitial.get("pool 0")![INDEX_BORROW_TOKEN]
          .sub(ret.balancesAfterBorrow.get("pool 0")![INDEX_BORROW_TOKEN]);
        const initialUserBalance = BigNumber.from(ret.balancesInitial.get("userContract")![INDEX_BORROW_TOKEN]);

        const sexpected = [
          true,
          true,

          initialUserBalance.add(borrowedAmount).toString(),
          initialUserBalance.add(borrowedAmount).toString()
        ].join("\n");

        expect(sret).eq(sexpected);
      });
    });
    describe("Bad paths", () => {

    });
  });
//endregion Unit tests
});