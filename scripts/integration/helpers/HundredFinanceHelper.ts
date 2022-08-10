import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
    IHfComptroller,
    IHfComptroller__factory,
    IHfCToken,
    IHfCToken__factory,
    IHfInterestRateModel,
    IHfInterestRateModel__factory,
    IHfOracle__factory,
    IHfOracle, IERC20__factory, IERC20Extended__factory,
} from "../../../typechain";
import {BigNumber, Signer} from "ethers";
import {Aave3Helper} from "./Aave3Helper";
import {MaticAddresses} from "../../addresses/MaticAddresses";

//region Constants


//endregion Constants

//region Data types
interface InterestRateModel {
    address: string;
    name: string;
    borrowRate18: BigNumber;
    supplyRate18: BigNumber;
    blocksPerYear: BigNumber;
    baseRatePerBlock: BigNumber;
}

interface IHfData {
    comptroller: string;
    name: string;
    symbol: string;
    decimals: number;
    ctoken: string;
    underlying: string;
    /** The supply interest rate per block, scaled by 1e18 */
    borrowRatePerBlock: BigNumber;
    exchangeRateStored: BigNumber;
    /** cash balance of this cToken in the underlying asset */
    cash: BigNumber;
    /** Total amount of outstanding borrows of the underlying in this market */
    totalBorrows: BigNumber;
    /** Total amount of reserves of the underlying held in this market */
    totalReserves: BigNumber;
    /** Total number of tokens in circulation */
    totalSupply: BigNumber;
    /** Fraction of interest currently set aside for reserves */
    reserveFactorMantissa: BigNumber;
    /** isListed represents whether the comptroller recognizes this cToken */
    isListed: boolean;
    /** collateralFactorMantissa, scaled by 1e18, is multiplied by a supply balance to determine how much value can be borrowed */
    collateralFactorMantissa: BigNumber;
    /** isComped indicates whether or not suppliers and borrowers are distributed COMP tokens. */
    isComped: boolean;
    closeFactorMantissa: BigNumber;
    /** Model which tells what the current interest rate should be */
    interestRateModel: string;
    borrowCap: BigNumber;
    bprotocol: string;
    price: BigNumber;
    underlineDecimals: number;

    blocksPerYear: BigNumber;
}

//endregion Data types

export class HundredFinanceHelper {
//region Access
    public static getComptroller(signer: SignerWithAddress) : IHfComptroller {
        return IHfComptroller__factory.connect(MaticAddresses.HUNDRED_FINANCE_COMPTROLLER, signer);
    }

    public static getPriceOracle(signer: SignerWithAddress) : IHfOracle {
        return IHfOracle__factory.connect(MaticAddresses.HUNDRED_FINANCE_ORACLE, signer);
    }
//endregion Access

//region Read data
    public static async getInterestRateModel(
        irm: IHfInterestRateModel,
        cToken: IHfCToken
    ) : Promise<InterestRateModel> {
        console.log(`getInterestRateModel ${await irm.name()}`);
        const dest: InterestRateModel = {
            name: await irm.name(),
            baseRatePerBlock: await irm.baseRatePerBlock(),
            borrowRate18: await irm.getBorrowRate(
                await cToken.getCash(),
                await cToken.totalBorrows(),
                await cToken.totalReserves()
            ),
            supplyRate18: await irm.getSupplyRate(
                await cToken.getCash(),
                await cToken.totalBorrows(),
                await cToken.totalReserves(),
                await cToken.reserveFactorMantissa()
            ),
            blocksPerYear: await irm.blocksPerYear(),
            address: await irm.address
        }

        return dest;
    }

