import {
    Controller,
    IController, IERC20,
    ITetuConverter
} from "../../typechain";
import {CoreContractsHelper} from "./CoreContractsHelper";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";
import {COUNT_BLOCKS_PER_DAY} from "../utils/aprUtils";
import {ILendingPlatformFabric} from "../interfaces/ILendingPlatformFabric";


export class TetuConverterApp {
    static async buildApp(
        deployer: SignerWithAddress,
        fabrics: ILendingPlatformFabric[]
    ) : Promise<{tc: ITetuConverter, controller: IController, pools: IERC20[]}> {
        const controller = (await DeployUtils.deployContract(deployer, "Controller"
            , COUNT_BLOCKS_PER_DAY)) as Controller;
        await controller.initialize([await controller.governanceKey()], [deployer.address]);

        const bm = await CoreContractsHelper.createBorrowManager(deployer, controller);
        const tc = await CoreContractsHelper.createTetuConverter(deployer, controller);
        const dm = await CoreContractsHelper.createDebtMonitor(deployer, controller);

        await controller.assignBatch(
            [
                await controller.borrowManagerKey()
                , await controller.tetuConverterKey()
                , await controller.debtMonitorKey()
                , await controller.governanceKey()
            ], [
                bm.address
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