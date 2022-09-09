import {BigNumber} from "ethers";
import {getBigNumberFrom} from "../../../scripts/utils/NumberUtils";

export class ConfigurableAmountToBorrow {
  /**
   * true  - exactAmountToBorrow contains exact amount to borrow
   * false - ratio18 contains RATIO, amount to borrow will be calculated as
   *         amount to borrow = max allowed amount * RATIO
   *         The RATIO should have decimals 18
   * */
  exact: boolean;

  /** One of two fields below must be not empty depending on exact value*/

  exactAmountToBorrow?: BigNumber | number;
  ratio18?: BigNumber;

  constructor (isExact: boolean, value: BigNumber | number) {
    this.exact = isExact;
    if (isExact) {
      this.exactAmountToBorrow = value;
    } else {
      if (typeof(value) == "number") {
        this.ratio18 = getBigNumberFrom(value, 18);
      } else {
        this.ratio18 = value;
      }
    }
  }

  static getValue(a: ConfigurableAmountToBorrow, decimalsBorrow: number): BigNumber {
    if (a.exact) {
      if (a.exactAmountToBorrow) {
        if (typeof (a.exactAmountToBorrow) == "number") {
          return getBigNumberFrom(a.exactAmountToBorrow, decimalsBorrow);
        } else {
          return a.exactAmountToBorrow;
        }
      } else {
        throw "exactAmountToBorrow is not set";
      }
    } else {
      if (a.ratio18) {
        return a.ratio18
      } else {
        throw "ratio18 is not set";
      }
    }

  }
}
