import {
  Borrower,
  BorrowManager__factory,
  Compound3PlatformAdapter,
  Compound3PoolAdapter, Compound3PoolAdapter__factory,
  ConverterController, IComet__factory, IPoolAdapter__factory
} from "../../../../typechain";
import {BigNumber} from "ethers";
import {TokenDataTypes} from "../../types/TokenDataTypes";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {makeInfinityApprove, transferAndApprove} from "../../utils/transferUtils";
import {ethers} from "hardhat";
import {BalanceUtils, IUserBalances} from "../../utils/BalanceUtils";
import {IPoolAdapterStatus} from "../../types/BorrowRepayDataTypes";
import {GAS_LIMIT} from "../../types/GasLimit";
import {TetuConverterApp} from "../../app/TetuConverterApp";
import {MocksHelper} from "../../app/MocksHelper";
import {AdaptersHelper} from "../../app/AdaptersHelper";


export interface IPrepareToBorrowResults {
  controller: ConverterController;
  platformAdapter: Compound3PlatformAdapter;
  poolAdapter: Compound3PoolAdapter;
  userContract: Borrower;
  collateralAmount: BigNumber;
  amountToBorrow: BigNumber;
  converterNormal: string;
  collateralToken: TokenDataTypes;
  borrowToken: TokenDataTypes;
  // priceCollateral: BigNumber;
  // priceBorrow: BigNumber;
}

export interface IPrepareBorrowBadPathsParams {
  targetHealthFactor2?: number;
  minHealthFactor2?: number;
  comet?: string;
  cometRewards?: string;
  borrowAsNotTetuConverter?: boolean;
}

export interface IBorrowResults {
  userBalanceBorrowAsset: BigNumber;
  borrowedAmount: BigNumber;
}

export interface IMakeBorrowAndRepayResults {
  userBalancesBeforeBorrow: IUserBalances;
  userBalancesAfterBorrow: IUserBalances;
  userBalancesAfterRepay: IUserBalances;
}

export interface IMakeBorrowOrRepayBadPathsParams {
  makeOperationAsNotTc?: boolean;
  wrongAmountToRepayToTransfer?: BigNumber;
  forceToClosePosition?: boolean;
}

export interface IMakeRepayResults {
  repayResultsCollateralAmountOut: BigNumber;
  repayResultsReturnedBorrowAmountOut?: BigNumber;
}

export interface IInitialBorrowResults {
  prepareResults: IPrepareToBorrowResults;
  borrowResults?: IBorrowResults;
  collateralToken: TokenDataTypes;
  borrowToken: TokenDataTypes;
  collateralAmount: BigNumber;
  stateAfterBorrow: ICompound3PoolAdapterState;
}

export interface ICompound3PoolAdapterState {
  status: IPoolAdapterStatus;
  collateralBalanceBase: BigNumber;
}

export interface ILiquidationResults {
  liquidatorAddress: string;
  // collateralAmountReceivedByLiquidator: BigNumber;
}

export class Compound3TestUtils {

