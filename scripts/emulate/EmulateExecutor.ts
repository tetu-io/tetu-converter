import {EmulateWork, IEmulationCommand} from "./EmulateWork";
import {readFileSync, writeFileSync} from "fs";

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
    // generate headers
    const headers: string[] = ["error",
      "command", "user", "asset1", "asset2", "amount", "holder", "pause in blocks",
      "converter",
    ];
    for (let i = 0; i < emulator.users.length; ++i) {
      for (const asset of emulator.assets) {
        headers.push(`${i + 1}-${await asset.symbol()}`); // user_id1 - assetName
      }
    }
    writeFileSync(pathCsvOut, headers.join(";") + "\n", {encoding: 'utf8', flag: "a" });

    const commands = [...this.parseCsv(pathCsvIn)];
    for (const command of commands) {
      const row: string[] = []; // empty error
      try {
        const commandResult = await emulator.executeCommand(command);
        row.push(""); // no error
        row.push(...this.getCommandAsCsvLine(command));
        row.push(commandResult.converter || "");
        for (let i = 0; i < emulator.users.length; ++i) {
          for (let j = 0; j < emulator.assets.length; ++j) {
            row.push(commandResult.userResults[i].assetBalances[j]);
          }
        }
        // tslint:disable-next-line:no-any
      } catch (e: any) {
        console.log(e);
        const re = /VM Exception while processing transaction: reverted with reason string\s*(.*)/i;
        let error = "Unknown error";
        if (e.message) {
          const found = e.message.match(re);
          error = found[1];
        }
        row.push(error);
        row.push(...this.getCommandAsCsvLine(command));
      }

      const srow = row.join(";");
      writeFileSync(pathCsvOut, srow + "\n", {encoding: 'utf8', flag: "a" });
      console.log(srow);
    }
  }

  public static getCommandAsCsvLine(command: IEmulationCommand) : string[] {
    return [
      command.command,
      command.user,
      command.asset1,
      command.asset2,
      command.amount,
      command.holder,
      command.pauseInBlocks
    ];
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