export class NumberUtils {
  /**
   * If an asset has decimals i.e. 6
   * and we need to convert amount "0.123456789" to the asset amount
   * we will have overflow/underflow error.
   *
   * Trim decimals to the correct value to avoid overflow/underflow error
   * @param n
   * @param decimals
   */
  static trimDecimals(n: string, decimals: number){
    n+=""

    if (n.indexOf(".") === -1) {
      return n;
    }

    const arr = n.split(".");
    const fraction = arr[1] .substring(0, decimals);
    return arr[0] + "." + fraction;
  }
}