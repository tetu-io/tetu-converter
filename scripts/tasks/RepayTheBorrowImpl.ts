import {
  BorrowManager__factory, IConverterController__factory,
  IERC20__factory,
  IPoolAdapterBeta7__factory,
  ITetuConverter__factory
} from "../../typechain";
import {MaticAddresses} from "../addresses/MaticAddresses";
import {RunHelper} from "../utils/RunHelper";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

export class RepayTheBorrowImpl {
  static async callRepayTheBorrow(
    signer: SignerWithAddress,
    tetuConverterAddress: string,
    strategyAddress: string,
    poolAdapterAddress: string,
    borrowManagerAddress: string
  ) {
    const tetuConverter = ITetuConverter__factory.connect(tetuConverterAddress, signer);
    const converter = IConverterController__factory.connect(await tetuConverter.controller(), signer);
    const governance = await converter.governance();
    console.log("governance", governance);

    const borrowManager = BorrowManager__factory.connect(borrowManagerAddress, signer);
    const pa0 = await borrowManager.listPoolAdapters(0);
    console.log(pa0);


    const poolAdapter = IPoolAdapterBeta7__factory.connect(poolAdapterAddress, signer);
    const usdc = IERC20__factory.connect(MaticAddresses.USDC, signer);
    const usdt = IERC20__factory.connect(MaticAddresses.USDT, signer);

    console.log("usdc balance before", await usdc.balanceOf(strategyAddress));
    console.log("usdt balance before", await usdt.balanceOf(strategyAddress));
    console.log("status before", await poolAdapter.getStatus());

    await RunHelper.runAndWait(
      () => tetuConverter.repayTheBorrow(poolAdapterAddress, true)
    );

    console.log("usdc balance after", await usdc.balanceOf(strategyAddress));
    console.log("usdt balance after", await usdt.balanceOf(strategyAddress));
    console.log("status after", await poolAdapter.getStatus());
  }
}