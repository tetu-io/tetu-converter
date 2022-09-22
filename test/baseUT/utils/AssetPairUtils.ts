export interface IAssetPair {
  smallerAddress: string;
  biggerAddress: string;
}

export function generateAssetPairs(underlying: string[]) : IAssetPair[] {
  const dest: IAssetPair[] = [];
  for (let i = 0; i < underlying.length; ++i) {
    for (let j = i + 1; j < underlying.length; ++j) {
      if (underlying[i] < underlying[j]) {
        dest.push({
          smallerAddress: underlying[i]
          , biggerAddress: underlying[j]
        });
      } else {
        dest.push({
          smallerAddress: underlying[j]
          , biggerAddress: underlying[i]
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
