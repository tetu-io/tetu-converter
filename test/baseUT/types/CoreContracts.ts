import {
  Bookkeeper,
  Bookkeeper__factory,
  BorrowManager, BorrowManager__factory,
  ConverterController,
  DebtMonitor, DebtMonitor__factory,
  SwapManager, SwapManager__factory,
  TetuConverter, TetuConverter__factory,
} from "../../../typechain";

export class CoreContracts {
  readonly controller: ConverterController;
  readonly tc: TetuConverter;
  readonly bm: BorrowManager;
  readonly dm: DebtMonitor;
  readonly swapManager: SwapManager;
  readonly bookkeeper: Bookkeeper;

  constructor(
    controller: ConverterController,
    tc: TetuConverter,
    bm: BorrowManager,
    dm: DebtMonitor,
    swapManager: SwapManager,
    bookkeeper: Bookkeeper
  ) {
    this.controller = controller;
    this.tc = tc;
    this.bm = bm;
    this.dm = dm;
    this.swapManager = swapManager;
    this.bookkeeper = bookkeeper;
  }

  public static async build(controller: ConverterController): Promise<CoreContracts> {
    return new CoreContracts(
      controller,
      TetuConverter__factory.connect(await controller.tetuConverter(), controller.signer),
      BorrowManager__factory.connect(await controller.borrowManager(), controller.signer),
      DebtMonitor__factory.connect(await controller.debtMonitor(), controller.signer),
      SwapManager__factory.connect(await controller.swapManager(), controller.signer),
      Bookkeeper__factory.connect(await controller.bookkeeper(), controller.signer),
    );
  }
}
