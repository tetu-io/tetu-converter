import {ethers, network} from "hardhat";
import {writeFileSync} from "fs";
import {MoonwellHelper} from "../../integration/moonwell/MoonwellHelper";

/**
 * Download detailed info for all available Hundred-finance pool(s) and tokens
 *      npx hardhat run scripts/tasks/download-pools-info/DownloadMoonwell.ts
 */
async function main() {
    const signer = (await ethers.getSigners())[0];
    console.log("download moonwell info");

    const net = await ethers.provider.getNetwork();
    console.log(net, network.name);

    const comptroller = MoonwellHelper.getComptroller(signer);

    const lines = await MoonwellHelper.getData(signer, comptroller);
    writeFileSync('./tmp/moonwell_reserves.csv', lines.join("\n"), 'utf8');
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });