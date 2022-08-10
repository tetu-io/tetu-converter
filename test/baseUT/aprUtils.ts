import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";

export const COUNT_BLOCKS_PER_DAY = 41142; // 15017140 / 365
const COUNT_SECONDS_PER_YEAR = 31536000;
export class AprUtils {

    static aprPerBlock18(br27: BigNumber, countBlocksPerDay: number = COUNT_BLOCKS_PER_DAY) : BigNumber {
        return br27
            .div(COUNT_SECONDS_PER_YEAR)
            .div(COUNT_SECONDS_PER_YEAR).mul(365).mul(COUNT_BLOCKS_PER_DAY)
            .mul(getBigNumberFrom(1, 18))
            .div(getBigNumberFrom(1, 27));
    }
}