  public static async prepareToBorrow(
    deployer: SignerWithAddress,
    collateralToken: TokenDataTypes,
    collateralHolder: string,
    collateralAmountRequired: BigNumber | undefined,
    borrowToken: TokenDataTypes,
    comets: string[],
    cometRewards: string,
    p?: IPrepareBorrowBadPathsParams
  ) : Promise<IPrepareToBorrowResults> {
    const periodInBlocks = 1000;

    // controller, dm, bm
    const controller = await TetuConverterApp.createController(deployer, {
      minHealthFactor2: p?.minHealthFactor2,
      targetHealthFactor2: p?.targetHealthFactor2,
    });
    const userContract = await MocksHelper.deployBorrower(deployer.address, controller, periodInBlocks);
    await controller.connect(await DeployerUtils.startImpersonate(await controller.governance())).setWhitelistValues([userContract.address], true);

    const converterNormal = await AdaptersHelper.createCompound3PoolAdapter(deployer)

    const platformAdapter = await AdaptersHelper.createCompound3PlatformAdapter(
      deployer,
      controller.address,
      converterNormal.address,
      comets,
      cometRewards
    )

    const borrowManager = BorrowManager__factory.connect(
      await controller.borrowManager(),
      deployer
    );
    await borrowManager.addAssetPairs(
      platformAdapter.address,
      [collateralToken.address],
      [borrowToken.address]
    );

    const bmAsTc = BorrowManager__factory.connect(
      borrowManager.address,
      await DeployerUtils.startImpersonate(await controller.tetuConverter())
    );
    await bmAsTc.registerPoolAdapter(
      converterNormal.address,
      userContract.address,
      collateralToken.address,
      borrowToken.address
    );

    const poolAdapterAsTc = Compound3PoolAdapter__factory.connect(
      await borrowManager.getPoolAdapter(
        converterNormal.address,
        userContract.address,
        collateralToken.address,
        borrowToken.address
      ),
      await DeployerUtils.startImpersonate(await controller.tetuConverter())
    )

    // TetuConverter gives infinity approve to the pool adapter after pool adapter creation (see TetuConverter.convert implementation)
    await makeInfinityApprove(
      await controller.tetuConverter(),
      poolAdapterAsTc.address,
      collateralToken.address,
      borrowToken.address
    );

    // put collateral amount on user's balance
    const holderBalance = await collateralToken.token.balanceOf(collateralHolder);
    const collateralAmount = collateralAmountRequired && holderBalance.gt(collateralAmountRequired)
      ? collateralAmountRequired
      : holderBalance;

    // calculate max allowed amount to borrow
    const countBlocks = 1;
    const plan = await platformAdapter.getConversionPlan(
      {
        collateralAsset: collateralToken.address,
        amountIn: collateralAmount,
        borrowAsset: borrowToken.address,
        countBlocks,
        entryData: "0x",
      },
      p?.targetHealthFactor2 || await controller.targetHealthFactor2(),
      {gasLimit: GAS_LIMIT}
    )
    console.log("plan", plan);

    // collateral asset
    await collateralToken.token
      .connect(await DeployerUtils.startImpersonate(collateralHolder))
      .transfer(userContract.address, plan.collateralAmount);

    return {
      controller,
      platformAdapter,
      poolAdapter: poolAdapterAsTc,
      userContract,
      collateralAmount: plan.collateralAmount,
      amountToBorrow: plan.amountToBorrow,
      converterNormal: converterNormal.address,
      collateralToken,
      borrowToken,
      // priceCollateral: BigNumber;
      // priceBorrow: BigNumber;
    }
  }

  static async makeBorrow(
    deployer: SignerWithAddress,
    d: IPrepareToBorrowResults,
    borrowAmountRequired: BigNumber | undefined,
    badPathsParams?: IMakeBorrowOrRepayBadPathsParams
  ) : Promise<IBorrowResults>{
    const borrowAmount = borrowAmountRequired
      ? borrowAmountRequired
      : d.amountToBorrow;

    await transferAndApprove(
      d.collateralToken.address,
      d.userContract.address,
      await d.controller.tetuConverter(),
      d.collateralAmount,
      d.poolAdapter.address
    );

    const borrower = badPathsParams?.makeOperationAsNotTc
      ? Compound3PoolAdapter__factory.connect(d.poolAdapter.address, await DeployerUtils.startImpersonate(ethers.Wallet.createRandom().address))
      : d.poolAdapter

    await borrower.borrow(d.collateralAmount, borrowAmount, d.userContract.address, {gasLimit: GAS_LIMIT});
    console.log(`borrow: success`);

    const userBalanceBorrowAsset = await d.borrowToken.token.balanceOf(d.userContract.address);

    return {
      borrowedAmount: borrowAmount,
      userBalanceBorrowAsset,
    }
  }

