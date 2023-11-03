import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {TokenDataTypes} from "../../baseUT/types/TokenDataTypes";
import {Misc} from "../../../scripts/utils/Misc";
import {IAave3UserAccountDataResults} from "../../baseUT/protocols/aave3/aprAave3";
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
  IMakeBorrowParams
} from "../../baseUT/protocols/aave3/Aave3TestUtils";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {areAlmostEqual} from "../../baseUT/utils/CommonUtils";
import {IPoolAdapterStatus} from "../../baseUT/types/BorrowRepayDataTypes";
import {Aave3ChangePricesUtils} from "../../baseUT/protocols/aave3/Aave3ChangePricesUtils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {
  BASE_NETWORK_ID,
  controlGasLimitsEx2,
  HardhatUtils,
  POLYGON_NETWORK_ID
} from "../../../scripts/utils/HardhatUtils";
import {GAS_FULL_REPAY, GAS_LIMIT} from "../../baseUT/types/GasLimit";
import {IMakeRepayBadPathsParams} from "../../baseUT/protocols/aaveShared/aaveBorrowUtils";
import {RepayUtils} from "../../baseUT/protocols/shared/repayUtils";
import {
  Aave3PoolAdapter, Aave3PoolAdapter__factory, Aave3PoolMock,
  Aave3PoolMock__factory, BorrowManager__factory,
  ConverterController, DebtMonitor__factory, IERC20Metadata,
  IERC20Metadata__factory, IPoolAdapter__factory, ITetuConverter__factory
} from "../../../typechain";
import {AdaptersHelper} from "../../baseUT/app/AdaptersHelper";
import {TetuConverterApp} from "../../baseUT/app/TetuConverterApp";
import {MocksHelper} from "../../baseUT/app/MocksHelper";
import {MaticCore} from "../../baseUT/chains/polygon/maticCore";
import {ICoreAave3} from "../../baseUT/protocols/aave3/Aave3DataTypes";
import {BaseAddresses} from "../../../scripts/addresses/BaseAddresses";

