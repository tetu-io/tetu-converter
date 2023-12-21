export interface IPlatformUtilsProvider {
  getPlatformName: () => string;
  getAssetName: (asset: string) => string;
  getCToken(asset: string) : string;
  getAllCTokens(): string[];
  getAllAssets(): string[];
}