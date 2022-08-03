import {
    Controller,
    IBorrowManager, IController, IConverter,
    ITetuConverter,
    PriceOracleStub
} from "../../typechain";
import {CoreContractsHelper} from "./CoreContractsHelper";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {DeployUtils} from "../../scripts/utils/DeployUtils";

export interface ILendingPlatformFabric {
    createAndRegisterPools: (deployer: SignerWithAddress, controller: IController) => Promise<void>;
}

export class SetupTetuConverterApp {
    static async buildApp(
        deployer: SignerWithAddress,
        fabrics: ILendingPlatformFabric[]
    ) : Promise<{tc: ITetuConverter, controller: IController}> {
        const controller = (await DeployUtils.deployContract(deployer, "Controller")) as Controller;
        const priceOracle = (await DeployUtils.deployContract(deployer
            , "PriceOracleStub"
            , getBigNumberFrom(1)
        )) as PriceOracleStub;

        const bm = await CoreContractsHelper.createBorrowManager(deployer, controller);
        const tc = await CoreContractsHelper.createTetuConverter(deployer, controller);
        const dm = await CoreContractsHelper.createDebtMonitor(deployer, controller);

        await controller.assignBatch(
            [
                await controller.borrowManagerKey()
                , await controller.priceOracleKey()
                , await controller.tetuConverterKey()
                , await controller.debtMonitorKey()
                , await controller.governanceKey()
            ], [
                bm.address
                , priceOracle.address
                , tc.address
                , dm.address
                , deployer.address
            ]
        );

        for (const fabric of fabrics) {
            await fabric.createAndRegisterPools(deployer, controller);
        }

        return {tc, controller};
    }
}