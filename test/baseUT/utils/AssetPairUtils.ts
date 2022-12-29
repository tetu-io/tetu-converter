export interface IAssetPair {
  smallerAddress: string;
  biggerAddress: string;
}

export function generateAssetPairs(assets: string[]) : IAssetPair[] {
  const dest: IAssetPair[] = [];
  for (let i = 0; i < assets.length; ++i) {
    for (let j = i + 1; j < assets.length; ++j) {
      if (assets[i] < assets[j]) {
        dest.push({
          smallerAddress: assets[i],
          biggerAddress: assets[j]
        });
      } else {
        dest.push({
          smallerAddress: assets[j],
          biggerAddress: assets[i]
        });
      }
    }
  }
  return  dest;
}

export function getAssetPair(asset1: string, asset2: string) : IAssetPair {
  return asset1 < asset2
    ? {
      smallerAddress: asset1,
      biggerAddress: asset2
    }
    : {
      smallerAddress: asset2,
      biggerAddress: asset1
    }
}
