import {BorrowManager, Controller, DebtMonitor, TetuConverter} from "../../../typechain";

export class CoreContracts {
  readonly controller: Controller;
  readonly tc: TetuConverter;
  readonly bm: BorrowManager;
  readonly dm: DebtMonitor;

  constructor(
    controller: Controller,
    tc: TetuConverter,
    bm: BorrowManager,
    dm: DebtMonitor
  ) {
    this.controller = controller;
    this.tc = tc;
    this.bm = bm;
    this.dm = dm;
  }
}