import {MockTestInputParams, TestSingleBorrowParams} from "../types/BorrowRepayDataTypes";
import {Borrower, Controller, ITetuConverter} from "../../../typechain";
import {TokenDataTypes} from "../types/TokenDataTypes";
import {MocksHelper} from "../helpers/MocksHelper";
import {MockPlatformFabric} from "../fabrics/MockPlatformFabric";
import {BigNumber} from "ethers";
import {TetuConverterApp} from "../helpers/TetuConverterApp";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {setInitialBalance} from "../utils/CommonUtils";
import {BorrowRepayUsesCase} from "../uses-cases/BorrowRepayUsesCase";
import {BorrowAction} from "../actions/BorrowAction";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

export class KeeperTestMockUtils {
  /**
   * Create {countMockFabrics} mock-pools and register them in TetuConverter-app.
   * Make borrow using Tetu-conveter (best mock pool will be used)
   *
   * @param deployer
   * @param p
   * @param m
   * @param countMockFabrics How many same mocks-pool-adapter we should register
   * @returns Array of too booleans:
   * - keeper has called a reconversion BEFORE modification of the platform state
   * - keeper has called a reconversion AFTER state modification
   */
  static async makeSingleBorrow_Mock (
    deployer: SignerWithAddress,
    p: TestSingleBorrowParams,
    m: MockTestInputParams,
    countMockFabrics: number = 1
  ) : Promise<{
    uc: Borrower
    , tc: ITetuConverter
    , controller: Controller
    , poolAdapter: string
  }> {
    console.log("makeSingleBorrow_Mock.start");
    const collateralToken = await TokenDataTypes.Build(deployer, p.collateral.asset);
    const borrowToken = await TokenDataTypes.Build(deployer, p.borrow.asset);

    const underlying = [p.collateral.asset, p.borrow.asset];
    const pricesUSD = [1, 1];
    const cTokenDecimals = [m.collateral.decimals, m.borrow.decimals];
    const cTokens = await MocksHelper.createCTokensMocks(deployer, underlying, cTokenDecimals);

    const fabrics = [...Array(countMockFabrics).keys()].map(
      () => new MockPlatformFabric(
        underlying,
        [m.collateral.borrowRate, m.borrow.borrowRate],
        [m.collateral.collateralFactor, m.borrow.collateralFactor],
        [m.collateral.liquidity, m.borrow.liquidity],
        [p.collateral.holder, p.borrow.holder],
        cTokens,
        pricesUSD.map((x, index) => BigNumber.from(10)
          .pow(18 - 2)
          .mul(x * 100))
      )
    )

    const {tc, controller} = await TetuConverterApp.buildApp(deployer, fabrics);
    const uc: Borrower = await MocksHelper.deployBorrower(deployer.address
      , controller
      , p.healthFactor2
      , p.countBlocks
    );
    const collateralAmount = getBigNumberFrom(p.collateralAmount, collateralToken.decimals);

    // transfer sufficient amount of collateral to the user
    await setInitialBalance(deployer
      , collateralToken.address
      , p.collateral.holder, p.collateral.initialLiquidity, uc.address);

    // make borrow only
    const {
      userBalances,
      borrowBalances
    } = await BorrowRepayUsesCase.makeBorrowRepayActions(deployer
      , uc
      , [
        new BorrowAction(
          collateralToken
          , collateralAmount
          , borrowToken
        )
      ]
    );

    const poolAdapters = await uc.getBorrows(collateralToken.address, borrowToken.address);
    const poolAdapter = poolAdapters[0];
    if (! poolAdapter) {
      throw "pool adapter not found";
    }

    console.log("makeSingleBorrow_Mock.end", poolAdapters.length);
    return {uc, tc, controller, poolAdapter};
  }

}