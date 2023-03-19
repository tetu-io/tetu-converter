import {
  BorrowManager, BorrowManager__factory,
  ConverterController,
  DebtMonitor, DebtMonitor__factory,
  SwapManager, SwapManager__factory,
  TetuConverter, TetuConverter__factory,
} from "../../../typechain";
import {CoreContractsHelper} from "../helpers/CoreContractsHelper";

export class CoreContracts {
  readonly controller: ConverterController;
  readonly tc: TetuConverter;
  readonly bm: BorrowManager;
  readonly dm: DebtMonitor;
  readonly swapManager: SwapManager;

  constructor(
    controller: ConverterController,
    tc: TetuConverter,
    bm: BorrowManager,
    dm: DebtMonitor,
    swapManager: SwapManager
  ) {
    this.controller = controller;
    this.tc = tc;
    this.bm = bm;
    this.dm = dm;
    this.swapManager = swapManager;
  }

  public static async build(controller: ConverterController): Promise<CoreContracts> {
    return new CoreContracts(
      controller,
      TetuConverter__factory.connect(await controller.tetuConverter(), controller.signer),
      BorrowManager__factory.connect(await controller.borrowManager(), controller.signer),
      DebtMonitor__factory.connect(await controller.debtMonitor(), controller.signer),
      SwapManager__factory.connect(await controller.swapManager(), controller.signer),
    );
  }
}
