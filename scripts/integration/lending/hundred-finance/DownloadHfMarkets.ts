import {ethers, network} from "hardhat";
import {writeFileSync} from "fs";
import {IHfComptroller} from "../../../../typechain";
import {HundredFinanceHelper} from "../../helpers/HundredFinanceHelper";

/** Download detailed info for all available Hundred-finance pool(s) and tokens
 *
 * npx hardhat run scripts/integration/lending/hundred-finance/DownloadHfMarkets.ts
 * */
async function main() {
    const signer = (await ethers.getSigners())[0];
    console.log("getInfoAboutHundredFinanceMarkets");

    const net = await ethers.provider.getNetwork();
    console.log(net, network.name);

    const comptroller: IHfComptroller = HundredFinanceHelper.getComptroller(signer);

    const lines = await HundredFinanceHelper.getData(signer, comptroller);
    writeFileSync('./tmp/hf_reserves.csv', lines.join("\n"), 'utf8');
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });