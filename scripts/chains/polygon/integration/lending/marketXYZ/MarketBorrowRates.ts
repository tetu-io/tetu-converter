import {IFusePoolDirectory__factory, IFusePoolLens__factory} from "../../../../../../typechain";
import {MaticAddresses} from "../../../../../addresses/MaticAddresses";
import {ethers, network} from "hardhat";
import {utils} from "ethers";
import {writeFileSync} from "fs";

export async function getInfoAboutFusePools() : Promise<string> {
  const signer = (await ethers.getSigners())[0];
  console.log("getInfoAboutFusePools");

  const net = await ethers.provider.getNetwork();
  console.log(net, network.name);

  const fusePoolDirectory = await IFusePoolDirectory__factory.connect(MaticAddresses.MARKET_POOL_DIRECTORY, signer);

  // MARKET_POOL_LENS address marked as deprecated in docs, but it's used here: https://github.com/marketxyz/market-dApp/blob/master/src/fuse-sdk/src/addrs.js
  const fusePoolLens = await IFusePoolLens__factory.connect(MaticAddresses.MARKET_POOL_LENS, signer);

  const tokens = await fusePoolDirectory.getAllPools();
  const items: string[] = [];
  const header = [
    "id"
    , "comptroller"
    , "underlyingName"
    , "underlyingToken"
    , "cToken"
    , "totalSupply"
    , "totalBorrowed"
    , "borrowRatePerBlock"
    , "borrowRatePerBlockFull"
    , "collateralFactor"
    , "underlyingPrice"
    , "liquidity"
    , "fuseFee"
    , "adminFee"
    , "decimals"
  ];
  console.log(header.join(","));
  items.push(header.join(","));

  for (let i = 0; i < tokens.length; i++) {
    console.log('id', i);
    const pool = tokens[i];
    console.log('pool', pool.name);
    const poolInfo = await fusePoolLens.callStatic.getPoolAssetsWithData(pool.comptroller,{gasLimit: '10000000000000'});

    // see https://docs.rari.capital/fuse/#fusepoolasset
    for (const info of poolInfo) {
      console.log(info);

      // Amount of the underlying token supplied in the pool. Scaled by underlyingDecimals.
      const totalSupply = +utils.formatUnits(info.totalSupply, info.underlyingDecimals);

      // Amount of the underlying token being borrowed in pool. Scaled by underlyingDecimals.
      const totalBorrowed = +utils.formatUnits(info.totalBorrow, info.underlyingDecimals);

      // Borrow interest rate for the token in the pool. Can be converted to APY/APR as shown here.
      // https://github.com/Rari-Capital/rari-dApp/blob/master/src/utils/apyUtils.ts#L1
      // The borrow interest rate per block, scaled by 1e18
      const borrowRatePerBlock = +utils.formatUnits(info.borrowRatePerBlock, 18);

      // A percentage representing how much of the asset's value in USD
      // can be borrowed against if the asset is lent as collateral. 18 decimals (where 1e18 is 100% and 0 is 0%).
      const collateralFactor = +utils.formatUnits(info.collateralFactor, 18);

      // Price of underlying tokens denominated in ETH.
      // Its decimals are a function of underlyingDecimals: 1e(36 - underlyingDecimals).
      const underlyingPrice = +utils.formatUnits(info.underlyingPrice, 36 - info.underlyingDecimals.toNumber());

      // Proportion of borrow interest that is converted into reserves.
      // 18 decimals (where 1e18 is 100% and 0 is 0%).
      const fuseFee = +utils.formatUnits(info.fuseFee, info.underlyingDecimals);

      // Proportion of borrow interest that is converted into admin fees.
      // 18 decimals (where 1e18 is 100% and 0 is 0%).
      const adminFee = +utils.formatUnits(info.adminFee, info.underlyingDecimals);

      const liquidity = +utils.formatUnits(info.liquidity, info.underlyingDecimals);

      const data = [
        i
        , pool.comptroller
        , info.underlyingName
        , info.underlyingToken
        , info.cToken
        , totalSupply.toString()
        , totalBorrowed.toString()
        , borrowRatePerBlock.toString()
        , info.borrowRatePerBlock
        , collateralFactor.toString()
        , underlyingPrice.toString()
        , liquidity.toString()
        , fuseFee.toString()
        , adminFee.toString()
        , info.underlyingDecimals.toString()
      ];
      items.push(data.join(","));
      console.log(data.join(","));
    }
  }
  return items.join("\n");
}

/** Get info for all available fuse pools
 *
 *      npx hardhat run scripts/data/lending/MarketBorrowRates.ts
 * */
async function main() {
  const lines = await getInfoAboutFusePools();
  writeFileSync('./tmp/market.csv', lines, 'utf8');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
