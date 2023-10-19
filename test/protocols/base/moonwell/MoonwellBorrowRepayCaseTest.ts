import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  BorrowManager__factory,
  CompoundAprLibFacade, CompoundPlatformAdapterLibFacade,
  ConverterController, IERC20Metadata__factory,
  IMoonwellComptroller,
  IMoonwellPriceOracle,
  MoonwellPlatformAdapter
} from "../../../../typechain";
import {BASE_NETWORK_ID, HardhatUtils} from "../../../../scripts/utils/HardhatUtils";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {TetuConverterApp} from "../../../baseUT/app/TetuConverterApp";
import {MoonwellHelper} from "../../../../scripts/integration/moonwell/MoonwellHelper";
import {DeployUtils} from "../../../../scripts/utils/DeployUtils";
import {AdaptersHelper} from "../../../baseUT/app/AdaptersHelper";
import {MoonwellUtils} from "../../../baseUT/protocols/moonwell/MoonwellUtils";
import {Misc} from "../../../../scripts/utils/Misc";
import {generateAssetPairs} from "../../../baseUT/utils/AssetPairUtils";
import {BaseAddresses} from "../../../../scripts/addresses/BaseAddresses";

describe("MoonwellBorrowRepayCaseTest", () => {
//region Global vars for all tests
  let snapshot: string;
  let signer: SignerWithAddress;

  let converterController: ConverterController;
  let comptroller: IMoonwellComptroller;
  let poolAdapterTemplate: string;
  let platformAdapter: MoonwellPlatformAdapter;
//endregion Global vars for all tests

//region before, after
  before(async function () {
    await HardhatUtils.setupBeforeTest(BASE_NETWORK_ID);
    this.timeout(1200000);
    snapshot = await TimeUtils.snapshot();
    const signers = await ethers.getSigners();
    signer = signers[0];

    converterController = await TetuConverterApp.createController(signer,);
    comptroller = await MoonwellHelper.getComptroller(signer);

    poolAdapterTemplate = (await AdaptersHelper.createMoonwellPoolAdapter(signer)).address;
    platformAdapter = await DeployUtils.deployContract(
      signer,
      "MoonwellPlatformAdapter",
      converterController.address,
      comptroller.address,
      poolAdapterTemplate,
      MoonwellUtils.getAllCTokens()
    ) as MoonwellPlatformAdapter;

    const converterGovernance = await Misc.impersonate(await converterController.governance());
    const borrowManagerAsGov = await BorrowManager__factory.connect(await converterController.borrowManager(), converterGovernance);

    // register the platform adapter in TetuConverter app
    const pairs = generateAssetPairs(MoonwellUtils.getAllAssets());
    await borrowManagerAsGov.addAssetPairs(
      platformAdapter.address,
      pairs.map(x => x.smallerAddress),
      pairs.map(x => x.biggerAddress)
    );
  });

  after(async function () {
    await TimeUtils.rollback(snapshot);
  });
//endregion before, after

//region Unit tests
  interface IHealthFactorsPair {
    minValue: string;
    targetValue: string;
  }
  const HEALTH_FACTOR_PAIRS: IHealthFactorsPair[] = [
    {minValue: "1.05", targetValue: "1.20"},
    {minValue: "1.01", targetValue: "1.03"},
  ];
  interface IAssetsPair {
    collateralAsset: string;
    borrowAsset: string;
  }
  const ASSET_PAIRS: IAssetsPair[] = [
    {collateralAsset: BaseAddresses.USDC, borrowAsset: BaseAddresses.DAI},
    {collateralAsset: BaseAddresses.USDDbC, borrowAsset: BaseAddresses.USDC},
    {collateralAsset: BaseAddresses.DAI, borrowAsset: BaseAddresses.USDDbC},
  ]

  HEALTH_FACTOR_PAIRS.forEach((healthFactorsPair: IHealthFactorsPair) => {
    describe(`hf ${healthFactorsPair.minValue}, ${healthFactorsPair.targetValue}`, () => {
      let snapshotLevel1: string;
      before(async function () {
        snapshotLevel1 = await TimeUtils.snapshot();
      });
      after(async function () {
        await TimeUtils.rollback(snapshotLevel1);
      });

      ASSET_PAIRS.forEach((assetPair: IAssetsPair) => {
        describe(`${MoonwellUtils.getAssetName(assetPair.collateralAsset)} : ${MoonwellUtils.getAssetName(assetPair.borrowAsset)}`, () => {
          let snapshotLevel2: string;
          before(async function () {
            snapshotLevel2 = await TimeUtils.snapshot();
          });
          after(async function () {
            await TimeUtils.rollback(snapshotLevel2);
          });

          describe("entry kind 0", () => {
            describe("borrow", () => {

            });
            describe("borrow, partial repay", () => {

            });
            describe("borrow, full repay", () => {

            });
          });
        });
      });
    });
  });
//endregion Unit tests
});