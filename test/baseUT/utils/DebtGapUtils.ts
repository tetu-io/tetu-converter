export function plusDebtGap(x: number, debtGapEnabled: boolean): number {
  return debtGapEnabled
    ? x * 101 / 100
    : x;
}

export function removeDebtGap(x: number, debtGapEnabled: boolean): number {
  return debtGapEnabled
    ? x * 100 / 101
    : x;
}