describe("Aave3PoolAdapterUnitTest", () => {
//region Test setup
  interface IPairToBorrow {
    collateralAsset: string;
    borrowAsset: string;
    collateralAssetName: string;
    borrowAssetName: string;
    amount: string;
    tag?: string;
    highEfficientMode?: boolean; // false by default
  }

  interface ISinglePair {
    collateralAsset: string;
    borrowAsset: string;
    collateralAssetName: string;
    borrowAssetName: string;
    amount: string;
    smallAmount: string;
    hugeAmount: string;
    collateralHolders: string[];
    borrowHolder: string;
    tag?: string;
  }

  interface ITestSetup {
    aavePool: string;
    pair: ISinglePair;
    pairStable?: ISinglePair;
    pairsToBorrowNormalMode: IPairToBorrow[];
    pairsToBorrowIsolationMode: IPairToBorrow[];
    pairsToBorrowEMode: IPairToBorrow[];
    pairsToBorrowNotUsable: IPairToBorrow[];
  }

  const NETWORKS = [BASE_NETWORK_ID, POLYGON_NETWORK_ID];
  const TEST_SETUPS: Record<number, ITestSetup> = {
    [POLYGON_NETWORK_ID]: {
      aavePool: MaticAddresses.AAVE_V3_POOL,
      pairsToBorrowNormalMode: [
        {collateralAsset: MaticAddresses.DAI, borrowAsset: MaticAddresses.WMATIC, amount: "1000", collateralAssetName: "DAI", borrowAssetName: "WMATIC"},
        {collateralAsset: MaticAddresses.DAI, borrowAsset: MaticAddresses.USDC, amount: "1000", collateralAssetName: "DAI", borrowAssetName: "USDC", highEfficientMode: true},
        {collateralAsset: MaticAddresses.USDC, borrowAsset: MaticAddresses.WBTC, amount: "1000", collateralAssetName: "USDC", borrowAssetName: "WBTC"},
        {collateralAsset: MaticAddresses.USDC, borrowAsset: MaticAddresses.USDT, amount: "1000", collateralAssetName: "USDC", borrowAssetName: "USDT", highEfficientMode: true},
      ],
      pairsToBorrowIsolationMode: [
        {collateralAsset: MaticAddresses.EURS, borrowAsset: MaticAddresses.USDT, amount: "1000", collateralAssetName: "EURS", borrowAssetName: "USDT", highEfficientMode: true}
      ],
      pairsToBorrowEMode: [
        {collateralAsset: MaticAddresses.DAI, borrowAsset: MaticAddresses.USDC, amount: "1000", collateralAssetName: "DAI", borrowAssetName: "USDC", highEfficientMode: true},
      ],
      pairsToBorrowNotUsable: [
        // AaveToken has borrowing = FALSE
        {collateralAsset: MaticAddresses.DAI, borrowAsset: MaticAddresses.AaveToken, amount: "1000", collateralAssetName: "DAI", borrowAssetName: "AaveToken", tag: "borrow asset is not borrowable"},
        // agEUR has liquidation threshold = 0, it means, it cannot be used as collateral
        {collateralAsset: MaticAddresses.agEUR, borrowAsset: MaticAddresses.USDC, amount: "1000", collateralAssetName: "agEUR", borrowAssetName: "USDC", tag: "collateral asset is not usable as collateral"},
        // EURS has not zero isolationModeTotalDebtm, SUSHI has "borrowable in isolation mode" = FALSE
        {collateralAsset: MaticAddresses.EURS, borrowAsset: MaticAddresses.SUSHI, amount: "1000", collateralAssetName: "EURS", borrowAssetName: "SUSHI", tag: "isolation mode is enabled for collateral, borrow token is not borrowable in isolation mode"},
      ],
      pair: {
        collateralAsset: MaticAddresses.DAI,
        borrowAsset: MaticAddresses.WMATIC,
        collateralAssetName: "DAI",
        borrowAssetName: "WMATIC",
        smallAmount: "1",
        amount: "100",
        hugeAmount: "100000000",
        collateralHolders: [
          MaticAddresses.HOLDER_DAI,
          MaticAddresses.HOLDER_DAI_2,
          MaticAddresses.HOLDER_DAI_3,
          MaticAddresses.HOLDER_DAI_4,
          MaticAddresses.HOLDER_DAI_5,
          MaticAddresses.HOLDER_DAI_6,
        ],
        borrowHolder: MaticAddresses.HOLDER_WMATIC
      },
      pairStable: {
        collateralAsset: MaticAddresses.USDC,
        borrowAsset: MaticAddresses.USDT,
        collateralAssetName: "USDC",
        borrowAssetName: "USDT",
        smallAmount: "1",
        amount: "100",
        hugeAmount: "100000000",
        collateralHolders: [
          MaticAddresses.HOLDER_USDC,
          MaticAddresses.HOLDER_USDC_2,
          MaticAddresses.HOLDER_USDC_3,
        ],
        borrowHolder: MaticAddresses.HOLDER_USDT
      }
    },
  //   [BASE_NETWORK_ID]: {
  //   aavePool: BaseAddresses.AAVE_V3_POOL,
  //     pairsToBorrowNormalMode: [
  //     {collateralAsset: BaseAddresses.WETH, borrowAsset: BaseAddresses.cbETH, amount: "1", collateralAssetName: "WETH", borrowAssetName: "cbETH", highEfficientMode: true},
  //     {collateralAsset: BaseAddresses.USDbC, borrowAsset: BaseAddresses.WETH, amount: "1000", collateralAssetName: "USDbC", borrowAssetName: "WETH"},
  //   ],
  //     pairsToBorrowIsolationMode: [],
  //     pairsToBorrowEMode: [
  //     {collateralAsset: BaseAddresses.WETH, borrowAsset: BaseAddresses.cbETH, amount: "1", collateralAssetName: "WETH", borrowAssetName: "cbETH", highEfficientMode: true},
  //   ],
  //     pairsToBorrowNotUsable: [],
  //     pair: {
  //     collateralAsset: BaseAddresses.USDbC,
  //       borrowAsset: BaseAddresses.WETH,
  //       collateralAssetName: "USDbC",
  //       borrowAssetName: "WETH",
  //       smallAmount: "1",
  //       amount: "100",
  //       hugeAmount: "100000",
  //       collateralHolders: [
  //       BaseAddresses.HOLDER_WETH,
  //       BaseAddresses.HOLDER_WETH_1,
  //       BaseAddresses.HOLDER_WETH_2,
  //     ]
  //   },
  //   pairStable: {
  //     collateralAsset: BaseAddresses.WETH,
  //       borrowAsset: BaseAddresses.cbETH,
  //       collateralAssetName: "WETH",
  //       borrowAssetName: "cbETH",
  //       smallAmount: "0.01",
  //       amount: "1",
  //       hugeAmount: "10",
  //       collateralHolders: [
  //       BaseAddresses.HOLDER_WETH,
  //       BaseAddresses.HOLDER_WETH_1,
  //       BaseAddresses.HOLDER_WETH_2,
  //     ]
  //   }
  // },
  }
//endregion Test setup

  NETWORKS.forEach(function (networkId: number) {
    describe(`${networkId}`, function () {
      [TEST_SETUPS[networkId]].forEach(function (testSetup: ITestSetup) {
        if (testSetup) {
          let snapshot: string;
          let deployer: SignerWithAddress;
          let controller: ConverterController;
          let core: ICoreAave3;
          let aavePoolMock: Aave3PoolMock;

          before(async function () {
            await HardhatUtils.setupBeforeTest(networkId);

            this.timeout(1200000);
            snapshot = await TimeUtils.snapshot();
            const signers = await ethers.getSigners();
            deployer = signers[0];

            controller = await TetuConverterApp.createController(deployer, {networkId: POLYGON_NETWORK_ID,});
            core = MaticCore.getCoreAave3();

            aavePoolMock = await MocksHelper.getAave3PoolMock(deployer, testSetup.pair.collateralAsset, testSetup.pair.borrowAsset, core.pool);
          });

          after(async function () {
            await TimeUtils.rollback(snapshot);
          });

          interface IMakeBorrowTestParams extends IMakeBorrowParams {
            collateralAsset: string;
            collateralHolder: string;
            borrowAsset: string;
            collateralAmountStr: string;
          }

          interface IMakeBorrowTestResults {
            init: IPrepareToBorrowResults;
            borrowResults: IBorrowResults;
          }

          describe("Prepare to borrow", () => {
            let init: IPrepareToBorrowResults;
            let snapshotLocal0: string;
            let collateralAsset: IERC20Metadata;
            let borrowAsset: IERC20Metadata;

            before(async function () {
              snapshotLocal0 = await TimeUtils.snapshot();

              collateralAsset = await IERC20Metadata__factory.connect(testSetup.pair.collateralAsset, deployer);
              borrowAsset = await IERC20Metadata__factory.connect(testSetup.pair.borrowAsset, deployer);

              const collateralDecimals = await collateralAsset.decimals();
              init = await Aave3TestUtils.prepareToBorrow(
                  deployer,
                  core,
                  controller,
                  testSetup.pair.collateralAsset,
                  testSetup.pair.collateralHolders,
                  parseUnits(testSetup.pair.amount, collateralDecimals),
                  testSetup.pair.borrowAsset,
                  false,
                  {
                    useAave3PoolMock: aavePoolMock,
                    useMockedAavePriceOracle: true
                  }
              );
            });
            after(async function () {
              await TimeUtils.rollback(snapshotLocal0);
            });

            describe("borrow", () => {
              describe("Good paths", () => {
                let snapshotLevel0: string;
                let borrowResults: IBorrowResults;
                before(async function () {
                  snapshotLevel0 = await TimeUtils.snapshot();
                  borrowResults = await Aave3TestUtils.makeBorrow(deployer, init);
                });
                after(async function () {
                  await TimeUtils.rollback(snapshotLevel0);
                });

                it("should get expected status", async () => {
                  const status = await init.aavePoolAdapterAsTC.getStatus();

                  const collateralTargetHealthFactor2 = await BorrowManager__factory.connect(
                      await init.controller.borrowManager(), deployer
                  ).getTargetHealthFactor2(collateralAsset.address);

                  const ret = [
                    areAlmostEqual(parseUnits(collateralTargetHealthFactor2.toString(), 16), status.healthFactor18),
                    areAlmostEqual(borrowResults.borrowedAmount, status.amountToPay, 4),
                    status.collateralAmountLiquidated.eq(0),
                    status.collateralAmount.eq(parseUnits("1999", await collateralAsset.decimals()))
                  ].join();
                  const expected = [true, true, true, true].join();
                  expect(ret).eq(expected);
                });
                it("should open position in debt monitor", async () => {
                  const ret = await DebtMonitor__factory.connect(
                      await init.controller.debtMonitor(),
                      await DeployerUtils.startImpersonate(init.aavePoolAdapterAsTC.address)
                  ).isPositionOpened();
                  expect(ret).eq(true);
                });
                it("should transfer expected amount to the user", async () => {
                  const receivedBorrowAmount = await borrowAsset.balanceOf(init.userContract.address);
                  expect(receivedBorrowAmount.toString()).eq(borrowResults.borrowedAmount.toString());
                });
                it("should change collateralBalanceATokens", async () => {
                  const collateralBalanceATokens = await init.aavePoolAdapterAsTC.collateralBalanceATokens();
                  const aaveTokensBalance = await IERC20Metadata__factory.connect(
                      init.collateralReserveInfo.aTokenAddress,
                      deployer
                  ).balanceOf(init.aavePoolAdapterAsTC.address);
                  expect(collateralBalanceATokens.eq(aaveTokensBalance)).eq(true);
                });
              });
              describe("Bad paths", () => {
                let snapshotForEach: string;
                beforeEach(async function () {
                  snapshotForEach = await TimeUtils.snapshot();
                });
                afterEach(async function () {
                  await TimeUtils.rollback(snapshotForEach);
                });

                it("should revert if not tetu converter", async () => {
                  await expect(
                      Aave3TestUtils.makeBorrow(deployer, init, {makeOperationAsNotTc: true})
                  ).revertedWith("TC-8 tetu converter only"); // TETU_CONVERTER_ONLY
                });
                it("should revert if the pool doesn't send borrowed amount to pool adapter after borrowing", async () => {
                  await expect(
                      Aave3TestUtils.makeBorrow(deployer, init, {useAave3PoolMock: true, ignoreBorrow: true})
                  ).revertedWith("TC-15 wrong borrow balance"); // WRONG_BORROWED_BALANCE
                });
                it("should revert if the pool doesn't send ATokens to pool adapter after supplying", async () => {
                  await expect(
                      Aave3TestUtils.makeBorrow(deployer, init, {useAave3PoolMock: true, skipSendingATokens: true})
                  ).revertedWith("TC-14 wrong ctokens balance"); // WRONG_DERIVATIVE_TOKENS_BALANCE
                });
              });
            });

            describe("repay", () => {
            interface IMakeRepayTestResults {
              init: IPrepareToBorrowResults;
              borrowResults: IBorrowResults;
              collateralToken: TokenDataTypes;
              borrowToken: TokenDataTypes;
              statusBeforeRepay: IPoolAdapterStatus;
              repayResults: IAave3UserAccountDataResults;
              userBorrowAssetBalanceBeforeRepay: BigNumber;
              userBorrowAssetBalanceAfterRepay: BigNumber;
              repayResultsCollateralAmountOut: BigNumber;
              repayResultsReturnedBorrowAmountOut?: BigNumber;
              statusAfterRepay: IPoolAdapterStatus;
              gasUsed: BigNumber;
            }

            interface IMakeRepayTestParams extends IMakeRepayBadPathsParams {
              collateralAsset: string;
              collateralHolder: string;
              borrowAsset: string;
              borrowHolder: string;
              collateralAmountStr: string;

              /**
               * Amount of debt is X
               * Debt gap is delta.
               * We should pay: X < X + delta * payDebtGapPercent / 100 < X + delta
               */
              payDebtGapPercent?: number;
              /**
               * Make partial repay:
               *    if amountToRepayPart is negative:
               *      total-debt - amountToRepayPart
               *    else
               *      amountToRepayPart
               */
              amountToRepayPart?: string;

              /**
               * Default number is 1000, but we can change it
               */
              countBlocksBetweenBorrowAndRepay?: number;

              useEMode?: boolean;

              targetHealthFactor2?: number;

              setPriceOracleMock?: boolean;

              poolAdapterBorrowBalance?: string;

              setUserAccountData?: {
                totalCollateralBase: BigNumber;
                totalDebtBase: BigNumber;
                availableBorrowsBase: BigNumber;
                currentLiquidationThreshold: BigNumber;
                ltv: BigNumber;
                healthFactor: BigNumber;
              }

              /** Increment both min and target health factor on addon, i.e. 200 + 50 = 250 */
              addonToChangeHealthFactorBeforeRepay?: number;
            }

            async function makeRepay(p: IMakeRepayTestParams): Promise<IMakeRepayTestResults> {
              if (p.setPriceOracleMock) {
                await Aave3ChangePricesUtils.setupPriceOracleMock(deployer, core);
              }
              const collateralToken = await TokenDataTypes.Build(deployer, p.collateralAsset);
              const borrowToken = await TokenDataTypes.Build(deployer, p.borrowAsset);

              const init = await Aave3TestUtils.prepareToBorrow(
                deployer,
                core,
                controller,
                collateralToken.address,
                [p.collateralHolder],
                parseUnits(p.collateralAmountStr, collateralToken.decimals),
                borrowToken.address,
                p.useEMode ?? false,
                {
                  useAave3PoolMock: aavePoolMock,
                  useMockedAavePriceOracle: p?.collateralPriceIsZero,
                  targetHealthFactor2: p?.targetHealthFactor2
                }
              );
              if (p.poolAdapterBorrowBalance) {
                console.log(`push ${p?.poolAdapterBorrowBalance} of borrow asset to pool adapter`);
                await BalanceUtils.getRequiredAmountFromHolders(
                  parseUnits(p.poolAdapterBorrowBalance, borrowToken.decimals),
                  borrowToken.token,
                  [p.borrowHolder],
                  init.aavePoolAdapterAsTC.address
                );
              }
              if (p.usePoolMock) {
                if (p.grabAllBorrowAssetFromSenderOnRepay) {
                  await Aave3PoolMock__factory.connect(init.aavePool.address, deployer).setGrabAllBorrowAssetFromSenderOnRepay();
                }
                if (p.ignoreRepay) {
                  await Aave3PoolMock__factory.connect(init.aavePool.address, deployer).setIgnoreRepay();
                }
                if (p.ignoreWithdraw) {
                  await Aave3PoolMock__factory.connect(init.aavePool.address, deployer).setIgnoreWithdraw();
                }
                if (p.setUserAccountData) {
                  await Aave3PoolMock__factory.connect(init.aavePool.address, deployer).setUserAccountData(
                    p.setUserAccountData.totalCollateralBase,
                    p.setUserAccountData.totalDebtBase,
                    p.setUserAccountData.availableBorrowsBase,
                    p.setUserAccountData.currentLiquidationThreshold,
                    p.setUserAccountData.ltv,
                    p.setUserAccountData.healthFactor
                  )
                }
                if (p.addToHealthFactorAfterRepay) {
                  await Aave3PoolMock__factory.connect(init.aavePool.address, deployer).setHealthFactorAddonAfterRepay(
                    parseUnits(p?.addToHealthFactorAfterRepay, 18)
                  );
                }
              }
              const borrowResults = await Aave3TestUtils.makeBorrow(deployer, init);
              await TimeUtils.advanceNBlocks(p?.countBlocksBetweenBorrowAndRepay || 1000);

              const statusBeforeRepay: IPoolAdapterStatus = await init.aavePoolAdapterAsTC.getStatus();

              const amountToRepay = p?.amountToRepayStr
                ? parseUnits(p?.amountToRepayStr, borrowToken.decimals)
                : p?.payDebtGapPercent
                  ? RepayUtils.calcAmountToRepay(statusBeforeRepay.amountToPay, await init.controller.debtGap(), p.payDebtGapPercent)
                  : p?.amountToRepayPart
                    ? Number(p.amountToRepayPart) > 0
                      ? parseUnits(p.amountToRepayPart, borrowToken.decimals)
                      : statusBeforeRepay.amountToPay.sub(-parseUnits(p.amountToRepayPart, borrowToken.decimals))
                    : undefined;
              await Aave3TestUtils.putDoubleBorrowAmountOnUserBalance(deployer, init, p.borrowHolder);

              const userBorrowAssetBalanceBeforeRepay = await borrowAsset.balanceOf(init.userContract.address);

              if (p.collateralPriceIsZero) {
                await Aave3ChangePricesUtils.setAssetPrice(deployer, core, init.collateralToken, BigNumber.from(0));
                console.log("Collateral price was set to 0");
              }

              if (p.borrowPriceIsZero) {
                await Aave3ChangePricesUtils.setAssetPrice(deployer, core, init.borrowToken, BigNumber.from(0));
                console.log("Borrow price was set to 0");
              }

              if (p.addonToChangeHealthFactorBeforeRepay) {
                // shift health factors (min and target)
                const converterGovernance = await Misc.impersonate(await init.controller.governance());
                const minHealthFactor = await init.controller.minHealthFactor2();
                const targetHealthFactor = await init.controller.targetHealthFactor2();
                await init.controller.connect(converterGovernance).setTargetHealthFactor2(targetHealthFactor + p.addonToChangeHealthFactorBeforeRepay);
                await init.controller.connect(converterGovernance).setMinHealthFactor2(minHealthFactor + p.addonToChangeHealthFactorBeforeRepay);

                // we need to clean custom target factors for the assets in use
                const borrowManager = BorrowManager__factory.connect(await init.controller.borrowManager(), converterGovernance);
                await borrowManager.setTargetHealthFactors(
                  [collateralToken.address, borrowToken.address],
                  [targetHealthFactor + p.addonToChangeHealthFactorBeforeRepay, targetHealthFactor + p.addonToChangeHealthFactorBeforeRepay]
                );
              }

              console.log("make repay");
              const makeRepayResults = await Aave3TestUtils.makeRepay(
                init,
                amountToRepay,
                p.closePosition,
                {
                  makeOperationAsNotTc: p?.makeRepayAsNotTc,
                }
              );
              const userBorrowAssetBalanceAfterRepay = await IERC20Metadata__factory.connect(init.borrowToken, deployer).balanceOf(init.userContract.address);

              return {
                init,
                borrowResults,
                collateralToken,
                borrowToken,
                statusBeforeRepay,
                repayResults: makeRepayResults.userAccountData,
                userBorrowAssetBalanceBeforeRepay,
                userBorrowAssetBalanceAfterRepay,
                repayResultsCollateralAmountOut: makeRepayResults.repayResultsCollateralAmountOut,
                repayResultsReturnedBorrowAmountOut: makeRepayResults.repayResultsReturnedBorrowAmountOut,
                gasUsed: makeRepayResults.gasUsed,
                statusAfterRepay: await init.aavePoolAdapterAsTC.getStatus()
              }
            }

            describe("Good paths", () => {
              describe("closePosition is correctly set to true", () => {
                let snapshotLocal1: string;
                before(async function () {
                  snapshotLocal1 = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshotLocal1);
                });

                async function makeFullRepayTest(): Promise<IMakeRepayTestResults> {
                  return makeRepay({
                    collateralAsset: testSetup.pair.collateralAsset,
                    collateralHolder: testSetup.pair.collateralHolders[0],
                    borrowAsset: testSetup.pair.borrowAsset,
                    borrowHolder: testSetup.pair.borrowHolder,
                    collateralAmountStr: testSetup.pair.amount
                  });
                }

                it("should get expected status", async () => {
                  const results = await loadFixture(makeFullRepayTest);
                  const status = await results.init.aavePoolAdapterAsTC.getStatus();
                  console.log("userBorrowAssetBalanceAfterRepay", results.userBorrowAssetBalanceAfterRepay);
                  console.log("userBorrowAssetBalanceBeforeRepay", results.userBorrowAssetBalanceBeforeRepay);
                  console.log("results.statusBeforeRepay", results.statusBeforeRepay);
                  const ret = [
                    status.healthFactor18.gt(parseUnits("1", 77)),
                    areAlmostEqual(
                      results.userBorrowAssetBalanceBeforeRepay.sub(results.userBorrowAssetBalanceAfterRepay),
                      results.statusBeforeRepay.amountToPay,
                      4
                    ),
                    status.collateralAmountLiquidated.eq(0),
                    status.collateralAmount.eq(0)
                  ].join();
                  const expected = [true, true, true, true].join();
                  expect(ret).eq(expected);
                });
                it("should close position after full repay", async () => {

                  const results = await loadFixture(makeFullRepayTest);
                  const ret = await DebtMonitor__factory.connect(
                    await results.init.controller.debtMonitor(),
                    await DeployerUtils.startImpersonate(results.init.aavePoolAdapterAsTC.address)
                  ).isPositionOpened();
                  expect(ret).eq(false);
                });
                it("should assign expected value to collateralBalanceATokens", async () => {
                  const results = await loadFixture(makeFullRepayTest);
                  const collateralBalanceATokens = await results.init.aavePoolAdapterAsTC.collateralBalanceATokens();
                  const aaveTokensBalance = await IERC20Metadata__factory.connect(
                    results.init.collateralReserveInfo.aTokenAddress,
                    deployer
                  ).balanceOf(results.init.aavePoolAdapterAsTC.address);
                  expect(collateralBalanceATokens.eq(aaveTokensBalance)).eq(true);

                });
                it("should withdraw expected collateral amount", async () => {
                  const results = await loadFixture(makeFullRepayTest);

                  const receivedCollateralAmount = +formatUnits(
                    await results.collateralToken.token.balanceOf(results.init.userContract.address),
                    await collateralAsset.decimals()
                  );
                  const collateralAmount = +formatUnits(results.init.collateralAmount, await collateralAsset.decimals());

                  // Typical values: 1999.0153115049545, 1999
                  expect(receivedCollateralAmount).gte(collateralAmount);
                  expect(receivedCollateralAmount).lte(collateralAmount + 0.1);
                });
                it("should return expected collateral amount", async () => {
                  const results = await loadFixture(makeFullRepayTest);

                  const receivedAmount = +formatUnits(results.repayResultsCollateralAmountOut, await collateralAsset.decimals());
                  const collateralAmount = +formatUnits(results.init.collateralAmount, await collateralAsset.decimals());

                  // Typical values: 1999.0153115049545, 1999
                  expect(receivedAmount).gte(collateralAmount);
                  expect(receivedAmount).lte(collateralAmount + 0.1);
                });
                it("should left zero amount of borrow asset on balance of the pool adapter", async () => {
                  const results = await loadFixture(makeFullRepayTest);

                  const leftover = +formatUnits(
                    await borrowAsset.balanceOf(results.init.aavePoolAdapterAsTC.address),
                    await borrowAsset.decimals()
                  );
                  expect(leftover).eq(0);
                });
                it("should not exceed gas limit @skip-on-coverage", async () => {
                  const results = await loadFixture(makeFullRepayTest);

                  controlGasLimitsEx2(results.gasUsed, GAS_FULL_REPAY, (u, t) => {
                    expect(u).to.be.below(t);
                  });
                });
              });

              /**
               * The situation is following:
               * - pool adapter has debt = X
               * - debt gap is required, so user should pay X + gap
               * - but user has only X + delta, where delta < gap
               * - user calls repay(X + delta, closePosition = false)
               * - In this case pool adapter should check if the debt is paid completely;
               * - if there is no more debt, the position must be closed
               * - the leftover must be returned back to the receiver in any case
               */
              describe("closePosition is false, but actually full debt is paid", () => {
                let snapshotLocal: string;
                before(async function () {
                  snapshotLocal = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshotLocal);
                });

                async function makeFullRepayTest(): Promise<IMakeRepayTestResults> {
                  // debt-gap is 1%, so we need to pay 1000 + 1% = 1010
                  // we have only 1009, so we pay 1009 and use closePosition = false
                  return makeRepay({
                    collateralAsset: testSetup.pair.collateralAsset,
                    collateralHolder: testSetup.pair.collateralHolders[0],
                    borrowAsset: testSetup.pair.borrowAsset,
                    borrowHolder: testSetup.pair.borrowHolder,
                    collateralAmountStr: testSetup.pair.amount,
                    payDebtGapPercent: 80,
                    closePosition: false
                  });
                }

                it("should close the position", async () => {
                  const results = await loadFixture(makeFullRepayTest);
                  expect(results.statusAfterRepay.opened).eq(false);
                });
                it("should return the unused amount to receiver", async () => {
                  const results = await loadFixture(makeFullRepayTest);

                  const amountUsed = +formatUnits(
                    results.userBorrowAssetBalanceBeforeRepay.sub(results.userBorrowAssetBalanceAfterRepay),
                    await borrowAsset.decimals()
                  );
                  const debtAmount = +formatUnits(
                    results.statusBeforeRepay.amountToPay,
                    await borrowAsset.decimals()
                  );

                  // Typical case:
                  // Expected :359.50693634483997
                  // Actual   :359.50694079216674
                  // The difference happens because of borrow rate
                  expect(Math.round(amountUsed * 100)).eq(Math.round(debtAmount * 100));
                });
                it("should withdraw all leftovers to receiver", async () => {
                  const results = await loadFixture(makeFullRepayTest);

                  const leftover = +formatUnits(
                    await borrowAsset.balanceOf(results.init.aavePoolAdapterAsTC.address),
                    await borrowAsset.decimals()
                  );
                  expect(leftover).eq(0);
                });

                it("should return zero collateralAmount", async () => {
                  const results = await loadFixture(makeFullRepayTest);
                  expect(results.statusAfterRepay.collateralAmount.eq(0)).eq(true);
                });
                it("should return zero debt", async () => {
                  const results = await loadFixture(makeFullRepayTest);
                  expect(results.statusAfterRepay.amountToPay.eq(0)).eq(true);
                });
                it("should return very high health factor", async () => {
                  const results = await loadFixture(makeFullRepayTest);
                  expect(results.statusAfterRepay.healthFactor18.gt(parseUnits("1", 77))).eq(true);
                });
                it("should close position after full repay", async () => {

                  const results = await loadFixture(makeFullRepayTest);
                  const isPositionOpened = await DebtMonitor__factory.connect(
                    await results.init.controller.debtMonitor(),
                    await DeployerUtils.startImpersonate(results.init.aavePoolAdapterAsTC.address)
                  ).isPositionOpened();
                  expect(isPositionOpened).eq(false);
                });
                it("should set collateralBalanceATokens to zero", async () => {
                  const results = await loadFixture(makeFullRepayTest);
                  const collateralBalanceATokens = await results.init.aavePoolAdapterAsTC.collateralBalanceATokens();
                  expect(collateralBalanceATokens.eq(0)).eq(true);
                });
                it("should withdraw expected collateral amount", async () => {
                  const results = await loadFixture(makeFullRepayTest);

                  const receivedCollateralAmount = +formatUnits(
                    await results.collateralToken.token.balanceOf(results.init.userContract.address),
                    await collateralAsset.decimals()
                  );
                  const collateralAmount = +formatUnits(results.init.collateralAmount, await collateralAsset.decimals());

                  // Typical values: 1999.0153115049545, 1999
                  expect(receivedCollateralAmount).gte(collateralAmount);
                  expect(receivedCollateralAmount).lte(collateralAmount + 0.1);
                });
                it("should return expected collateral amount", async () => {
                  const results = await loadFixture(makeFullRepayTest);

                  const receivedAmount = +formatUnits(results.repayResultsCollateralAmountOut, await collateralAsset.decimals());
                  const collateralAmount = +formatUnits(results.init.collateralAmount, await collateralAsset.decimals());

                  // Typical values: 1999.0153115049545, 1999
                  expect(receivedAmount).gte(collateralAmount);
                  expect(receivedAmount).lte(collateralAmount + 0.1);
                });
              });

              /**
               *  F.e. if we need to repay $0.000049, debt gap = 1%, amount-to-pay = 0.00004949 == 0.000049 because decimals = 6
               *       in such case MIN_DEBT_GAP_ADDON should be used
               *       we need to add 10 tokens, so amount-to-repay = $0.000059
               */
              // TODO
              // describe("Repay very small amount with tiny debt-gap amount", () => {
              //   let snapshotLocal: string;
              //   before(async function () {
              //     snapshotLocal = await TimeUtils.snapshot();
              //   });
              //   after(async function () {
              //     await TimeUtils.rollback(snapshotLocal);
              //   });
              //
              //   it("Should repay expected amount + tiny debt gap (at most several tokens)", async () => {
              //     const r = await makeRepay({
              //       collateralAsset,
              //       collateralHolder,
              //       borrowAsset,
              //       borrowHolder,
              //       collateralAmountStr: "0.00006"
              //     });
              //     expect(r.statusAfterRepay.opened).eq(false);
              //     const paid = r.userBorrowAssetBalanceBeforeRepay.sub(r.userBorrowAssetBalanceAfterRepay);
              //     const expected = r.statusBeforeRepay.amountToPay;
              //     expect(paid.lt(expected.add(2))).eq(true);
              //   });
              // });

              describe("Pool adapter has not zero balance", () => {
                let snapshotLocal: string;
                before(async function () {
                  snapshotLocal = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshotLocal);
                });

                async function makeFullRepayTest(): Promise<IMakeRepayTestResults> {
                  return makeRepay({
                    collateralAsset: testSetup.pair.collateralAsset,
                    collateralHolder: testSetup.pair.collateralHolders[0],
                    borrowAsset: testSetup.pair.borrowAsset,
                    borrowHolder: testSetup.pair.borrowHolder,
                    collateralAmountStr: testSetup.pair.amount,

                    poolAdapterBorrowBalance: testSetup.pair.amount
                  });
                }

                it("should send all amount from balance to the user", async () => {
                  const results = await loadFixture(makeFullRepayTest);
                  const poolAdapterBalance = +formatUnits(
                    await borrowAsset.balanceOf(results.init.aavePoolAdapterAsTC.address),
                    await borrowAsset.decimals()
                  );
                  const receiverBalance = +formatUnits(
                    await borrowAsset.balanceOf(results.init.userContract.address),
                    await borrowAsset.decimals()
                  );

                  expect(poolAdapterBalance).eq(0);
                  expect(receiverBalance).gt(9999);
                });
              });

              /**
               * Partial repay doesn't change or only slightly change the health factor,
               * so after repay the health factor will be still less than the min threshold.
               * We shouldn't revert in this situation because partial repay can be requested
               * to get amount to rebalance the debt, see SCB-794
               */
              describe("Allow partial repay when health factor is less than min threshold", () => {
                let snapshotLocal: string;
                before(async function () {
                  snapshotLocal = await TimeUtils.snapshot();
                });
                after(async function () {
                  await TimeUtils.rollback(snapshotLocal);
                });

                async function makePartialRepayTest(): Promise<IMakeRepayTestResults> {
                  return makeRepay({
                    collateralAsset: MaticAddresses.DAI,
                    collateralHolder: MaticAddresses.HOLDER_DAI,
                    borrowAsset: MaticAddresses.WMATIC,
                    borrowHolder: MaticAddresses.HOLDER_WMATIC,
                    collateralAmountStr: "1999",
                    amountToRepayPart: "100",
                    targetHealthFactor2: 150,
                    addonToChangeHealthFactorBeforeRepay: 100
                  });
                }

                it("should not change health factor", async () => {
                  const results = await loadFixture(makePartialRepayTest);
                  expect(results.statusAfterRepay.healthFactor18).approximately(results.statusBeforeRepay.healthFactor18, 1e15);
                });
                it("should keep debt opened", async () => {
                  const results = await loadFixture(makePartialRepayTest);
                  expect(results.statusAfterRepay.opened).eq(true);
                });
              });
            });
            describe("Bad paths", () => {
              let snapshotForEach: string;
              beforeEach(async function () {
                snapshotForEach = await TimeUtils.snapshot();
              });
              afterEach(async function () {
                await TimeUtils.rollback(snapshotForEach);
              });

              it("should return exceeded amount if user tries to pay too much", async () => {
                const results = await makeRepay({
                  collateralAsset: testSetup.pair.collateralAsset,
                  collateralHolder: testSetup.pair.collateralHolders[0],
                  borrowAsset: testSetup.pair.borrowAsset,
                  borrowHolder: testSetup.pair.borrowHolder,
                  collateralAmountStr: testSetup.pair.amount,
                  amountToRepayStr: "1500", // amount to repay is ~905, user has 905*2 in total  // todo
                  closePosition: true
                });
                const ret = areAlmostEqual(
                  results.userBorrowAssetBalanceBeforeRepay.sub(results.userBorrowAssetBalanceAfterRepay),
                  results.statusBeforeRepay.amountToPay,
                  4
                );
                expect(ret).eq(true);
              });
              it("should revert if not tetu converter", async () => {
                await expect(
                  makeRepay({
                    collateralAsset: testSetup.pair.collateralAsset,
                    collateralHolder: testSetup.pair.collateralHolders[0],
                    borrowAsset: testSetup.pair.borrowAsset,
                    borrowHolder: testSetup.pair.borrowHolder,
                    collateralAmountStr: testSetup.pair.amount,
                    makeRepayAsNotTc: true,
                    amountToRepayStr: "10" // it's much harder to emulate not-TC call for full repay // todo
                  })
                ).revertedWith("TC-8 tetu converter only"); // TETU_CONVERTER_ONLY
              });
              it("should fail if pay too small amount and try to close the position", async () => {
                await expect(
                  makeRepay({
                    collateralAsset: testSetup.pair.collateralAsset,
                    collateralHolder: testSetup.pair.collateralHolders[0],
                    borrowAsset: testSetup.pair.borrowAsset,
                    borrowHolder: testSetup.pair.borrowHolder,
                    collateralAmountStr: testSetup.pair.amount,
                    amountToRepayStr: "1", // toda
                    closePosition: true
                  })
                ).revertedWith("TC-55 close position not allowed"); // CLOSE_POSITION_PARTIAL
              });
              it("should fail if the debt was completely paid but amount of the debt is still not zero in the pool", async () => {
                await expect(
                  makeRepay({
                    collateralAsset: testSetup.pair.collateralAsset,
                    collateralHolder: testSetup.pair.collateralHolders[0],
                    borrowAsset: testSetup.pair.borrowAsset,
                    borrowHolder: testSetup.pair.borrowHolder,
                    collateralAmountStr: testSetup.pair.amount,
                    usePoolMock: true,
                    ignoreWithdraw: true,
                    ignoreRepay: true
                  })
                ).revertedWith("TC-24 close position failed"); // CLOSE_POSITION_FAILED
              });
              it("should NOT revert if pool has used all amount-to-repay and hasn't sent anything back", async () => {
                const r = await makeRepay({
                  collateralAsset: testSetup.pair.collateralAsset,
                  collateralHolder: testSetup.pair.collateralHolders[0],
                  borrowAsset: testSetup.pair.borrowAsset,
                  borrowHolder: testSetup.pair.borrowHolder,
                  collateralAmountStr: testSetup.pair.amount,
                  usePoolMock: true,
                  grabAllBorrowAssetFromSenderOnRepay: true
                });

                // We emulate a situation
                // when the pool adapter takes all amount-to-repay
                // and doesn't return any amount back
                const balanceBorrowAssetOnMock = await r.borrowToken.token.balanceOf(r.init.aavePool.address);
                expect(balanceBorrowAssetOnMock.gt(0)).eq(true);
              });
              it("should fail if collateral price is zero", async () => {
                await expect(
                  makeRepay({
                    collateralAsset: testSetup.pair.collateralAsset,
                    collateralHolder: testSetup.pair.collateralHolders[0],
                    borrowAsset: testSetup.pair.borrowAsset,
                    borrowHolder: testSetup.pair.borrowHolder,
                    collateralAmountStr: testSetup.pair.amount,
                    setPriceOracleMock: true,
                    collateralPriceIsZero: true,
                    amountToRepayStr: "1" // we need partial-repay mode in this test to avoid calling getStatus in makeRepayComplete // todo
                  })
                ).revertedWith("TC-4 zero price"); // ZERO_PRICE
              });
              it("should fail if borrow price is zero", async () => {
                await expect(
                  makeRepay({
                    collateralAsset: testSetup.pair.collateralAsset,
                    collateralHolder: testSetup.pair.collateralHolders[0],
                    borrowAsset: testSetup.pair.borrowAsset,
                    borrowHolder: testSetup.pair.borrowHolder,
                    collateralAmountStr: testSetup.pair.amount,
                    // we cannot use real pool
                    // because getUserAccountData of the real pool returns zero totalDebtBase when borrow price is zero
                    // and we receive ZERO_BALANCE instead of ZERO_PRICE
                    usePoolMock: true,
                    setPriceOracleMock: true,
                    borrowPriceIsZero: true,
                    amountToRepayStr: "1", // we need partial-repay mode in this test to avoid calling getStatus in makeRepayComplete
                    setUserAccountData: {
                      totalCollateralBase: parseUnits("2", 18),
                      totalDebtBase: parseUnits("2", 18),
                      currentLiquidationThreshold: parseUnits("2", 4),
                      ltv: parseUnits("2", 4),
                      healthFactor: parseUnits("2", 18),
                      availableBorrowsBase: parseUnits("2", 18),
                    }
                  })
                ).revertedWith("TC-4 zero price"); // ZERO_PRICE
              });

              describe("Check _validateHealthFactor", () => {
                describe("State is healthy", () => {
                  describe("repay() reduces health factor by a value greater than the limit", () => {
                    it("should NOT revert", async () => {
                      await makeRepay({
                        collateralAsset: testSetup.pair.collateralAsset,
                        collateralHolder: testSetup.pair.collateralHolders[0],
                        borrowAsset: testSetup.pair.borrowAsset,
                        borrowHolder: testSetup.pair.borrowHolder,
                        collateralAmountStr: testSetup.pair.amount,
                        amountToRepayStr: "1", // todo
                        closePosition: false,
                        usePoolMock: true,

                        // healthFactor before repay = 1999995983650550976
                        // healthFactor after repay =  1901331479680387945
                        // the difference is greater than MAX_ALLOWED_HEALTH_FACTOR_REDUCTION
                        // by healthFactor is also greater than the min thresholds, so - no revert
                        addToHealthFactorAfterRepay: "-0.1"
                      });
                      // not reverted
                    });
                  });
                });
                describe("State is unhealthy", () => {
                  describe("repay() hasn't changed health factor value", () => {
                    it("should NOT revert", async () => {
                      await makeRepay({
                        collateralAsset: testSetup.pair.collateralAsset,
                        collateralHolder: testSetup.pair.collateralHolders[0],
                        borrowAsset: testSetup.pair.borrowAsset,
                        borrowHolder: testSetup.pair.borrowHolder,
                        collateralAmountStr: testSetup.pair.amount,
                        amountToRepayStr: "1", // todo
                        closePosition: false,
                        usePoolMock: true,

                        // the difference of health factor before-after is greater than MAX_ALLOWED_HEALTH_FACTOR_REDUCTION
                        // by healthFactor is also greater than the min thresholds, so - no revert
                        addToHealthFactorAfterRepay: "0"
                      });
                      // not reverted
                    });
                  });
                  describe("repay() reduces health factor by a value lesser than the limit", () => {
                    it("should NOT revert", async () => {
                      await makeRepay({
                        collateralAsset: testSetup.pair.collateralAsset,
                        collateralHolder: testSetup.pair.collateralHolders[0],
                        borrowAsset: testSetup.pair.borrowAsset,
                        borrowHolder: testSetup.pair.borrowHolder,
                        collateralAmountStr: testSetup.pair.amount,
                        amountToRepayStr: "5", // todo
                        closePosition: false,
                        usePoolMock: true,

                        // the difference of health factor before-after is greater than MAX_ALLOWED_HEALTH_FACTOR_REDUCTION
                        // by healthFactor is also greater than the min thresholds, so - no revert
                        addToHealthFactorAfterRepay: "-0.00001"
                      });
                      // not reverted
                    });
                  });
                  describe("repay() reduces health factor by a value greater than the limit", () => {
                    it("should revert", async () => {
                      await expect(
                        makeRepay({
                          collateralAsset: testSetup.pair.collateralAsset,
                          collateralHolder: testSetup.pair.collateralHolders[0],
                          borrowAsset: testSetup.pair.borrowAsset,
                          borrowHolder: testSetup.pair.borrowHolder,
                          collateralAmountStr: testSetup.pair.amount,
                          amountToRepayStr: "5", // todo
                          closePosition: false,
                          usePoolMock: true,
                          addonToChangeHealthFactorBeforeRepay: 100,

                          // the difference of health factor before-after is greater than MAX_ALLOWED_HEALTH_FACTOR_REDUCTION
                          // by healthFactor is also greater than the min thresholds, so - no revert
                          addToHealthFactorAfterRepay: "-0.1"
                        })
                      ).revertedWith("TC-3 wrong health factor"); // WRONG_HEALTH_FACTOR
                    });
                  });
                });
              });
            });
          });

            describe("events", () => {
              let snapshotForEach: string;
              beforeEach(async function () {
                snapshotForEach = await TimeUtils.snapshot();
              });

              afterEach(async function () {
                await TimeUtils.rollback(snapshotForEach);
              });

              describe("OnInitialized", () => {
                it("should return expected values", async () => {
                  const collateralAsset = MaticAddresses.DAI;
                  const borrowAsset = MaticAddresses.WMATIC;

                  const userContract = await MocksHelper.deployBorrower(deployer.address, controller, 1000);
                  await controller.connect(await DeployerUtils.startImpersonate(await controller.governance())).setWhitelistValues([userContract.address], true);

                  const converterNormal = (await AdaptersHelper.createAave3PoolAdapter(deployer)).address;
                  const platformAdapter = await AdaptersHelper.createAave3PlatformAdapter(
                      deployer,
                      controller.address,
                      MaticAddresses.AAVE_V3_POOL,
                      converterNormal,
                      (await AdaptersHelper.createAave3PoolAdapterEMode(deployer)).address
                  );

                  const tetuConverterSigner = await DeployerUtils.startImpersonate(await controller.tetuConverter());

                  const borrowManager = BorrowManager__factory.connect(await controller.borrowManager(), deployer);
                  await borrowManager.addAssetPairs(platformAdapter.address, [collateralAsset], [borrowAsset]);

                  const bmAsTc = BorrowManager__factory.connect(await controller.borrowManager(), tetuConverterSigner);

                  // we need to catch event "OnInitialized" of pool adapter ... but we don't know address of the pool adapter yet
                  const tx = await bmAsTc.registerPoolAdapter(converterNormal, userContract.address, collateralAsset, borrowAsset);
                  const cr = await tx.wait();

                  // now, we know the address of the pool adapter...
                  // const aavePoolAdapterAsTC = Aave3PoolAdapter__factory.connect(
                  //   await borrowManager.getPoolAdapter(converterNormal, userContract.address, collateralAsset, borrowAsset),
                  //   tetuConverterSigner
                  // );

                  // ... and so, we can check the event in tricky way, see how to parse event: https://github.com/ethers-io/ethers.js/issues/487
                  const abi = ["event OnInitialized(address controller, address pool, address user, address collateralAsset, address borrowAsset, address originConverter)"];
                  const iface = new ethers.utils.Interface(abi);
                  // // let's find an event with required address
                  // let eventIndex = 0;
                  // for (let i = 0; i < cr.logs.length; ++i) {
                  //   if (cr.logs[i].address === aavePoolAdapterAsTC.address) {
                  //     eventIndex = i;
                  //     break;
                  //   }
                  // }
                  const logOnInitialized = iface.parseLog(cr.logs[2]);
                  const retLog = [
                    logOnInitialized.name,
                    logOnInitialized.args[0],
                    logOnInitialized.args[1],
                    logOnInitialized.args[2],
                    logOnInitialized.args[3],
                    logOnInitialized.args[4],
                    logOnInitialized.args[5],
                  ].join();
                  const expectedLog = [
                    "OnInitialized",
                    controller.address,
                    MaticAddresses.AAVE_V3_POOL,
                    userContract.address,
                    collateralAsset,
                    borrowAsset,
                    converterNormal
                  ].join();
                  expect(retLog).eq(expectedLog);
                });
              });
            });

            describe("getStatus", () => {
              describe("Good paths", () => {
                describe("User has a borrow", () => {
                  let snapshotLocal: string;
                  before(async function () {
                    snapshotLocal = await TimeUtils.snapshot();
                  });
                  after(async function () {
                    await TimeUtils.rollback(snapshotLocal);
                  });

                  interface IStatusTestResults {
                    borrowResults: IBorrowResults;
                    status: IPoolAdapterStatus;
                    collateralTargetHealthFactor2: number;
                  }

                  async function setupUserHasBorrowTest(): Promise<IStatusTestResults> {
                    const collateralAsset = MaticAddresses.DAI;
                    const collateralHolder = MaticAddresses.HOLDER_DAI;
                    const borrowAsset = MaticAddresses.WMATIC;

                    const borrowResults = await Aave3TestUtils.makeBorrow(deployer, init);
                    const status = await init.aavePoolAdapterAsTC.getStatus();

                    const collateralTargetHealthFactor2 = await BorrowManager__factory.connect(
                        await init.controller.borrowManager(),
                        deployer
                    ).getTargetHealthFactor2(collateralAsset);

                    return {borrowResults, status, collateralTargetHealthFactor2};
                  }

                  it("health factor of the borrow equals to target health factor of the collateral", async () => {
                    const r = await loadFixture(setupUserHasBorrowTest);
                    expect(areAlmostEqual(parseUnits(r.collateralTargetHealthFactor2.toString(), 16), r.status.healthFactor18)).eq(true);
                  });
                  it("should return amount-to-pay equal to the borrowed amount (there is no addon for debt-gap here)", async () => {
                    const r = await loadFixture(setupUserHasBorrowTest);
                    expect(areAlmostEqual(r.borrowResults.borrowedAmount, r.status.amountToPay)).eq(true);
                  });
                  it("should return initial collateral amount", async () => {
                    const r = await loadFixture(setupUserHasBorrowTest);
                    expect(areAlmostEqual(r.status.collateralAmount, init.collateralAmount)).eq(true);
                  });
                  it("shouldn't be liquidated", async () => {
                    const r = await loadFixture(setupUserHasBorrowTest);
                    expect(r.status.collateralAmountLiquidated.eq(0)).eq(true);
                  });
                  it("should require debt-gap", async () => {
                    const r = await loadFixture(setupUserHasBorrowTest);
                    expect(r.status.debtGapRequired).eq(true);
                  });
                  it("should be opened", async () => {
                    const r = await loadFixture(setupUserHasBorrowTest);
                    expect(r.status.opened).eq(true);
                  });
                });
                describe("User has not made a borrow", () => {
                  let snapshotLocal: string;
                  before(async function () {
                    snapshotLocal = await TimeUtils.snapshot();
                  });
                  after(async function () {
                    await TimeUtils.rollback(snapshotLocal);
                  });

                  async function setupUserHasBorrowTest(): Promise<IPoolAdapterStatus> {
                    const collateralAsset = MaticAddresses.DAI;
                    const collateralHolder = MaticAddresses.HOLDER_DAI;
                    const borrowAsset = MaticAddresses.WMATIC;

                    const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
                    const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);

                    // we only prepare to borrow, but don't make a borrow
                    const init = await Aave3TestUtils.prepareToBorrow(
                        deployer,
                        core,
                        controller,
                        collateralToken.address,
                        [collateralHolder],
                        parseUnits("999", collateralToken.decimals),
                        borrowToken.address,
                        false
                    );
                    return init.aavePoolAdapterAsTC.getStatus();
                  }

                  it("should return health factor equal to MAX_UINT", async () => {
                    const status = await loadFixture(setupUserHasBorrowTest);
                    expect(status.healthFactor18.eq(Misc.MAX_UINT)).eq(true);
                  });
                  it("should return zero collateral and debt amounts", async () => {
                    const status = await loadFixture(setupUserHasBorrowTest);
                    expect(status.collateralAmount.eq(0)).eq(true);
                    expect(status.amountToPay.eq(0)).eq(true);
                  });
                  it("shouldn't be liquidated", async () => {
                    const status = await loadFixture(setupUserHasBorrowTest);
                    expect(status.collateralAmountLiquidated.eq(0)).eq(true);
                  });
                  it("should require debt-gap", async () => {
                    const status = await loadFixture(setupUserHasBorrowTest);
                    expect(status.debtGapRequired).eq(true);
                  });
                  it("should not be opened", async () => {
                    const status = await loadFixture(setupUserHasBorrowTest);
                    expect(status.opened).eq(false);
                  });
                });
              });
              describe("Bad paths", () => {
                let snapshotForEach: string;
                beforeEach(async function () {
                  snapshotForEach = await TimeUtils.snapshot();
                });
                afterEach(async function () {
                  await TimeUtils.rollback(snapshotForEach);
                });
                it("it should revert if collateral price is zero", async () => {
                  await Aave3TestUtils.makeBorrow(deployer, init, {useMockedAavePriceOracle: true})
                  await Aave3ChangePricesUtils.setAssetPrice(deployer, core, collateralAsset.address, BigNumber.from(0));
                  await expect(
                      init.aavePoolAdapterAsTC.getStatus()
                  ).revertedWith("TC-4 zero price"); // ZERO_PRICE
                });
                it("it should revert if borrow price is zero", async () => {
                  await Aave3TestUtils.makeBorrow(deployer, init, {useMockedAavePriceOracle: true})
                  await Aave3ChangePricesUtils.setAssetPrice(deployer, core, borrowAsset.address, BigNumber.from(0));
                  await expect(
                      init.aavePoolAdapterAsTC.getStatus()
                  ).revertedWith("TC-4 zero price"); // ZERO_PRICE
                });
                /**
                 * Following test is going to improve coverage of getStatus
                 * It covers the following case:
                 *    totalCollateralBase == 0 but totalDebtBase != 0
                 * in return expression
                 */
                it("totalCollateralBase == 0 || totalDebtBase != 0", async () => {
                  const collateralToken = await TokenDataTypes.Build(deployer, MaticAddresses.DAI);
                  const borrowToken = await TokenDataTypes.Build(deployer, MaticAddresses.WMATIC);
                  await Aave3PoolMock__factory.connect(init.aavePool.address, deployer).setUserAccountData(
                      0, // there is no collateral...
                      1, // (!) .. but there is a debt
                      1,
                      1,
                      1,
                      1
                  );
                  const status = await init.aavePoolAdapterAsTC.getStatus();
                  expect(status.opened).eq(true);
                });
              });
            });

            describe("updateBalance", () => {
              let snapshotForEach: string;
              beforeEach(async function () {
                snapshotForEach = await TimeUtils.snapshot();
              });

              afterEach(async function () {
                await TimeUtils.rollback(snapshotForEach);
              });

              it("the function is callable", async () => {
                const collateralAsset = MaticAddresses.DAI;
                const collateralHolder = MaticAddresses.HOLDER_DAI;
                const borrowAsset = MaticAddresses.WMATIC;

                const borrowResults = await Aave3TestUtils.makeBorrow(deployer, init);

                await init.aavePoolAdapterAsTC.updateStatus();
                const statusAfter = await init.aavePoolAdapterAsTC.getStatus();

                // ensure that updateStatus doesn't revert
                expect(statusAfter.opened).eq(true);
              });
            });

            describe("getCollateralAmountToReturn (called by quoteRepay)", () => {
              let snapshotLocal: string;
              before(async function () {
                snapshotLocal = await TimeUtils.snapshot();
              });
              after(async function () {
                await TimeUtils.rollback(snapshotLocal);
              });

              const collateralAsset = MaticAddresses.DAI;
              const collateralHolder = MaticAddresses.HOLDER_DAI;
              const borrowAsset = MaticAddresses.WMATIC;

              async function setupBorrowForTest(): Promise<IBorrowResults> {
                return Aave3TestUtils.makeBorrow(deployer, init);
              }

              describe("Good paths", () => {
                describe("Full repay", () => {
                  it("should return expected values", async () => {

                    const borrowResults = await loadFixture(setupBorrowForTest);
                    const status = await init.aavePoolAdapterAsTC.getStatus();
                    const tetuConverterAsUser = ITetuConverter__factory.connect(
                        await init.controller.tetuConverter(),
                        await DeployerUtils.startImpersonate(init.userContract.address)
                    );
                    const quoteRepayResults = await tetuConverterAsUser.callStatic.quoteRepay(
                        await tetuConverterAsUser.signer.getAddress(),
                        init.collateralToken,
                        init.borrowToken,
                        status.amountToPay
                    );

                    const ret = quoteRepayResults.collateralAmountOut.gte(status.collateralAmount);
                    console.log("ret", quoteRepayResults.collateralAmountOut, status.collateralAmount);
                    expect(ret).eq(true);
                  });
                });
                describe("Partial repay 50%", () => {
                  it("should return expected values", async () => {
                    const borrowResults = await loadFixture(setupBorrowForTest);
                    const status = await init.aavePoolAdapterAsTC.getStatus();
                    const tetuConverterAsUser = ITetuConverter__factory.connect(
                        await init.controller.tetuConverter(),
                        await DeployerUtils.startImpersonate(init.userContract.address)
                    );
                    const quoteRepayResults = await tetuConverterAsUser.callStatic.quoteRepay(
                        await tetuConverterAsUser.signer.getAddress(),
                        init.collateralToken,
                        init.borrowToken,
                        status.amountToPay.div(2) // 50%
                    );

                    const ret = areAlmostEqual(quoteRepayResults.collateralAmountOut.mul(2), status.collateralAmount, 4);
                    console.log("ret", quoteRepayResults.collateralAmountOut.mul(2), status.collateralAmount);
                    expect(ret).eq(true);
                  });
                });
                describe("Partial repay 5%", () => {
                  let snapshotForEach: string;
                  beforeEach(async function () {
                    snapshotForEach = await TimeUtils.snapshot();
                  });

                  afterEach(async function () {
                    await TimeUtils.rollback(snapshotForEach);
                  });
                  it("should return expected values", async () => {
                    const borrowResults = await loadFixture(setupBorrowForTest);
                    const status = await init.aavePoolAdapterAsTC.getStatus();
                    const tetuConverterAsUser = ITetuConverter__factory.connect(
                        await init.controller.tetuConverter(),
                        await DeployerUtils.startImpersonate(init.userContract.address)
                    );
                    const quoteRepayResults = await tetuConverterAsUser.callStatic.quoteRepay(
                        await tetuConverterAsUser.signer.getAddress(),
                        init.collateralToken,
                        init.borrowToken,
                        status.amountToPay.div(20) // 5%
                    );

                    const ret = areAlmostEqual(quoteRepayResults.collateralAmountOut.mul(20), status.collateralAmount, 4);
                    console.log("ret", quoteRepayResults.collateralAmountOut.mul(20), status.collateralAmount);
                    expect(ret).eq(true);
                  });
                });
              });
              describe("Bad paths", () => {
                it("should revert if collateral price is zero", async () => {
                  const borrowResults = await loadFixture(setupBorrowForTest);
                  const priceOracle = await Aave3ChangePricesUtils.setupPriceOracleMock(deployer, core);
                  await priceOracle.setPrices([init.collateralToken], [parseUnits("0")]);

                  await expect(
                      init.aavePoolAdapterAsTC.getCollateralAmountToReturn(1, true)
                  ).revertedWith("TC-4 zero price"); // ZERO_PRICE
                });
              });
            });
          });

          describe("repayToRebalance", () => {
            const minHealthFactorInitial2 = 500;
            const targetHealthFactorInitial2 = 1000;
            const maxHealthFactorInitial2 = 2000;
            const minHealthFactorUpdated2 = 1000 + 300; // we need small addon for bad paths
            const targetHealthFactorUpdated2 = 2000;
            const maxHealthFactorUpdated2 = 4000;

            //region --------------- avoid nested fixtures
            let snapshotRoot: string;
            before(async function () {
              snapshotRoot = await TimeUtils.snapshot();
            });
            after(async function () {
              await TimeUtils.rollback(snapshotRoot);
            });

            //endregion --------------- avoid nested fixtures

            /**
             * Prepare aave3 pool adapter.
             * Set low health factors.
             * Make borrow.
             * Increase health factor twice.
             * Make repay to rebalance.
             */
            async function makeRepayToRebalance(
              controller0: ConverterController,
              p: IMakeRepayToRebalanceInputParams,
              useEMode?: boolean
            ): Promise<IMakeRepayToRebalanceResults> {
              const d = await Aave3TestUtils.prepareToBorrow(
                deployer,
                core,
                controller0,
                p.collateralToken.address,
                [p.collateralHolder],
                p.collateralAmount,
                p.borrowToken.address,
                useEMode ?? false,
                {
                  targetHealthFactor2: targetHealthFactorInitial2,
                  useAave3PoolMock: p?.badPathsParams?.poolMocked
                    ? aavePoolMock
                    : undefined
                }
              );
              const collateralAssetData = await d.h.getReserveInfo(deployer, d.aavePool, d.dataProvider, p.collateralToken.address);
              console.log("collateralAssetData", collateralAssetData);
              const borrowAssetData = await d.h.getReserveInfo(deployer, d.aavePool, d.dataProvider, p.borrowToken.address);
              console.log("borrowAssetData", borrowAssetData);

              // prices of assets in base currency
              const prices = await d.aavePrices.getAssetsPrices([p.collateralToken.address, p.borrowToken.address]);
              console.log("prices", prices);

              // setup low values for all health factors
              await d.controller.setMaxHealthFactor2(maxHealthFactorInitial2);
              await d.controller.setTargetHealthFactor2(targetHealthFactorInitial2);
              await d.controller.setMinHealthFactor2(minHealthFactorInitial2);

              // make borrow
              if (!p.badPathsParams?.skipBorrow) {
                await transferAndApprove(
                  p.collateralToken.address,
                  d.userContract.address,
                  await d.controller.tetuConverter(),
                  d.collateralAmount,
                  d.aavePoolAdapterAsTC.address
                );

                await d.aavePoolAdapterAsTC.borrow(d.collateralAmount, d.amountToBorrow, d.userContract.address, {gasLimit: GAS_LIMIT});
              }

              const afterBorrow: IAave3UserAccountDataResults = await d.aavePool.getUserAccountData(
                d.aavePoolAdapterAsTC.address
              );
              const userBorrowAssetBalanceAfterBorrow = await p.borrowToken.token.balanceOf(d.userContract.address);
              const userCollateralAssetBalanceAfterBorrow = await p.collateralToken.token.balanceOf(d.userContract.address);
              const statusAfterBorrow = await d.aavePoolAdapterAsTC.getStatus();
              console.log("after borrow:",
                afterBorrow,
                userBorrowAssetBalanceAfterBorrow,
                userCollateralAssetBalanceAfterBorrow,
                statusAfterBorrow
              );

              // increase all health factors down on 2 times to have possibility for additional borrow
              if (!p.badPathsParams?.skipHealthFactors2) {
                await d.controller.setMaxHealthFactor2(maxHealthFactorUpdated2);
                await d.controller.setTargetHealthFactor2(targetHealthFactorUpdated2);
                await d.controller.setMinHealthFactor2(minHealthFactorUpdated2);
                console.log("controller", d.controller.address);
                console.log("min", await d.controller.minHealthFactor2());
                console.log("target", await d.controller.targetHealthFactor2());
              }

              // calculate amount-to-repay and (if necessary) put the amount on userContract's balance
              const amountsToRepay = await SharedRepayToRebalanceUtils.prepareAmountsToRepayToRebalance(
                deployer,
                d.amountToBorrow,
                d.collateralAmount,
                d.userContract,
                p
              );

              // make repayment to rebalance
              const poolAdapterSigner = p.badPathsParams?.makeRepayToRebalanceAsDeployer
                ? IPoolAdapter__factory.connect(d.aavePoolAdapterAsTC.address, deployer)
                : d.aavePoolAdapterAsTC;
              await SharedRepayToRebalanceUtils.approveAmountToRepayToUserContract(
                poolAdapterSigner.address,
                p.collateralToken.address,
                p.borrowToken.address,
                amountsToRepay,
                d.userContract.address,
                await d.controller.tetuConverter()
              );

              if (p?.badPathsParams?.poolMocked) {
                if (p?.badPathsParams?.addToHealthFactorAfterRepay) {
                  await Aave3PoolMock__factory.connect(d.aavePool.address, deployer).setHealthFactorAddonAfterRepay(
                    parseUnits(p?.badPathsParams?.addToHealthFactorAfterRepay, 18)
                  );
                }
              }

              console.log("signer is", await poolAdapterSigner.signer.getAddress());
              console.log("amountsToRepay.useCollateral", amountsToRepay.useCollateral);
              console.log("amountsToRepay.amountCollateralAsset", amountsToRepay.amountCollateralAsset);
              await poolAdapterSigner.repayToRebalance(
                amountsToRepay.useCollateral
                  ? amountsToRepay.amountCollateralAsset
                  : amountsToRepay.amountBorrowAsset,
                amountsToRepay.useCollateral
              );

              const afterBorrowToRebalance: IAave3UserAccountDataResults = await d.aavePool.getUserAccountData(
                d.aavePoolAdapterAsTC.address
              );
              const userBorrowAssetBalanceAfterRepayToRebalance = await p.borrowToken.token.balanceOf(d.userContract.address);
              const userCollateralAssetBalanceAfterRepayToRebalance = await p.collateralToken.token.balanceOf(d.userContract.address);
              const statusAfterRepay = await d.aavePoolAdapterAsTC.getStatus();
              console.log("after repay to rebalance:",
                afterBorrowToRebalance,
                userBorrowAssetBalanceAfterRepayToRebalance,
                userCollateralAssetBalanceAfterRepayToRebalance,
                statusAfterRepay
              );

              const userAccountCollateralBalanceAfterBorrow = afterBorrow.totalCollateralBase
                .mul(parseUnits("1", p.collateralToken.decimals))
                .div(prices[0]);
              const userAccountCollateralBalanceAfterRepayToRebalance = afterBorrowToRebalance.totalCollateralBase
                .mul(parseUnits("1", p.collateralToken.decimals))
                .div(prices[0]);
              const userAccountBorrowBalanceAfterBorrow = afterBorrow.totalDebtBase
                .mul(parseUnits("1", p.borrowToken.decimals))
                .div(prices[1]);
              const userAccountBorrowBalanceAfterRepayToRebalance = afterBorrowToRebalance.totalDebtBase
                .mul(parseUnits("1", p.borrowToken.decimals))
                .div(prices[1]);

              return {
                afterBorrow,
                afterBorrowToRebalance,
                userAccountBorrowBalanceAfterBorrow,
                userAccountBorrowBalanceAfterRepayToRebalance,
                userAccountCollateralBalanceAfterBorrow,
                userAccountCollateralBalanceAfterRepayToRebalance,
                expectedBorrowAssetAmountToRepay: amountsToRepay.useCollateral
                  ? BigNumber.from(0)
                  : amountsToRepay.amountBorrowAsset,
                expectedCollateralAssetAmountToRepay: amountsToRepay.useCollateral
                  ? amountsToRepay.amountCollateralAsset
                  : BigNumber.from(0)
              }
            }

            describe("Good paths", () => {
              describe("Repay using borrow asset", () => {
                describe("Dai:WMatic", () => {
                  let snapshotLocal: string;
                  before(async function () {
                    snapshotLocal = await TimeUtils.snapshot();
                  });
                  after(async function () {
                    await TimeUtils.rollback(snapshotLocal);
                  });

                  async function makeDaiWMaticTest(): Promise<IAaveMakeRepayToRebalanceResults> {
                    return AaveRepayToRebalanceUtils.daiWMatic(
                      deployer,
                      controller,
                      makeRepayToRebalance,
                      targetHealthFactorInitial2,
                      targetHealthFactorUpdated2,
                      false
                    );
                  }

                  it("should make health factor almost same to the target value", async () => {
                    const r = await loadFixture(makeDaiWMaticTest);
                    expect(Math.round(+formatUnits(r.healthFactorAfterBorrow18, 16))).eq(targetHealthFactorInitial2);
                    expect(Math.round(+formatUnits(r.healthFactorAfterBorrowToRebalance, 16))).eq(targetHealthFactorUpdated2);
                  });
                  it("should set expected user borrow asset balance", async () => {
                    const r = await loadFixture(makeDaiWMaticTest);
                    expect(areAlmostEqual(r.userBorrowBalance.result, r.userBorrowBalance.expected)).eq(true);
                  });
                  it("should set expected user collateral asset balance", async () => {
                    const r = await loadFixture(makeDaiWMaticTest);
                    expect(areAlmostEqual(r.userCollateralBalance.result, r.userCollateralBalance.expected)).eq(true);
                  });
                });
                describe("USDC:USDT", () => {
                  let snapshotLocal: string;
                  before(async function () {
                    snapshotLocal = await TimeUtils.snapshot();
                  });
                  after(async function () {
                    await TimeUtils.rollback(snapshotLocal);
                  });

                  async function makeUsdcUsdtTest(): Promise<IAaveMakeRepayToRebalanceResults> {
                    return AaveRepayToRebalanceUtils.usdcUsdt(
                      deployer,
                      controller,
                      async (c, p) => makeRepayToRebalance(c, p, true),
                      targetHealthFactorInitial2,
                      targetHealthFactorUpdated2,
                      false
                    );
                  }

                  it("should make health factor almost same to the target value", async () => {
                    const r = await loadFixture(makeUsdcUsdtTest);
                    expect(Math.round(+formatUnits(r.healthFactorAfterBorrow18, 16))).eq(targetHealthFactorInitial2);
                    expect(Math.round(+formatUnits(r.healthFactorAfterBorrowToRebalance, 16))).eq(targetHealthFactorUpdated2);
                  });
                  it("should set expected user borrow asset balance", async () => {
                    const r = await loadFixture(makeUsdcUsdtTest);
                    expect(areAlmostEqual(r.userBorrowBalance.result, r.userBorrowBalance.expected)).eq(true);
                  });
                  it("should set expected user collateral asset balance", async () => {
                    const r = await loadFixture(makeUsdcUsdtTest);
                    expect(areAlmostEqual(r.userCollateralBalance.result, r.userCollateralBalance.expected)).eq(true);
                  });
                });
              });
              describe("Repay using collateral asset", () => {
                describe("Dai:WMatic", () => {
                  let snapshotLocal: string;
                  before(async function () {
                    snapshotLocal = await TimeUtils.snapshot();
                  });
                  after(async function () {
                    await TimeUtils.rollback(snapshotLocal);
                  });

                  async function makeDaiWMaticTest(): Promise<IAaveMakeRepayToRebalanceResults> {
                    return AaveRepayToRebalanceUtils.daiWMatic(
                      deployer,
                      controller,
                      makeRepayToRebalance,
                      targetHealthFactorInitial2,
                      targetHealthFactorUpdated2,
                      true
                    );
                  }

                  it("should make health factor almost same to the target value", async () => {
                    const r = await loadFixture(makeDaiWMaticTest);
                    expect(Math.round(+formatUnits(r.healthFactorAfterBorrow18, 16))).eq(targetHealthFactorInitial2);
                    expect(Math.round(+formatUnits(r.healthFactorAfterBorrowToRebalance, 16))).eq(targetHealthFactorUpdated2);
                  });
                  it("should set expected user borrow asset balance", async () => {
                    const r = await loadFixture(makeDaiWMaticTest);
                    expect(areAlmostEqual(r.userBorrowBalance.result, r.userBorrowBalance.expected)).eq(true);
                  });
                  it("should set expected user collateral asset balance", async () => {
                    const r = await loadFixture(makeDaiWMaticTest);
                    expect(areAlmostEqual(r.userCollateralBalance.result, r.userCollateralBalance.expected)).eq(true);
                  });
                });
                describe("USDC:USDT", () => {
                  let snapshotLocal: string;
                  before(async function () {
                    snapshotLocal = await TimeUtils.snapshot();
                  });
                  after(async function () {
                    await TimeUtils.rollback(snapshotLocal);
                  });

                  async function makeUsdcUsdtTest(): Promise<IAaveMakeRepayToRebalanceResults> {
                    return AaveRepayToRebalanceUtils.usdcUsdt(
                      deployer,
                      controller,
                      async (c, p) => makeRepayToRebalance(c, p, true),
                      targetHealthFactorInitial2,
                      targetHealthFactorUpdated2,
                      true
                    );
                  }

                  it("should make health factor almost same to the target value", async () => {
                    const r = await loadFixture(makeUsdcUsdtTest);
                    expect(Math.round(+formatUnits(r.healthFactorAfterBorrow18, 16))).eq(targetHealthFactorInitial2);
                    expect(Math.round(+formatUnits(r.healthFactorAfterBorrowToRebalance, 16))).eq(targetHealthFactorUpdated2);
                  });
                  it("should set expected user borrow asset balance", async () => {
                    const r = await loadFixture(makeUsdcUsdtTest);
                    expect(areAlmostEqual(r.userBorrowBalance.result, r.userBorrowBalance.expected)).eq(true);
                  });
                  it("should set expected user collateral asset balance", async () => {
                    const r = await loadFixture(makeUsdcUsdtTest);
                    expect(areAlmostEqual(r.userCollateralBalance.result, r.userCollateralBalance.expected)).eq(true);
                  });
                });
              });
            });
            describe("Bad paths", () => {
              let snapshotForEach: string;
              beforeEach(async function () {
                snapshotForEach = await TimeUtils.snapshot();
              });
              afterEach(async function () {
                await TimeUtils.rollback(snapshotForEach);
              });

              async function testRepayToRebalanceDaiWMatic(badPathParams?: IMakeRepayRebalanceBadPathParams) {
                await AaveRepayToRebalanceUtils.daiWMatic(
                  deployer,
                  controller,
                  makeRepayToRebalance,
                  targetHealthFactorInitial2,
                  targetHealthFactorUpdated2,
                  false,
                  badPathParams
                );
              }

              describe("Not TetuConverter", () => {
                it("should revert", async () => {
                  await expect(
                    testRepayToRebalanceDaiWMatic({makeRepayToRebalanceAsDeployer: true})
                  ).revertedWith("TC-8 tetu converter only");
                });
              });
              describe("Position is not registered", () => {
                it("should revert", async () => {
                  await expect(
                    testRepayToRebalanceDaiWMatic({skipBorrow: true})
                  ).revertedWith("TC-40 repay to rebalance not allowed"); // REPAY_TO_REBALANCE_NOT_ALLOWED
                });
              });
              describe("Rebalance is not required", () => {
                describe("RepayToRebalance reduces health factor by a value greater than the limit", () => {
                  it("should NOT revert", async () => {
                    await testRepayToRebalanceDaiWMatic({
                      poolMocked: true,

                      // the state is healthy
                      skipHealthFactors2: true,

                      // healthFactor before repay = 9999999961834189064
                      // healthFactor after repay =  9900000461834485670
                      // the difference is greater than MAX_ALLOWED_HEALTH_FACTOR_REDUCTION
                      // by healthFactor is also greater than the min thresholds, so - no revert

                      additionalAmountCorrectionFactorDiv: 10000000,
                      addToHealthFactorAfterRepay: "-0.1"
                    });
                    // not reverted
                  });
                });
              });
              describe("Result health factor is less min threshold", () => {
                describe("RepayToRebalance hasn't changed health factor value", () => {
                  it("should NOT revert", async () => {
                    await testRepayToRebalanceDaiWMatic({
                      additionalAmountCorrectionFactorDiv: 100
                    });
                    // not reverted
                  });
                });
                describe("RepayToRebalance reduces health factor by a value lesser than the limit", () => {
                  it("should NOT revert", async () => {
                    await testRepayToRebalanceDaiWMatic({
                      poolMocked: true,

                      // healthFactor before repay = 9999999949101140296
                      // healthFactor after repay =  9999990449101434776
                      // the difference is less than MAX_ALLOWED_HEALTH_FACTOR_REDUCTION

                      additionalAmountCorrectionFactorDiv: 10000000,
                      addToHealthFactorAfterRepay: "-0.00001"
                    });
                    // not reverted
                  });
                });
                describe("RepayToRebalance reduces health factor by a value greater than the limit", () => {
                  it("should revert", async () => {
                    await expect(
                      testRepayToRebalanceDaiWMatic({
                        poolMocked: true,

                        // healthFactor before repay = 9999999955468282000
                        // healthFactor after repay =  9900000455468577544
                        // the difference is greater than MAX_ALLOWED_HEALTH_FACTOR_REDUCTION

                        additionalAmountCorrectionFactorDiv: 10000000,
                        addToHealthFactorAfterRepay: "-0.1"
                      })
                    ).revertedWith("TC-3 wrong health factor"); // WRONG_HEALTH_FACTOR
                  });
                });
              });
              describe("Try to repay amount greater then the debt", () => {
                it("should revert", async () => {
                  await expect(
                    testRepayToRebalanceDaiWMatic({additionalAmountCorrectionFactorMul: 100})
                  ).revertedWith("TC-40 repay to rebalance not allowed"); // REPAY_TO_REBALANCE_NOT_ALLOWED
                });
              });
            });
          });

          describe("borrowToRebalance", () => {
            let snapshotForEach: string;
            beforeEach(async function () {
              snapshotForEach = await TimeUtils.snapshot();
            });

            afterEach(async function () {
              await TimeUtils.rollback(snapshotForEach);
            });

            const minHealthFactorInitial2 = 1000;
            const targetHealthFactorInitial2 = 2000;
            const maxHealthFactorInitial2 = 4000;
            const minHealthFactorUpdated2 = 500;
            const targetHealthFactorUpdated2 = 1000;
            const maxHealthFactorUpdated2 = 2000;

            /**
             * Prepare aave3 pool adapter.
             * Set high health factors.
             * Make borrow.
             * Reduce health factor twice.
             * Make additional borrow.
             */
            async function makeBorrowToRebalance(
              controller0: ConverterController,
              collateralToken: TokenDataTypes,
              collateralHolder: string,
              collateralAmount: BigNumber,
              borrowToken: TokenDataTypes,
              borrowHolder: string,
              badPathsParams?: IMakeBorrowToRebalanceBadPathParams
            ): Promise<IMakeBorrowToRebalanceResults> {
              const d = await Aave3TestUtils.prepareToBorrow(
                deployer,
                core,
                controller0,
                collateralToken.address,
                [collateralHolder],
                collateralAmount,
                borrowToken.address,
                false,
                {
                  targetHealthFactor2: targetHealthFactorInitial2,
                  useAave3PoolMock: aavePoolMock
                }
              );
              const collateralAssetData = await d.h.getReserveInfo(deployer, d.aavePool, d.dataProvider, collateralToken.address);
              console.log("collateralAssetData", collateralAssetData);
              const borrowAssetData = await d.h.getReserveInfo(deployer, d.aavePool, d.dataProvider, borrowToken.address);
              console.log("borrowAssetData", borrowAssetData);

              const collateralFactor = collateralAssetData.data.ltv;
              console.log("collateralFactor", collateralFactor);

              // prices of assets in base currency
              const prices = await d.aavePrices.getAssetsPrices([collateralToken.address, borrowToken.address]);
              console.log("prices", prices);

              // setup high values for all health factors
              await d.controller.setMaxHealthFactor2(maxHealthFactorInitial2);
              await d.controller.setTargetHealthFactor2(targetHealthFactorInitial2);
              await d.controller.setMinHealthFactor2(minHealthFactorInitial2);

              // make borrow
              const amountToBorrow = d.amountToBorrow;
              if (!badPathsParams?.skipBorrow) {
                await transferAndApprove(
                  collateralToken.address,
                  d.userContract.address,
                  await d.controller.tetuConverter(),
                  d.collateralAmount,
                  d.aavePoolAdapterAsTC.address
                );

                await d.aavePoolAdapterAsTC.borrow(collateralAmount, amountToBorrow, d.userContract.address, {gasLimit: GAS_LIMIT});
              }
              const afterBorrow: IAave3UserAccountDataResults = await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address);
              const userBalanceAfterBorrow = await borrowToken.token.balanceOf(d.userContract.address);
              console.log("after borrow:", afterBorrow, userBalanceAfterBorrow);

              // reduce all health factors down on 2 times to have possibility for additional borrow
              await d.controller.setMinHealthFactor2(minHealthFactorUpdated2);
              await d.controller.setTargetHealthFactor2(targetHealthFactorUpdated2);
              await d.controller.setMaxHealthFactor2(maxHealthFactorUpdated2);

              const expectedAdditionalBorrowAmount = amountToBorrow.mul(
                badPathsParams?.additionalAmountCorrectionFactor
                  ? badPathsParams.additionalAmountCorrectionFactor
                  : 1
              );
              console.log("expectedAdditionalBorrowAmount", expectedAdditionalBorrowAmount);

              // make additional borrow
              if (badPathsParams?.useAavePoolMock && badPathsParams?.aavePoolMockSkipsBorrowInBorrowToRebalance) {
                // pool doesn't make borrow and so doesn't send additional borrow asset us
                // we should get WRONG_BORROWED_BALANCE exception
                await Aave3PoolMock__factory.connect(d.aavePool.address, deployer).setIgnoreBorrow();
              }

              const poolAdapterSigner = badPathsParams?.makeBorrowToRebalanceAsDeployer
                ? IPoolAdapter__factory.connect(d.aavePoolAdapterAsTC.address, deployer)
                : d.aavePoolAdapterAsTC;
              await poolAdapterSigner.borrowToRebalance(
                expectedAdditionalBorrowAmount,
                d.userContract.address // receiver
              );

              const afterBorrowToRebalance: IAave3UserAccountDataResults = await d.aavePool.getUserAccountData(d.aavePoolAdapterAsTC.address);
              const userBalanceAfterBorrowToRebalance = await borrowToken.token.balanceOf(d.userContract.address);
              console.log("after borrow to rebalance:", afterBorrowToRebalance, userBalanceAfterBorrowToRebalance);

              return {
                afterBorrow,
                afterBorrowToRebalance,
                userBalanceAfterBorrow,
                userBalanceAfterBorrowToRebalance,
                expectedAdditionalBorrowAmount
              }
            }

            describe("Good paths", () => {
              it("should return expected values", async () => {
                const r = await AaveBorrowToRebalanceUtils.testDaiWMatic(
                  deployer,
                  controller,
                  makeBorrowToRebalance,
                  targetHealthFactorInitial2,
                  targetHealthFactorUpdated2
                );

                expect(r.ret).eq(r.expected);
              });
            });
            describe("Bad paths", () => {
              async function testDaiWMatic(badPathsParams?: IMakeBorrowToRebalanceBadPathParams) {
                await AaveBorrowToRebalanceUtils.testDaiWMatic(
                  deployer,
                  controller,
                  makeBorrowToRebalance,
                  targetHealthFactorInitial2,
                  targetHealthFactorUpdated2,
                  badPathsParams
                );
              }

              it("should revert if not tetu-converter", async () => {
                await expect(
                  testDaiWMatic({makeBorrowToRebalanceAsDeployer: true})
                ).revertedWith("TC-8 tetu converter only");
              });
              it("should revert if the position is not registered", async () => {
                await expect(
                  testDaiWMatic({skipBorrow: true})
                ).revertedWith("TC-11 position not registered");
              });
              it("should revert if result health factor is less than min allowed one", async () => {
                await expect(
                  testDaiWMatic({additionalAmountCorrectionFactor: 10})
                ).revertedWith("TC-3 wrong health factor"); // WRONG_HEALTH_FACTOR
              });
              it("should revert pool hasn't sent borrowed amount to the pool adapter", async () => {
                await expect(
                  testDaiWMatic({
                    useAavePoolMock: true,
                    aavePoolMockSkipsBorrowInBorrowToRebalance: true
                  })
                ).revertedWith("TC-15 wrong borrow balance"); // WRONG_BORROWED_BALANCE
              });
            });
          });

          describe("initialize", () => {
            let snapshotForEach: string;
            beforeEach(async function () {
              snapshotForEach = await TimeUtils.snapshot();
            });

            afterEach(async function () {
              await TimeUtils.rollback(snapshotForEach);
            });

            interface IInitializePoolAdapterBadPaths {
              zeroController?: boolean;
              zeroUser?: boolean;
              zeroCollateralAsset?: boolean;
              zeroBorrowAsset?: boolean;
              zeroConverter?: boolean;
              zeroPool?: boolean;
            }

            interface IMakeInitializePoolAdapterResults {
              user: string;
              converter: string;
              collateralAsset: string;
              borrowAsset: string;
              controller: ConverterController;
              poolAdapter: Aave3PoolAdapter;
            }

            async function makeInitializePoolAdapter(
              useEMode: boolean,
              badParams?: IInitializePoolAdapterBadPaths
            ): Promise<IMakeInitializePoolAdapterResults> {
              const user = ethers.Wallet.createRandom().address;
              const collateralAsset = (await MocksHelper.createMockedCToken(deployer)).address;
              const borrowAsset = (await MocksHelper.createMockedCToken(deployer)).address;
              const converter = ethers.Wallet.createRandom().address;

              const poolAdapter = useEMode
                ? await AdaptersHelper.createAave3PoolAdapterEMode(deployer)
                : await AdaptersHelper.createAave3PoolAdapter(deployer);

              await poolAdapter.initialize(
                badParams?.zeroController ? Misc.ZERO_ADDRESS : controller.address,
                badParams?.zeroPool ? Misc.ZERO_ADDRESS : MaticAddresses.AAVE_V3_POOL,
                badParams?.zeroUser ? Misc.ZERO_ADDRESS : user,
                badParams?.zeroCollateralAsset ? Misc.ZERO_ADDRESS : collateralAsset,
                badParams?.zeroBorrowAsset ? Misc.ZERO_ADDRESS : borrowAsset,
                badParams?.zeroConverter ? Misc.ZERO_ADDRESS : converter
              );

              return {
                user,
                poolAdapter,
                borrowAsset,
                converter,
                collateralAsset,
                controller
              }
            }

            async function makeInitializePoolAdapterTest(
              useEMode: boolean,
              badParams?: IInitializePoolAdapterBadPaths
            ): Promise<{ ret: string, expected: string }> {
              const d = await makeInitializePoolAdapter(useEMode, badParams);
              const poolAdapterConfigAfter = await d.poolAdapter.getConfig();
              const ret = [
                poolAdapterConfigAfter.origin,
                poolAdapterConfigAfter.outUser,
                poolAdapterConfigAfter.outCollateralAsset,
                poolAdapterConfigAfter.outBorrowAsset
              ].join();
              const expected = [
                d.converter,
                d.user,
                d.collateralAsset,
                d.borrowAsset
              ].join();
              return {ret, expected};
            }

            describe("Good paths", () => {
              it("Normal mode: should return expected values", async () => {
                const r = await makeInitializePoolAdapterTest(false);
                expect(r.ret).eq(r.expected);
              });
              it("EMode: should return expected values", async () => {
                const r = await makeInitializePoolAdapterTest(false);
                expect(r.ret).eq(r.expected);
              });
            });
            describe("Bad paths", () => {
              it("should revert on zero controller", async () => {
                await expect(
                  makeInitializePoolAdapterTest(
                    false,
                    {zeroController: true}
                  )
                ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
              });
              it("should revert on zero user", async () => {
                await expect(
                  makeInitializePoolAdapterTest(
                    false,
                    {zeroUser: true}
                  )
                ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
              });
              it("should revert on zero pool", async () => {
                await expect(
                  makeInitializePoolAdapterTest(
                    false,
                    {zeroPool: true}
                  )
                ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
              });
              it("should revert on zero converter", async () => {
                await expect(
                  makeInitializePoolAdapterTest(
                    false,
                    {zeroConverter: true}
                  )
                ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
              });
              it("should revert on zero collateral asset", async () => {
                await expect(
                  makeInitializePoolAdapterTest(
                    false,
                    {zeroCollateralAsset: true}
                  )
                ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
              });
              it("should revert on zero borrow asset", async () => {
                await expect(
                  makeInitializePoolAdapterTest(
                    false,
                    {zeroBorrowAsset: true}
                  )
                ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
              });
              it("should revert on second initialization", async () => {
                const d = await makeInitializePoolAdapter(false);
                await expect(
                  d.poolAdapter.initialize(
                    d.controller.address,
                    MaticAddresses.AAVE_V3_POOL,
                    d.user,
                    d.collateralAsset,
                    d.borrowAsset,
                    d.converter
                  )
                ).revertedWith("Initializable: contract is already initialized");
              });
            });
          });

          describe("claimRewards", () => {
            let snapshotForEach: string;
            beforeEach(async function () {
              snapshotForEach = await TimeUtils.snapshot();
            });

            afterEach(async function () {
              await TimeUtils.rollback(snapshotForEach);
            });

            it("should return expected values", async () => {
              const receiver = ethers.Wallet.createRandom().address;
              const d = await Aave3TestUtils.prepareToBorrow(
                deployer,
                core,
                controller,
                MaticAddresses.DAI,
                [MaticAddresses.HOLDER_DAI],
                undefined,
                MaticAddresses.WMATIC,
                false
              );
              const ret = await d.aavePoolAdapterAsTC.claimRewards(receiver);
              expect(ret.amount.toNumber()).eq(0);
            });
          });

          describe("getConversionKind", () => {
            let snapshotForEach: string;
            beforeEach(async function () {
              snapshotForEach = await TimeUtils.snapshot();
            });

            afterEach(async function () {
              await TimeUtils.rollback(snapshotForEach);
            });

            describe("Good paths", () => {
              it("should return expected values", async () => {
                const d = await Aave3TestUtils.prepareToBorrow(
                  deployer,
                  core,
                  controller,
                  MaticAddresses.DAI,
                  [MaticAddresses.HOLDER_DAI],
                  undefined,
                  MaticAddresses.WMATIC,
                  false
                );
                const ret = await d.aavePoolAdapterAsTC.getConversionKind();
                expect(ret).eq(2); // CONVERSION_KIND_BORROW_2
              });
            });
          });

          describe("getConfig", () => {
            let snapshotForEach: string;
            beforeEach(async function () {
              snapshotForEach = await TimeUtils.snapshot();
            });

            afterEach(async function () {
              await TimeUtils.rollback(snapshotForEach);
            });

            async function getConfigTest(
              controller0: ConverterController,
              collateralAsset: string,
              holderCollateralAsset: string,
              borrowAsset: string,
              useEMode: boolean
            ): Promise<{ ret: string, expected: string }> {
              const d = await Aave3TestUtils.prepareToBorrow(
                deployer,
                core,
                controller0,
                collateralAsset,
                [holderCollateralAsset],
                undefined,
                borrowAsset,
                useEMode
              );
              const r = await d.aavePoolAdapterAsTC.getConfig();
              const ret = [
                r.outCollateralAsset,
                r.outBorrowAsset,
                r.outUser,
                r.origin
              ].join().toLowerCase();
              const expected = [
                collateralAsset,
                borrowAsset,
                d.userContract.address,
                useEMode ? d.converterEMode : d.converterNormal
              ].join().toLowerCase();
              return {ret, expected};
            }

            describe("Good paths", () => {
              it("normal mode: should return expected values", async () => {
                const r = await getConfigTest(
                  controller,
                  MaticAddresses.DAI,
                  MaticAddresses.HOLDER_DAI,
                  MaticAddresses.WMATIC,
                  false
                );
                expect(r.ret).eq(r.expected);
              });
              it("emode: should return expected values", async () => {
                const r = await getConfigTest(
                  controller,
                  MaticAddresses.USDC,
                  MaticAddresses.HOLDER_USDC,
                  MaticAddresses.USDT,
                  true
                );
                expect(r.ret).eq(r.expected);
              });
            });
          });

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

            async function prepare(): Promise<IPrepareResults> {
              const collateralToken = await TokenDataTypes.Build(deployer, MaticAddresses.USDC);
              const borrowToken = await TokenDataTypes.Build(deployer, MaticAddresses.USDT);

              const init = await Aave3TestUtils.prepareToBorrow(
                deployer,
                core,
                controller,
                collateralToken.address,
                [MaticAddresses.HOLDER_USDC],
                parseUnits("1", collateralToken.decimals),
                borrowToken.address,
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
            ): Promise<number> {
              const token = await IERC20Metadata__factory.connect(tokenAddress, deployer);
              const decimals = await token.decimals();
              const amount = parseUnits(amountNum, decimals);
              await BalanceUtils.getRequiredAmountFromHolders(amount, token, [holder], p.init.aavePoolAdapterAsTC.address);
              await p.init.aavePoolAdapterAsTC.connect(await Misc.impersonate(caller || p.governance)).salvage(receiver, tokenAddress, amount);
              return +formatUnits(await token.balanceOf(receiver), decimals);
            }

            describe("Good paths", () => {
              it("should salvage collateral asset", async () => {
                const p = await loadFixture(prepare);
                expect(await salvageToken(p, MaticAddresses.USDC, MaticAddresses.HOLDER_USDC, "800")).eq(800);
              });
              it("should salvage borrow asset", async () => {
                const p = await loadFixture(prepare);
                expect(await salvageToken(p, MaticAddresses.USDT, MaticAddresses.HOLDER_USDT, "800")).eq(800);
              });
            });
            describe("Bad paths", () => {
              it("should revert on attempt to salvage collateral aToken", async () => {
                const p = await loadFixture(prepare);
                await expect(salvageToken(p, MaticAddresses.AAVE3_ATOKEN_USDC, MaticAddresses.AAVE3_ATOKEN_USDC_HOLDER, "800")).revertedWith("TC-59: unsalvageable"); // UNSALVAGEABLE
              });
              it("should revert on attempt to salvage borrow stable aToken", async () => {
                const p = await loadFixture(prepare);
                await expect(salvageToken(p, MaticAddresses.AAVE3_ATOKEN_USDT, MaticAddresses.AAVE3_ATOKEN_USDT_HOLDER, "800")).revertedWith("TC-59: unsalvageable"); // UNSALVAGEABLE
              });
              it("should revert if not governance", async () => {
                const p = await loadFixture(prepare);
                await expect(salvageToken(p, MaticAddresses.USDC, MaticAddresses.HOLDER_USDC, "800", receiver)).revertedWith("TC-9 governance only"); // GOVERNANCE_ONLY
              });
            });
          });
        }
      })
    });
  });
});
