import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {TimeUtils} from "../../../../scripts/utils/TimeUtils";
import {ICErc20, ICErc20__factory, IComptroller__factory, IERC20__factory} from "../../../../typechain";

describe("Temp", () => {
//region Global vars for all tests
    let snapshot: string;
    let snapshotForEach: string;
    let signer: SignerWithAddress;
    let user1: SignerWithAddress;
    let user2: SignerWithAddress;
    let user3: SignerWithAddress;
    let user4: SignerWithAddress;
    let user5: SignerWithAddress;
//endregion Global vars for all tests

//region before, after
    before(async function () {
        this.timeout(1200000);
        snapshot = await TimeUtils.snapshot();
        const signers = await ethers.getSigners();
        signer = signers[0];
        user1 = signers[2];
        user2 = signers[3];
        user3 = signers[4];
        user4 = signers[5];
        user5 = signers[6];
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

    it("temp", async() => {
        // check two USDC pools of Market
        // see derivative tokens addresses
        // try to use that derivative tokens as collaterals
        const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
        const POOL_1 = "0x7a9c2075493dBC9E3EdFC8a4C44613a372cb99bF";
        const POOL_2 = "0x24F7F8f89c647973Cfb770A31CB6ba4aBc92Cf3C";

        const pool1 = await ICErc20__factory.connect(POOL_1, signer);
        const addressComptroller = await pool1.comptroller();
        const comptroller = await IComptroller__factory.connect(addressComptroller, signer);

        comptroller.getAssetsIn()

        const pool2 = await IERC20__factory.connect(POOL_2, signer);
    });
});