    public static async getCTokenData(
        signer: SignerWithAddress,
        comptroller: IHfComptroller,
        cToken: IHfCToken,

    ) : Promise<IHfData> {
        const m = await comptroller.markets(cToken.address);
        const irm = IHfInterestRateModel__factory.connect(await cToken.interestRateModel(), signer);
        const priceOracle = IHfOracle__factory.connect(MaticAddresses.HUNDRED_FINANCE_ORACLE, signer);


        return {
            comptroller: await cToken.comptroller(),
            ctoken: cToken.address,
            underlying: cToken.address == MaticAddresses.hMATIC
                ? "" //hMATIC doesn't support CErc20Storage and doesn't have underlying property
                : await cToken.underlying(),
            name: await cToken.name(),
            symbol: await cToken.symbol(),
            decimals: await cToken.decimals(),
            borrowRatePerBlock: await cToken.borrowRatePerBlock(),
            exchangeRateStored: await cToken.exchangeRateStored(),
            cash: await cToken.getCash(),
            reserveFactorMantissa: await cToken.reserveFactorMantissa(),
            totalBorrows: await cToken.totalBorrows(),
            totalReserves: await cToken.totalReserves(),
            totalSupply: await cToken.totalSupply(),
            isListed: m.isListed,
            collateralFactorMantissa: m.collateralFactorMantissa,
            isComped: m.isComped,
            closeFactorMantissa: await comptroller.closeFactorMantissa(),
            interestRateModel: await cToken.interestRateModel(),
            borrowCap: await comptroller.borrowCaps(cToken.address),
            /** TODO: https://docs.bprotocol.org/ */
            bprotocol: await comptroller.bprotocol(cToken.address),
            price: await priceOracle.getUnderlyingPrice(cToken.address),
            underlineDecimals: await IERC20Extended__factory.connect(
                cToken.address == MaticAddresses.hMATIC
                    ? MaticAddresses.WMATIC
                    : await cToken.underlying()
                , signer
            ).decimals(),
            blocksPerYear: await irm.blocksPerYear()
        }
    }
//endregion Read data

//region Get data for script
    public static async getData(
        signer: SignerWithAddress,
        comptroller: IHfComptroller
    ) : Promise<string[]> {
        const markets = await comptroller.getAllMarkets();
        const dest: string[] = [];
        dest.push([
            "name",
            "comptroller",
            "symbol", "decimals", "ctoken", "underline",
            "borrowRatePerBlock", "exchangeRateStored",
            "cash", "reserveFactorMantissa",
            "totalBorrows", "totalReserves", "totalSupply",
            "isListed", "collateralFactorMantissa",
            "isComped", "closeFactorMantissa",
            "interestRateModel", "borrowCap", "bprotocol",
            "borrowRate18", "supplyRate18", "baseRatePerBlock", "blocksPerYear", "irmName",
            "price", "underlineDecimals",
            "blocksPerYear"
        ].join(","));

        const getInterestRateModel = HundredFinanceHelper.memoize(
            async token => HundredFinanceHelper.getInterestRateModel(
                    IHfInterestRateModel__factory.connect(await token.interestRateModel(), signer),
                    token
                )
            );

        for (const market of markets) {
            console.log(`Market ${market}`);

            const cToken = IHfCToken__factory.connect(market, signer);
            const rd = await HundredFinanceHelper.getCTokenData(signer, comptroller, cToken);
            const irm = await getInterestRateModel(cToken);

            const line = [
                rd.name,
                rd.comptroller,
                rd.symbol, rd.decimals, rd.ctoken, rd.underlying,
                rd.borrowRatePerBlock, rd.exchangeRateStored,
                rd.cash, rd.reserveFactorMantissa,
                rd.totalBorrows, rd.totalReserves, rd.totalSupply,
                rd.isListed, rd.collateralFactorMantissa,
                rd.isComped, rd.closeFactorMantissa,
                rd.interestRateModel, rd.borrowCap, rd.bprotocol,
                irm.borrowRate18, irm.supplyRate18, irm.baseRatePerBlock, irm.blocksPerYear, irm.name,
                rd.price, rd.underlineDecimals,
                rd.blocksPerYear
            ];

            dest.push(line.map(x => Aave3Helper.toString(x)).join(","));
        }

        return dest;
    }
//endregion Get data for script

//region Utils
    public static memoize<T>(fn: (token: IHfCToken) => Promise<T>) : (token: IHfCToken) => Promise<T> {
        const cache = new Map<string, T>();
        return async (token: IHfCToken) => {
            const irmAddress = await token.interestRateModel();
            let ret = cache.get(irmAddress);
            if (!ret) {
                ret = await fn(token);
                cache.set(irmAddress, ret);
            }
            return ret;
        }
    }
//endregion Utils
}