import {
    Controller,
    IBorrowManager, IController, IConverter, IERC20,
    ITetuConverter,
    PriceOracleStub
} from "../../typechain";
import {CoreContractsHelper} from "./CoreContractsHelper";
import {getBigNumberFrom} from "../../scripts/utils/NumberUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {DeployUtils} from "../../scripts/utils/DeployUtils";

export interface ILendingPlatformFabric {
    /** return addresses of pools */
    createAndRegisterPools: (deployer: SignerWithAddress, controller: IController) => Promise<IERC20[]>;
}

export class TetuConverterApp {
    static async buildApp(
        deployer: SignerWithAddress,
        fabrics: ILendingPlatformFabric[]
    ) : Promise<{tc: ITetuConverter, controller: IController, pools: IERC20[]}> {
        const controller = (await DeployUtils.deployContract(deployer, "Controller")) as Controller;
        await controller.initialize([await controller.governanceKey()], [deployer.address]);
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

        const pools: IERC20[] = [];
        for (const fabric of fabrics) {
            const pp = await fabric.createAndRegisterPools(deployer, controller);
            pools.push(...pp);
        }

        return {tc, controller, pools};
    }
}