import {IDebtMonitor} from "../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {IReConverter} from "./ReСonverters";

/*
 * Implementation of keeper for reconversion of not-optimal borrows
 */
// export class Keeper {
//   dm: IDebtMonitor;
//   healthFactor2: number;
//   periodBlocks: number;
//   maxCountToCheck: number;
//   maxCountToReturn: number;
//   reConverter: IReConverter;
//   constructor(
//     dm: IDebtMonitor,
//     healthFactor2: number,
//     periodBlocks: number,
//     reConverter: IReConverter,
//     maxCountToCheck: number = 3,
//     maxCountToReturn: number = 2
//   ) {
//     this.dm = dm;
//     this.healthFactor2 = healthFactor2;
//     this.periodBlocks = periodBlocks;
//     this.maxCountToCheck = maxCountToCheck;
//     this.maxCountToReturn = maxCountToReturn;
//     this.reConverter = reConverter;
//   }
//
//   /** Find all positions that should be reconverted and reconvert them */
//   async makeKeeperJob(signer: SignerWithAddress) {
//     console.log("makeKeeperJob");
//
//     let startIndex0 = 0;
//     const poolAdaptersToReconvert: string[] = [];
//
//     // let's find all pool adapters that should be reconverted
//     do {
//       console.log("makeKeeperJob.checkForReconversion", startIndex0);
//
//       const ret = await this.dm.checkBetterBorrowExists(
//         startIndex0,
//         this.maxCountToCheck,
//         this.maxCountToReturn,
//         this.periodBlocks,
//       );
//       console.log("makeKeeperJob.checkForReconversion found items:", ret.poolAdapters.length);
//       poolAdaptersToReconvert.push(...ret.poolAdapters);
//       startIndex0 = ret.nextIndexToCheck0.toNumber();
//     } while (startIndex0 !== 0);
//
//     // let's reconvert all found pool adapters, each in the separate transaction
//     for (let i = 0; i < poolAdaptersToReconvert.length; ++i) {
//       console.log("makeKeeperJob.reconvert pool adapter:", poolAdaptersToReconvert[i]);
//       await this.reConverter.do(poolAdaptersToReconvert[i], signer);
//     }
//   }
// }