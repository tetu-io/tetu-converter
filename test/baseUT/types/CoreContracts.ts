import {
  BorrowManager,
  Controller,
  DebtMonitor,
  SwapManager,
  TetuConverter,
} from "../../../typechain";
import {tetu} from "../../../typechain/contracts/integrations";

export class CoreContracts {
  readonly controller: Controller;
  readonly tc: TetuConverter;
  readonly bm: BorrowManager;
  readonly dm: DebtMonitor;
  readonly swapManager: SwapManager;

  constructor(
    controller: Controller,
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
}