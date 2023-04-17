import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {AggregatorMock, IComet__factory, IPriceFeedOwned__factory} from "../../../../typechain";
import {DeployerUtils} from "../../../../scripts/utils/DeployerUtils";
import {DeployUtils} from "../../../../scripts/utils/DeployUtils";

export class Compound3ChangePriceUtils {
  public static async setPaused(deployer: SignerWithAddress, comet: string, supplyPaused: boolean = true, withdrawPaused: boolean = true) {
    const cometContract = IComet__factory.connect(comet, deployer)
    const pauser = await DeployerUtils.startImpersonate(await cometContract.pauseGuardian())
    await cometContract.connect(pauser).pause(supplyPaused, false, withdrawPaused, false, false)
  }

  public static async setupAndInjectPriceOracleMock(deployer: SignerWithAddress, comet: string, asset: string) : Promise<AggregatorMock> {
    const cometContract = IComet__factory.connect(comet, deployer)
    const assetInfo = await cometContract.getAssetInfoByAddress(asset)
    const priceFeed = IPriceFeedOwned__factory.connect(assetInfo.priceFeed, deployer)
    const latestRoundData = await priceFeed.latestRoundData()
    const priceFeedOwner = await DeployerUtils.startImpersonate(await priceFeed.owner())
    const aggregatorMock = await DeployUtils.deployContract(deployer, "AggregatorMock", latestRoundData.roundId, latestRoundData.answer, latestRoundData.answeredInRound) as AggregatorMock
    await priceFeed.connect(priceFeedOwner).proposeAggregator(aggregatorMock.address)
    await priceFeed.connect(priceFeedOwner).confirmAggregator(aggregatorMock.address)
    return aggregatorMock
  }

  public static async changePrice(oracle: AggregatorMock, inc: boolean, times: number) {
    const currentPrice = (await oracle.latestRoundData()).answer_
    const newPrice = inc
      ? currentPrice.mul(times)
      : currentPrice.div(times);
    await oracle.setAnswer(newPrice)
  }
}