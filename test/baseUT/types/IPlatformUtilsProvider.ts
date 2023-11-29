export interface IPlatformUtilsProvider {
  getPlatformName: () => string;
  getAssetName: (asset: string) => string;
  getAssetHolder: (asset: string) => string;
  getAdditionalAssetHolders: (asset: string) => string[];
}