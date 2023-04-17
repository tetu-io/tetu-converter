import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  Aave3PlatformAdapter,
  Aave3PoolAdapter,
  Aave3PoolAdapterEMode,
  AaveTwoPlatformAdapter,
  AaveTwoPoolAdapter,
  Compound3PlatformAdapter,
  Compound3PoolAdapter,
  DForcePlatformAdapter,
  DForcePoolAdapter,
  HfPlatformAdapter,
  HfPoolAdapter, IConverterController__factory
} from "../../../typechain";
import {DeployUtils} from "../../../scripts/utils/DeployUtils";

export class AdaptersHelper {
//region AAVE.v3
  public static async createAave3PlatformAdapter(
    signer: SignerWithAddress,
    controller: string,
    poolAave: string,
    templateAdapterNormal: string,
    templateAdapterEMode: string,
    borrowManager?: string,
  ) : Promise<Aave3PlatformAdapter> {
    return (await DeployUtils.deployContract(
      signer,
      "Aave3PlatformAdapter",
      controller,
      borrowManager || await IConverterController__factory.connect(controller, signer).borrowManager(),
      poolAave,
      templateAdapterNormal,
      templateAdapterEMode
    )) as Aave3PlatformAdapter;
  }

  public static async createAave3PoolAdapter(signer: SignerWithAddress) : Promise<Aave3PoolAdapter> {
    return (await DeployUtils.deployContract(signer, "Aave3PoolAdapter")) as Aave3PoolAdapter;
  }
  public static async createAave3PoolAdapterEMode(signer: SignerWithAddress) : Promise<Aave3PoolAdapterEMode> {
    return (await DeployUtils.deployContract(signer, "Aave3PoolAdapterEMode")) as Aave3PoolAdapterEMode;
  }
//endregion AAVE.v2

//region AAVE.TWO
  public static async createAaveTwoPlatformAdapter(
    signer: SignerWithAddress,
    controller: string,
    poolAave: string,
    templateAdapterNormal: string,
    borrowManager?: string,
  ) : Promise<AaveTwoPlatformAdapter> {
    return (await DeployUtils.deployContract(
      signer,
      "AaveTwoPlatformAdapter",
      controller,
      borrowManager || await IConverterController__factory.connect(controller, signer).borrowManager(),
      poolAave,
      templateAdapterNormal,
    )) as AaveTwoPlatformAdapter;
  }

  public static async createAaveTwoPoolAdapter(signer: SignerWithAddress) : Promise<AaveTwoPoolAdapter> {
    return (await DeployUtils.deployContract(signer, "AaveTwoPoolAdapter")) as AaveTwoPoolAdapter;
  }
//endregion AAVE.TWO

//region HundredFinance
  public static async createHundredFinancePlatformAdapter(
    signer: SignerWithAddress,
    controller: string,
    comptroller: string,
    templateAdapterNormal: string,
    cTokensActive: string[],
    borrowManager?: string,
  ) : Promise<HfPlatformAdapter> {
    return (await DeployUtils.deployContract(
      signer,
      "HfPlatformAdapter",
      controller,
      borrowManager || await IConverterController__factory.connect(controller, signer).borrowManager(),
      comptroller,
      templateAdapterNormal,
      cTokensActive,
    )) as HfPlatformAdapter;
  }

  public static async createHundredFinancePoolAdapter(signer: SignerWithAddress) : Promise<HfPoolAdapter> {
    return (await DeployUtils.deployContract(signer, "HfPoolAdapter")) as HfPoolAdapter;
  }
//endregion HundredFinance

//region dForce
  public static async createDForcePlatformAdapter(
    signer: SignerWithAddress,
    controller: string,
    comptroller: string,
    templateAdapterNormal: string,
    cTokensActive: string[],
    borrowManager?: string,
  ) : Promise<DForcePlatformAdapter> {
    return (await DeployUtils.deployContract(
      signer,
      "DForcePlatformAdapter",
      controller,
      borrowManager || await IConverterController__factory.connect(controller, signer).borrowManager(),
      comptroller,
      templateAdapterNormal,
      cTokensActive,
    )) as DForcePlatformAdapter;
  }

  public static async createDForcePoolAdapter(signer: SignerWithAddress) : Promise<DForcePoolAdapter> {
    return (await DeployUtils.deployContract(signer, "DForcePoolAdapter")) as DForcePoolAdapter;
  }
//endregion dForce

//region Compound3
  public static async createCompound3PlatformAdapter(
    signer: SignerWithAddress,
    controller: string,
    templateAdapterNormal: string,
    comets: string[],
    cometRewards: string,
    borrowManager?: string,
  ) : Promise<Compound3PlatformAdapter> {
    return (await DeployUtils.deployContract(
      signer,
      "Compound3PlatformAdapter",
      controller,
      borrowManager || await IConverterController__factory.connect(controller, signer).borrowManager(),
      templateAdapterNormal,
      comets,
      cometRewards
    )) as Compound3PlatformAdapter;
  }

  public static async createCompound3PoolAdapter(signer: SignerWithAddress) : Promise<Compound3PoolAdapter> {
    return (await DeployUtils.deployContract(signer, "Compound3PoolAdapter")) as Compound3PoolAdapter;
  }

//endregion Compound3
}
