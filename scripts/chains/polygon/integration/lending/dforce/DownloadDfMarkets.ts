import {ethers, network} from "hardhat";
import {writeFileSync} from "fs";
import {IDForceController} from "../../../../../../typechain";
import {DForceHelper} from "../../helpers/DForceHelper";

/**
 * Download detailed info for all available Hundred-finance pool(s) and tokens
 *    npx hardhat run scripts/integration/lending/dforce/downloaddfmarkets.ts
 */
async function main() {
    const signer = (await ethers.getSigners())[0];
    console.log("Download dForce info");

    const net = await ethers.provider.getNetwork();
    console.log(net, network.name);

    const controller: IDForceController = DForceHelper.getController(signer);

    const lines = await DForceHelper.getData(signer, controller);
    writeFileSync('./tmp/df_reserves.csv', lines.join("\n"), 'utf8');
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });