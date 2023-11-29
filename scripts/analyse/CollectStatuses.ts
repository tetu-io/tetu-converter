import {ethers, network} from "hardhat";
import {
  BorrowManager__factory,
  ConverterController__factory
} from "../../typechain";
import {readFileSync, writeFileSync} from "fs";
import {CollectStatusesImpl, IGetStatus} from "../../test/baseUT/utils/CollectStatusesImpl";

/**
 * For the given block:
 * - get full list of pool adapters
 * - get status of each pool adapter
 * - save results to csv
 *
 * and run one of the following commands to run the script:
 *      npx hardhat run scripts/analyse/CollectStatuses.ts
 */
async function main() {
  const pathIn = "./tmp/blocks.txt";
  const pathOut = "./tmp/statuses.csv";

  const converterController = "0xc1066543fB1FF7B584E64E6833E7C1a8FD998B40";

  const net = await ethers.provider.getNetwork();
  console.log(net, `network name="${network.name}"`);

  const signer = (await ethers.getSigners())[0];
  const blocks = readFileSync(pathIn, 'utf8').split("\n").map(x=>x.trim()).filter(x=>x);

  const controller = ConverterController__factory.connect(converterController, signer);
  const borrowManager = BorrowManager__factory.connect(await controller.borrowManager(), signer);

  // pool-adapter-address - unique index (i.e 0, 1, 2, etc)
  const mapPoolAdapters: Map<string, number> = new Map<string, number>();

  const results: {
    block: string,
    statuses: Map<number, IGetStatus>
  }[] = [];

  for (const block of blocks) {
    console.log("block", block);
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.APP_MATIC_RPC_URL,
            blockNumber: Number(block.trim()),
          },
        },
      ],
    });

    const data = await CollectStatusesImpl.getStatuses(borrowManager, mapPoolAdapters);
    results.push({
      block,
      statuses: data.statuses
    });
    console.log("data", data);
  }

  const STATUS_HEADERS = [
    "poolAdapter",
    "collateralAmount",
    "amountToPay",
    "healthFactor18",
    "collateralAmountLiquidated"
  ];
  const headers = ["block"];
  mapPoolAdapters.forEach(index => {
    headers.push(...STATUS_HEADERS);
  });
  writeFileSync(pathOut, headers.join(";") + "\n", {encoding: 'utf8', flag: "a"});

  for (const r of results) {
    const lines = [r.block.trim()];
    mapPoolAdapters.forEach((index, address) => {
      const data = r.statuses.get(index);
      if (data) {
        lines.push(address);
        lines.push(data.collateralAmount.toString());
        lines.push(data.amountToPay.toString());
        lines.push(data.healthFactor18.toString());
        lines.push(data.collateralAmountLiquidated.toString());
      } else {
        lines.push(...[Array(STATUS_HEADERS.length).keys()].map(x => ""));
      }
    });
    writeFileSync(pathOut, lines.join(";") + "\n", {encoding: 'utf8', flag: "a"});
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });