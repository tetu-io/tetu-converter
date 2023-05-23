import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TimeUtils} from "../../../scripts/utils/TimeUtils";
import {ethers} from "hardhat";
import {BigNumber} from "ethers";
import {
  Compound3TestUtils,
  IBorrowResults,
  IPrepareToBorrowResults
} from "../../baseUT/protocols/compound3/Compound3TestUtils";
import {TokenDataTypes} from "../../baseUT/types/TokenDataTypes";
import {MaticAddresses} from "../../../scripts/addresses/MaticAddresses";
import {isPolygonForkInUse} from "../../baseUT/utils/NetworkUtils";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {
  Compound3PoolAdapter,
  ConverterController,
  ICometRewards__factory,
  IERC20__factory,
  IERC20Metadata__factory
} from "../../../typechain";
import {expect} from "chai";
import {areAlmostEqual} from "../../baseUT/utils/CommonUtils";
import {BalanceUtils} from "../../baseUT/utils/BalanceUtils";
import {Misc} from "../../../scripts/utils/Misc";
import {MocksHelper} from "../../baseUT/helpers/MocksHelper";
import {TetuConverterApp} from "../../baseUT/helpers/TetuConverterApp";
import {AdaptersHelper} from "../../baseUT/helpers/AdaptersHelper";