  public static async makeRepay(
    d: IPrepareToBorrowResults,
    amountToRepay?: BigNumber,
    closePosition?: boolean,
  ) : Promise<IMakeRepayResults> {
    if (amountToRepay) {
      // partial repay

      const tetuConverter = await d.controller.tetuConverter();
      const poolAdapterAsCaller = IPoolAdapter__factory.connect(
        d.poolAdapter.address,
        await DeployerUtils.startImpersonate(tetuConverter)
      );
      await transferAndApprove(
        d.borrowToken.address,
        d.userContract.address,
        tetuConverter,
        amountToRepay,
        d.poolAdapter.address
      );
      const payer = poolAdapterAsCaller
      const repayResultsCollateralAmountOut = await payer.callStatic.repay(
        amountToRepay,
        d.userContract.address,
        closePosition === undefined ? false : closePosition,
        {gasLimit: GAS_LIMIT}
      );
      await payer.repay(
        amountToRepay,
        d.userContract.address,
        closePosition === undefined ? false : closePosition,
        {gasLimit: GAS_LIMIT}
      );

      return {
        repayResultsCollateralAmountOut,
      }
    } else {
      // make full repayment
      await d.userContract.makeRepayComplete(
        d.collateralToken.address,
        d.borrowToken.address,
        d.userContract.address
      );
      const repayResults = await d.userContract.repayResults();
      return {
        repayResultsCollateralAmountOut: repayResults.collateralAmountOut,
        repayResultsReturnedBorrowAmountOut: repayResults.returnedBorrowAmountOut
      };
    }
  }

  public static async getState(d: IPrepareToBorrowResults) : Promise<ICompound3PoolAdapterState> {
    return {
      status: await d.poolAdapter.getStatus(),
      collateralBalanceBase: await d.poolAdapter.collateralTokensBalance(),
    }
  }

  public static async putCollateralAmountOnUserBalance(init: IInitialBorrowResults, collateralHolder: string) {
    await BalanceUtils.getRequiredAmountFromHolders(
      init.collateralAmount,
      init.collateralToken.token,
      [collateralHolder],
      init.prepareResults.userContract.address
    );
  }

  public static async putDoubleBorrowAmountOnUserBalance(d: IPrepareToBorrowResults, borrowHolder: string) {
    await BalanceUtils.getRequiredAmountFromHolders(
      d.amountToBorrow.mul(2),
      d.borrowToken.token,
      [borrowHolder],
      d.userContract.address
    );
  }

  public static async makeLiquidation(
    deployer: SignerWithAddress,
    d: IPrepareToBorrowResults,
    borrowHolder: string
  ) : Promise<ILiquidationResults> {
    const liquidatorAddress = ethers.Wallet.createRandom().address;
    // const liquidator = await DeployerUtils.startImpersonate(liquidatorAddress);
    // const borrowerAddress = d.poolAdapter.address;

    // console.log("borrowed amount", d.amountToBorrow);

    // const statusBefore = await d.poolAdapter.getStatus()
    // console.log('statusBefore.collateralAmount', statusBefore.collateralAmount.toString())
    // console.log('statusBefore.amountToPay', statusBefore.amountToPay.toString())
    // console.log('statusBefore.healthFactor18', statusBefore.healthFactor18.toString())

    const cometContract = IComet__factory.connect(await d.poolAdapter.comet(), deployer)
    await cometContract.absorb(liquidatorAddress, [d.poolAdapter.address])

    // const statusAfter = await d.poolAdapter.getStatus()
    // console.log('statusAfter.collateralAmount', statusAfter.collateralAmount.toString())
    // console.log('statusAfter.amountToPay', statusAfter.amountToPay.toString())
    // console.log('statusAfter.healthFactor18', statusAfter.healthFactor18.toString())

    // "borrow" borrow token
    // Buy discounted collateral from protocol
    // exchange collateral token to base token

    return {
      liquidatorAddress,
      // collateralAmountReceivedByLiquidator: BigNumber.from(0)
    }
  }
}