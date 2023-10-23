export interface IPlatformUtilsProvider {
  getPlatformName: () => string;
  getAssetName: (asset: string) => string;
  getAssetHolder: (asset: string) => string;
}