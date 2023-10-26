export function plusDebtGap(amount: number, debtGapEnabled: boolean, repayPart: number = 100_000): number {
  if (debtGapEnabled) {
    return amount * repayPart / 100_000 * 101 / 100;
  } else {
    return amount * repayPart / 100_000;
  }
}

export function withDebtGap(amount: number, debtGapEnabled: boolean): number {
  return debtGapEnabled
    ? amount * 101/ 100
    : amount;
}

// export function removeDebtGap(x: number, debtGapEnabled: boolean): number {
//   return debtGapEnabled
//     ? x * 100 / 101
//     : x;
// }