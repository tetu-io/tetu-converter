import {BigNumber} from "ethers";

export interface IAaveKeyState {
    rate: BigNumber;
    liquidityIndex: BigNumber;
    reserveNormalized: BigNumber;
    block: number;
    blockTimeStamp: number;
    scaledBalance: BigNumber;
    userBalanceBase: BigNumber
    lastUpdateTimestamp: number;
}

export interface IAaveKeyTestValues {
    borrowRatePredicted: BigNumber;
    liquidityRatePredicted: BigNumber;

    liquidity: {
        beforeBorrow: IAaveKeyState,
        next: IAaveKeyState,
        last: IAaveKeyState
    },
    borrow: {
        beforeBorrow: IAaveKeyState,
        next: IAaveKeyState,
        last: IAaveKeyState
    },
}


