export function plusDebtGap(amount: number, debtGapEnabled: boolean, repayPart: number = 100_000): number {
  if (debtGapEnabled) {
    const ret = amount * repayPart / 100_000 * 101 / 100;
    return ret > amount ? amount : ret;
  } else {
    return amount * repayPart / 100_000;
  }
}

// export function removeDebtGap(x: number, debtGapEnabled: boolean): number {
//   return debtGapEnabled
//     ? x * 100 / 101
//     : x;
// }