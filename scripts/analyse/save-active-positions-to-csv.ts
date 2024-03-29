import {ethers, network} from "hardhat";
import {
  BorrowManager__factory,
  ConverterController__factory,
  DebtMonitor__factory,
  IERC20Metadata__factory,
  IPlatformAdapter__factory,
  IPoolAdapter__factory
} from "../../typechain";
import {writeFileSync} from "fs";
import {formatUnits} from "ethers/lib/utils";
import {getCurrentTimestamp} from "hardhat/internal/hardhat-network/provider/utils/getCurrentTimestamp";
import {BASE_NETWORK_ID, HardhatUtils} from "../utils/HardhatUtils";

interface IPositionInfo {
  block: number;
  hoursPassed: number;

  poolAdapter: string;
  platformAdapter: string;
  platform: string;

  user: string;
  collateralAssetName: string;
  borrowAssetName: string;

  collateralAmount: number;
  amountToPay: number;
  healthFactor: number;

  opened: boolean;
  collateralAmountLiquidated: number;
  debtGapRequired: boolean;

  origin: string;
  collateralAsset: string;
  borrowAsset: string;

  timestamp: number;
}

function getPlatformAdapterName(platformKind: number): string {
  switch (platformKind) {
    case 1: return "dforce";
    case 2: return "aave2";
    case 3: return "aave3";
    case 4: return "hundred finance";
    case 5: return "compound 3";
    default: return `unknown ${platformKind}`;
  }
}

/**
 *
 * Save all active positions in TetuConverter to csv
 * - for initial block
 * - for HISTORY_LEN previous blocks with interval HISTORY_INTERVAL
 *
 * run one of the following commands to run the script:
 *      npx hardhat run scripts/analyse/save-active-positions-to-csv.ts
 */
async function main() {
  await HardhatUtils.setupBeforeTest(BASE_NETWORK_ID);
  const INITIAL_BLOCK = -1;
  const HISTORY_LEN = 0;
  const HISTORY_INTERVAL = 4000; // 1 hour ~ 60-70 blocks

  // const converterController = "0x2df21e2a115fcB3d850Fbc67237571bBfB566e99";
  const converterController = "0x1AC16b6aBeEE14487DE6CF946d05A0dE5169a917";

  const net = await ethers.provider.getNetwork();
  console.log(net, `network name="${network.name}"`);

  const pathOut = `./tmp/${net.chainId}-active-positions.csv`;
  const signer = (await ethers.getSigners())[0];

  const controller = ConverterController__factory.connect(converterController, signer);
  const debtMonitor = DebtMonitor__factory.connect(await controller.debtMonitor(), signer);
  const borrowManager = BorrowManager__factory.connect(await controller.borrowManager(), signer);

  // ----------------------------  collect statistics for current block and history
  let historyCounter = 0;
  let currentBlock: number = 0;
  const positions: IPositionInfo[] = [];
  const currentTimestamp = getCurrentTimestamp();

  while (historyCounter <= HISTORY_LEN) {
    await HardhatUtils.switchToBlock(currentBlock === 0 ? INITIAL_BLOCK : currentBlock, net.chainId)

    const countPositions = (await debtMonitor.getCountPositions()).toNumber();

    currentBlock = await ethers.provider.getBlockNumber();
    const blockInfo = await ethers.provider.getBlock(currentBlock);

    console.log("current block", currentBlock);
    console.log("current timestamp", getCurrentTimestamp());
    console.log("block timestamp", blockInfo.timestamp);

    for (let i = 0; i < countPositions; ++i) {
      const poolAdapter = IPoolAdapter__factory.connect(await debtMonitor.positions(i), signer);
      const config = await poolAdapter.getConfig();
      const status = await poolAdapter.getStatus();

      const platformAdapter = IPlatformAdapter__factory.connect(await borrowManager.getPlatformAdapter(config.originConverter), signer);
      const platformKind = await platformAdapter.platformKind();
      const platform = getPlatformAdapterName(platformKind);

      const collateralAsset = IERC20Metadata__factory.connect(config.collateralAsset, signer);
      const borrowAsset = IERC20Metadata__factory.connect(config.borrowAsset, signer);

      const blockTimestamp = blockInfo.timestamp.valueOf();
      const position: IPositionInfo = {
        block: currentBlock,
        timestamp:  blockTimestamp,
        hoursPassed: Math.abs(currentTimestamp.valueOf() - blockTimestamp.valueOf()) / 60/60, // s => hours

        poolAdapter: poolAdapter.address,
        platformAdapter: platformAdapter.address,
        platform,

        user: config.user,
        collateralAsset: config.collateralAsset,
        borrowAsset: config.borrowAsset,
        collateralAssetName: await collateralAsset.symbol(),
        borrowAssetName: await borrowAsset.symbol(),

        collateralAmount: +formatUnits(status.collateralAmount, await collateralAsset.decimals()),
        amountToPay: +formatUnits(status.amountToPay, await borrowAsset.decimals()),
        collateralAmountLiquidated: +formatUnits(status.collateralAmountLiquidated, await collateralAsset.decimals()),

        healthFactor: +formatUnits(status.healthFactor18, 18),
        debtGapRequired: status.debtGapRequired,
        opened: status.opened,
        origin: config.originConverter
      };
      positions.push(position);
      console.log(position);

    }
    currentBlock -= HISTORY_INTERVAL;
    historyCounter++;

  }
  // ----------------------------  write statistics to CSV columns
  const headers = [
    "block",
    "hoursPassed",
    "poolAdapter",
    "platform",
    "collateralAssetName",
    "borrowAssetName",
    "collateralAmount",
    "amountToPay",
    "healthFactor",
    "user",
    "opened",
    "collateralAmountLiquidated",
    "debtGapRequired",
    "origin",
    "collateralAsset",
    "borrowAsset",
    "platformAdapter",
  ];
  const columns: string[][] = [];
  columns.push(headers);
  for (const p of positions) {
    columns.push([
     p.block.toString(),
     (Math.round(p.hoursPassed * 10)/10).toString(),
     p.poolAdapter,
     p.platform,
     p.collateralAssetName,
     p.borrowAssetName,
     p.collateralAmount.toString(),
     p.amountToPay.toString(),
     p.healthFactor.toString(),
     p.user,
     p.opened.toString(),
     p.collateralAmountLiquidated.toString(),
     p.debtGapRequired.toString(),
     p.origin,
     p.collateralAsset,
     p.borrowAsset,
      p.platformAdapter,
    ]);
  }

  // ----------------------------  transpose
  const lines: string[][] = [];
  const countLines = headers.length;
  for (let nline = 0; nline < countLines; ++nline) {
    const line: string[] = [];
    for (let ncol = 0; ncol < columns.length; ++ncol) {
      if (nline !== 0 || ncol === 0 || columns[ncol][nline] !== columns[ncol - 1][nline]) {
        line.push(columns[ncol][nline]);
      } else {
        // show block for first position only
        // to visually distinct positions-set for each block
        line.push("");
      }
    }
    lines.push(line);
  }

  for (let nline = 0; nline < lines.length; ++nline) {
    writeFileSync(
      pathOut,
      lines[nline].join(";") + "\n",
      {encoding: 'utf8', flag: nline === 0 ? "w" : "a"}
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });