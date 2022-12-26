import {EmulateWork, IEmulationCommand} from "./EmulateWork";
import {readFileSync} from "fs";
import {Borrower, Controller, IERC20Metadata} from "../../typechain";

/**
 * Load list of commands from the CSV file
 * run them on emulator
 * and save results to the CSV file
 */
export class EmulateExecutor {
  public static async makeEmulation(
    emulator: EmulateWork,
    pathCsvIn: string,
    pathCsvOut: string
  ) {
    const results: string[] = [];

    const commands = [...this.parseCsv(pathCsvIn)];
    for (const command of commands) {
      try {
        const commandResult = await emulator.executeCommand(command);
        // tslint:disable-next-line:no-any
      } catch (e: any) {
        console.log(e);
        const re = /VM Exception while processing transaction: reverted with reason string\s*(.*)/i;
        let error = "Unknown error";
        if (e.message) {
          const found = e.message.match(re);
          error = found[1];
        }
        results.push(error);
      }
    }
  }

  /** CSV => list of IEmulationCommand */
  public static *parseCsv(pathCsvIn: string) : IterableIterator<IEmulationCommand> {
    const data = readFileSync(pathCsvIn, 'utf8');
    const lines = data.split('\n').filter(Boolean);
    for (const line of lines) {
      const cells = line.trim().split(/[,;]/);
      if (! cells || cells.length < 7) {
        throw Error(`Incorrect csv line: ${line} ${cells}`);
      }
      if (cells[0] === 'command') continue; // header

      yield {
        command: cells[0],
        user: cells[1],
        asset1: cells[2],
        asset2: cells[3],
        amount: cells[4],
        holder: cells[5],
        pauseInBlocks: cells[6],
      }
    }
  }
}