describe("Compound3PoolAdapterUnitTest", () => {
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
    deployer = signers[1];
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

//region Test impl
  async function makeBorrow(
    collateralAsset: string,
    collateralHolder: string,
    collateralAmount: BigNumber,
    borrowAsset: string,
    targetHealthFactor2?: number,
    minHealthFactor2?: number
  ) : Promise<{borrowResults: IBorrowResults, prepareResults: IPrepareToBorrowResults}> {
    const collateralToken = await TokenDataTypes.Build(deployer, collateralAsset);
    const borrowToken = await TokenDataTypes.Build(deployer, borrowAsset);
    const prepareResults = await Compound3TestUtils.prepareToBorrow(
      deployer,
      collateralToken,
      collateralHolder,
      collateralAmount,
      borrowToken,
      [MaticAddresses.COMPOUND3_COMET_USDC],
      MaticAddresses.COMPOUND3_COMET_REWARDS,
      {targetHealthFactor2, minHealthFactor2,}
    )

    const borrowResults = await Compound3TestUtils.makeBorrow(deployer, prepareResults, undefined)

    return {
      borrowResults,
      prepareResults,
    }
  }
//endregion Test impl
  describe("initialize", () => {
    interface IInitializePoolAdapterBadPaths {
      zeroController?: boolean;
      zeroUser?: boolean;
      zeroCollateralAsset?: boolean;
      zeroBorrowAsset?: boolean;
      zeroConverter?: boolean;
      zeroComet?: boolean;
      zeroCometRewards?: boolean;
    }
    interface IMakeInitializePoolAdapterResults {
      user: string;
      converter: string;
      collateralAsset: string;
      borrowAsset: string;
      controller: ConverterController;
      poolAdapter: Compound3PoolAdapter;
    }
    async function makeInitializePoolAdapter(p?: IInitializePoolAdapterBadPaths) : Promise<IMakeInitializePoolAdapterResults> {
      const user = ethers.Wallet.createRandom().address;
      const collateralAsset = (await MocksHelper.createMockedCToken(deployer)).address;
      const borrowAsset = (await MocksHelper.createMockedCToken(deployer)).address;
      const converter = ethers.Wallet.createRandom().address;

      const controller = await TetuConverterApp.createController(
        deployer,
        {tetuLiquidatorAddress: MaticAddresses.TETU_LIQUIDATOR}
      );
      const poolAdapter = await AdaptersHelper.createCompound3PoolAdapter(deployer);

      await poolAdapter.initialize(
        p?.zeroController ? Misc.ZERO_ADDRESS : controller.address,
        p?.zeroComet ? Misc.ZERO_ADDRESS : MaticAddresses.COMPOUND3_COMET_USDC,
        p?.zeroCometRewards ? Misc.ZERO_ADDRESS : MaticAddresses.COMPOUND3_COMET_REWARDS,
        p?.zeroUser ? Misc.ZERO_ADDRESS : user,
        p?.zeroCollateralAsset ? Misc.ZERO_ADDRESS : collateralAsset,
        p?.zeroBorrowAsset ? Misc.ZERO_ADDRESS : borrowAsset,
        p?.zeroConverter ? Misc.ZERO_ADDRESS : converter
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
      p?: IInitializePoolAdapterBadPaths
    ) : Promise<{ret: string, expected: string}> {
      const d = await makeInitializePoolAdapter(p);
      const poolAdapterConfigAfter = await d.poolAdapter.getConfig();
      const ret = [
        poolAdapterConfigAfter.originConverter_,
        poolAdapterConfigAfter.user_,
        poolAdapterConfigAfter.collateralAsset_,
        poolAdapterConfigAfter.borrowAsset_
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
        if (!await isPolygonForkInUse()) return;
        const r = await makeInitializePoolAdapterTest(false);
        expect(r.ret).eq(r.expected);
      });
      it("EMode: should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        const r = await makeInitializePoolAdapterTest(false);
        expect(r.ret).eq(r.expected);
      });
    });
    describe("Bad paths", () => {
      it("should revert on zero controller", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeInitializePoolAdapterTest(
            false,
            {zeroController: true}
          )
        ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
      });
      it("should revert on zero user", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeInitializePoolAdapterTest(
            false,
            {zeroUser: true}
          )
        ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
      });
      it("should revert on zero comet", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeInitializePoolAdapterTest(
            false,
            {zeroComet: true}
          )
        ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
      });
      it("should revert on zero comet rewards", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeInitializePoolAdapterTest(
            false,
            {zeroCometRewards: true}
          )
        ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
      });
      it("should revert on zero converter", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeInitializePoolAdapterTest(
            false,
            {zeroConverter: true}
          )
        ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
      });
      it("should revert on zero collateral asset", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeInitializePoolAdapterTest(
            false,
            {zeroCollateralAsset: true}
          )
        ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
      });
      it("should revert on zero borrow asset", async () => {
        if (!await isPolygonForkInUse()) return;
        await expect(
          makeInitializePoolAdapterTest(
            false,
            {zeroBorrowAsset: true}
          )
        ).revertedWith("TC-1 zero address"); // ZERO_ADDRESS
      });
      it("should revert on second initialization", async () => {
        if (!await isPolygonForkInUse()) return;
        const d = await makeInitializePoolAdapter();
        await expect(
          d.poolAdapter.initialize(
            d.controller.address,
            MaticAddresses.COMPOUND3_COMET_USDC,
            MaticAddresses.COMPOUND3_COMET_REWARDS,
            d.user,
            d.collateralAsset,
            d.borrowAsset,
            d.converter
          )
        ).revertedWith("Initializable: contract is already initialized");
      });
    });
  });

  describe("getConversionKind", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;
        const d = await Compound3TestUtils.prepareToBorrow(
          deployer,
          await TokenDataTypes.Build(deployer, MaticAddresses.WETH),
          MaticAddresses.HOLDER_WETH,
          undefined,
          await TokenDataTypes.Build(deployer, MaticAddresses.USDC),
          [MaticAddresses.COMPOUND3_COMET_USDC],
          MaticAddresses.COMPOUND3_COMET_REWARDS,
        );
        const ret = await d.poolAdapter.getConversionKind();
        expect(ret).eq(2); // CONVERSION_KIND_BORROW_2
      });
    });
  });

  describe("claimRewards", () => {
    describe("Good paths", () => {
      it("should return expected values", async () => {
        if (!await isPolygonForkInUse()) return;

        const receiver = ethers.Wallet.createRandom().address;

        const r = await makeBorrow(
          MaticAddresses.WETH,
          MaticAddresses.HOLDER_WETH,
          parseUnits('10'),
          MaticAddresses.USDC
        )

        // wait a bit and check rewards
        await TimeUtils.advanceNBlocks(100);

        const rewardsContract = ICometRewards__factory.connect(await r.prepareResults.poolAdapter.cometRewards(), deployer)
        const rewardTokenFromAdapter = (await rewardsContract.rewardConfig(await r.prepareResults.poolAdapter.comet())).token
        const balanceRewardsBefore = await IERC20__factory.connect(rewardTokenFromAdapter, deployer).balanceOf(receiver);
        const {rewardToken, amount} = await r.prepareResults.poolAdapter.callStatic.claimRewards(receiver);

        expect(rewardTokenFromAdapter).eq(rewardToken)

        await r.prepareResults.poolAdapter.claimRewards(receiver);

        // let's try to claim the rewards once more; now we should receive nothing
        const secondAttempt = await r.prepareResults.poolAdapter.callStatic.claimRewards(receiver);
        const balanceRewardsAfter = await IERC20__factory.connect(rewardToken, deployer).balanceOf(receiver);

        expect(amount).gt(0)
        expect(amount).lte(balanceRewardsAfter.sub(balanceRewardsBefore)) // because we accrue interest on claimRewards
        expect(secondAttempt.amount).eq(0)
        expect(secondAttempt.rewardToken).eq(rewardToken)

        console.log('Rewards amount', amount.toString())
      })
    })
  })

  describe("borrowToRebalance", () => {
    it("should return expected values", async () => {
      if (!await isPolygonForkInUse()) return;

      const r = await makeBorrow(
        MaticAddresses.WETH,
        MaticAddresses.HOLDER_WETH,
        parseUnits('10'),
        MaticAddresses.USDC
      )

      const statusAfterBorrow = await r.prepareResults.poolAdapter.getStatus()
      // console.log('Borrowed amount', statusAfterBorrow.amountToPay.toString())
      // console.log('HF after borrow', statusAfterBorrow.healthFactor18.toString())

      await r.prepareResults.controller.setTargetHealthFactor2(150);

      const amountToAdditionalBorrow = statusAfterBorrow.amountToPay.div(5)
      const [resultHealthFactor18,] = await r.prepareResults.poolAdapter.callStatic.borrowToRebalance(amountToAdditionalBorrow, r.prepareResults.userContract.address)
      await r.prepareResults.poolAdapter.borrowToRebalance(amountToAdditionalBorrow, r.prepareResults.userContract.address)

      const statusAfterBorrowToRebalance = await r.prepareResults.poolAdapter.getStatus()
      // console.log('Borrowed amount', statusAfterBorrowToRebalance.amountToPay.toString())
      // console.log('HF after borrow', statusAfterBorrowToRebalance.healthFactor18.toString())
      // console.log('Result HF', resultHealthFactor18.toString())
      expect(statusAfterBorrowToRebalance.healthFactor18).lt(statusAfterBorrow.healthFactor18)
      expect(areAlmostEqual(statusAfterBorrowToRebalance.amountToPay, statusAfterBorrow.amountToPay.add(amountToAdditionalBorrow))).eq(true)
      expect(areAlmostEqual(resultHealthFactor18, statusAfterBorrowToRebalance.healthFactor18)).eq(true)
    })

  })

  describe("salvage", () => {
    const receiver = ethers.Wallet.createRandom().address;

    let snapshotLocal: string;
    let collateralToken: TokenDataTypes;
    let borrowToken: TokenDataTypes;
    let init: IPrepareToBorrowResults;
    let governance: string;

    before(async function () {
      snapshotLocal = await TimeUtils.snapshot();
      collateralToken = await TokenDataTypes.Build(deployer, MaticAddresses.WETH);
      borrowToken = await TokenDataTypes.Build(deployer, MaticAddresses.USDC);

      init = await Compound3TestUtils.prepareToBorrow(
        deployer,
        await TokenDataTypes.Build(deployer, MaticAddresses.WETH),
        MaticAddresses.HOLDER_WETH,
        undefined,
        await TokenDataTypes.Build(deployer, MaticAddresses.USDC),
        [MaticAddresses.COMPOUND3_COMET_USDC],
        MaticAddresses.COMPOUND3_COMET_REWARDS,
      );
      governance = await init.controller.governance();
    });
    after(async function () {
      await TimeUtils.rollback(snapshotLocal);
    });
    async function salvageToken(tokenAddress: string, holder: string, amountNum: string, caller?: string) : Promise<number>{
      const token = await IERC20Metadata__factory.connect(tokenAddress, deployer);
      const decimals = await token.decimals();
      const amount = parseUnits(amountNum, decimals);
      await BalanceUtils.getRequiredAmountFromHolders(amount, token,[holder], init.poolAdapter.address);
      await init.poolAdapter.connect(await Misc.impersonate(caller || governance)).salvage(receiver, tokenAddress, amount);
      return +formatUnits(await token.balanceOf(receiver), decimals);
    }
    describe("Good paths", () => {
      it("should salvage collateral asset", async () => {
        expect(await salvageToken(MaticAddresses.WETH, MaticAddresses.HOLDER_WETH, "8")).eq(8);
      });
      it("should salvage borrow asset", async () => {
        expect(await salvageToken(MaticAddresses.USDC, MaticAddresses.HOLDER_USDC, "8")).eq(8);
      });
    });
    describe("Bad paths", () => {
      it("should revert if not governance", async () => {
        await expect(salvageToken(MaticAddresses.USDC, MaticAddresses.HOLDER_USDC, "8", receiver)).revertedWith("TC-9 governance only"); // GOVERNANCE_ONLY
      });
    });
  });

  describe("updateStatus", () => {
    describe("Bad paths", () => {
      it("should revert if not TetuConverter", async () => {
        const d = await Compound3TestUtils.prepareToBorrow(
          deployer,
          await TokenDataTypes.Build(deployer, MaticAddresses.WETH),
          MaticAddresses.HOLDER_WETH,
          undefined,
          await TokenDataTypes.Build(deployer, MaticAddresses.USDC),
          [MaticAddresses.COMPOUND3_COMET_USDC],
          MaticAddresses.COMPOUND3_COMET_REWARDS,
        );
        await expect(
          d.poolAdapter.connect(await Misc.impersonate(ethers.Wallet.createRandom().address)).updateStatus()
        ).revertedWith("TC-8 tetu converter only"); // TETU_CONVERTER_ONLY
      });
    });
  });
})