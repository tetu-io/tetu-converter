import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../scripts/utils/TimeUtils";
import {CompareAprUsesCase} from "../baseUT/uses-cases/CompareAprUsesCase";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {IAsset, IAssetHoldersBox} from "../baseUT/apr/aprDataTypes";

/**
 * For any landing platform:
 * 1. Get APR: borrow apr, supply apr (we don't check rewards in this test)
 * 2. Make supply+borrow inside single block
 * 3. Get current amount of borrow-debt-1 and supply-profit-1
 * 4. Advance 1 block
 * 5. Get current amount of borrow-debt-2 and supply-profit-2
 * 6. Ensure, that
 *        (borrow-debt-2 - borrow-debt-1) == borrow apr
 *        (supply-profit-2 - supply-profit-1) = supply apr
 */
describe("CompareAprBeforeAfterBorrow", () => {
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

//region Data types
//endregion Data types

describe("CompareAprUsesCaseTest", () => {
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

    describe("Make all borrow tests", () => {
      const assets: IAsset[] = [
        {a: MaticAddresses.DAI, t: "DAI"}
        , {a: MaticAddresses.USDC, t: "USDC"}
        , {a: MaticAddresses.USDT, t: "USDT"}
        , {a: MaticAddresses.WMATIC, t: "WMATIC"}
        , {a: MaticAddresses.WBTC, t: "WBTS"}
        , {a: MaticAddresses.ChainLink, t: "ChainLink"}
        , {a: MaticAddresses.DefiPulseToken, t: "DefiPulseToken"}
        , {a: MaticAddresses.Aavegotchi_GHST, t: "Aavegotchi_GHST"}
        , {a: MaticAddresses.CRV, t: "CRV"}
        , {a: MaticAddresses.SUSHI, t: "SUSHI"}
        , {a: MaticAddresses.WETH, t: "WETH"}
        , {a: MaticAddresses.BALANCER, t: "BALANCER"}
        , {a: MaticAddresses.EURS, t: "EURS"}
        , {a: MaticAddresses.jEUR, t: "jEUR"}
        , {a: MaticAddresses.FRAX, t: "FRAX"}
      ];
      const holders: IAssetHoldersBox[] = [
        {asset: MaticAddresses.DAI, holders: [
            MaticAddresses.HOLDER_DAI
            , MaticAddresses.HOLDER_DAI_2
            , MaticAddresses.HOLDER_DAI_3
            , MaticAddresses.HOLDER_DAI_4
            , MaticAddresses.HOLDER_DAI_5
            , MaticAddresses.HOLDER_DAI_6
        ]}, {asset: MaticAddresses.USDC, holders: [
            MaticAddresses.HOLDER_USDC
        ]}, {asset: MaticAddresses.USDT, holders:[
            MaticAddresses.HOLDER_USDT
            , MaticAddresses.HOLDER_USDT_1
            , MaticAddresses.HOLDER_USDT_2
            , MaticAddresses.HOLDER_USDT_3
        ]}
        , {asset: MaticAddresses.WMATIC, holders: [
            MaticAddresses.HOLDER_WMATIC
        ]}
        , {asset: MaticAddresses.WBTC, holders: [
            MaticAddresses.HOLDER_WBTC
        ]}
        , {asset: MaticAddresses.ChainLink, holders: [
            MaticAddresses.ChainLink_TODO
        ]}
        , {asset: MaticAddresses.DefiPulseToken, t: "DefiPulseToken"}
        , {asset: MaticAddresses.Aavegotchi_GHST, t: "Aavegotchi_GHST"}
        , {asset: MaticAddresses.CRV, t: "CRV"}
        , {asset: MaticAddresses.SUSHI, t: "SUSHI"}
        , {asset: MaticAddresses.WETH, t: "WETH"}
        , {asset: MaticAddresses.BALANCER, t: "BALANCER"}
        , {asset: MaticAddresses.EURS, t: "EURS"}
        , {asset: MaticAddresses.jEUR, t: "jEUR"}
        , {asset: MaticAddresses.FRAX, t: "FRAX"}
      ];

      it("", async () => {
        await CompareAprUsesCase.makePossibleBorrowsOnPlatformExactAmounts(
          deployer
          , platformTitle
          , platformAdapter
          , assets
          , holders
          , exactAmountToBorrow
          , amount
          , countBlocks
          , healthFactor2
          , testMaker
        );
      })
    });
  });
});

