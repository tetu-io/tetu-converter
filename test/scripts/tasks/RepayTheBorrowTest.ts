import {ethers} from "hardhat";
import {RepayTheBorrowImpl} from "../../../scripts/tasks/RepayTheBorrowImpl";
import {IConverterController__factory, ITetuConverter__factory} from "../../../typechain";
import {DeployerUtils} from "../../../scripts/utils/DeployerUtils";

describe.skip("test repayTheBorrow script", () => {
  it("should return expected values", async () => {
    const tetuConverterAddress = "0x081735DEa3D1256881B7cb31cd37c4f7C3E95152";
    const strategyAddress = "0x807a528818113a6f65b7667a59a4CaaAc719fc12";
    const poolAdapterAddress = "0xa20F9638C027cD40549C918972062690f6D095bD";

    // const signer = localHardhatIsInUse
    //   ? await DeployerUtils.startImpersonate("TODO governance")
    //   : (await ethers.getSigners())[0];
    const signer = (await ethers.getSigners())[0];
    console.log("signer", signer.address);

    const tetuConverter = ITetuConverter__factory.connect(tetuConverterAddress, signer);
    const converter = IConverterController__factory.connect(await tetuConverter.controller(), signer);
    const governance = await converter.governance();

    await RepayTheBorrowImpl.callRepayTheBorrow(
      await DeployerUtils.startImpersonate(governance),
      tetuConverterAddress,
      strategyAddress,
      poolAdapterAddress
    );
  });
});