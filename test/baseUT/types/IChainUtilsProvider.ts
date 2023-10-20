export interface IChainUtilsProvider {
  getAssetName: (asset: string) => string;
  getAssetHolder: (asset: string) => string;
}