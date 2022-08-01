import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
    Aave3PlatformAdapter,
    Aave3PoolAdapter,
    HundredFinancePlatformAdapter,
    HundredFinancePoolAdapter
} from "../../typechain";
import {DeployUtils} from "../../scripts/utils/DeployUtils";

export class AdaptersHelper {
//region AAVE
    public static async createAave3PlatformAdapter(
        signer: SignerWithAddress
        , controller: string
        , poolAave: string
        , templateAdapterNormal: string
        , templateAdapterEMode: string
    ) : Promise<Aave3PlatformAdapter> {
        return (await DeployUtils.deployContract(
            signer,
            "Aave3PlatformAdapter",
            controller,
            poolAave,
            templateAdapterNormal,
            templateAdapterEMode
        )) as Aave3PlatformAdapter;
    }

    public static async createAave3PoolAdapter(signer: SignerWithAddress) : Promise<Aave3PoolAdapter> {
        return (await DeployUtils.deployContract(signer, "Aave3PoolAdapter")) as Aave3PoolAdapter;
    }
//endregion AAVE

//region Hundred finance
    public static async createHundredFinancePlatformAdapter(
        signer: SignerWithAddress
        , controller: string
        , comptroller: string
        , templateAdapterNormal: string
        , cTokensActive: string[]
    ) : Promise<HundredFinancePlatformAdapter> {
        return (await DeployUtils.deployContract(
            signer,
            "HundredFinancePlatformAdapter",
            controller,
            comptroller,
            templateAdapterNormal,
            cTokensActive
        )) as HundredFinancePlatformAdapter;
    }

    public static async createHundredFinancePoolAdapter(signer: SignerWithAddress) : Promise<HundredFinancePoolAdapter> {
        return (await DeployUtils.deployContract(signer, "HundredFinancePoolAdapter")) as HundredFinancePoolAdapter;
    }
//endregion Hundred finance
}