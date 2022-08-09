import {ethers, network} from "hardhat";
import {IPlatformAdapter} from "../../../typechain";
import {writeFileSync} from "fs";
import {MaticAddresses} from "../../addresses/MaticAddresses";
import {AdaptersHelper} from "../../../test/baseUT/AdaptersHelper";
import {CoreContractsHelper} from "../../../test/baseUT/CoreContractsHelper";
import {BigNumber} from "ethers";
import {AppDataTypes} from "../../../typechain/contracts/interfaces/IPlatformAdapter";
import {Misc} from "../../utils/Misc";
import {Aave3Helper} from "../helpers/Aave3Helper";

interface IItem {
    platformAdapter: IPlatformAdapter;
    title: string;
}

interface Plan {
    converter: string;
    borrowRateKind: number;
    liquidationThreshold18: BigNumber;
    borrowRate: BigNumber;
    ltv18: BigNumber;
    maxAmountToBorrowBT: BigNumber;
    maxAmountToSupplyCT: BigNumber;
}

interface Strategy {
    collateralAsset: string;
    borrowAsset: string;
    adapter: string;
    apr?: BigNumber;
    plan?: Plan;
}

interface IAsset {
    t: string;
    a: string;
}


/** Get APR for all pairs of assets and all platform adapters
 *
 *  npx hardhat run scripts/integration/lending/CompareApr.ts
 * */
async function main() {
    const signer = (await ethers.getSigners())[0];
    console.log("Compare APR");

    const net = await ethers.provider.getNetwork();
    console.log(net, network.name);

    const assets: IAsset[] = [
        {a: MaticAddresses.DAI, t: "DAI"}
      , {a: MaticAddresses.USDC, t: "USDC"}
      , {a: MaticAddresses.USDT, t: "USDT"}
      , {a: MaticAddresses.WMATIC, t: "WMATIC"}
      , {a: MaticAddresses.WBTS, t: "WBTS"}
      , {a: MaticAddresses.ChainLink, t: "ChainLink"}
      , {a: MaticAddresses.DefiPulseToken, t: "DefiPulseToken"}
      , {a: MaticAddresses.Aavegotchi_GHST, t: "Aavegotchi_GHST"}
      , {a: MaticAddresses.CRV, t: "CRV"}
      , {a: MaticAddresses.SUSHI, t: "SUSHI"}
      , {a: MaticAddresses.WETH, t: "WETH"}
      , {a: MaticAddresses.BALANCER, t: "BALANCER"}
      , {a: MaticAddresses.EURS, t: "EURS"}
      , {a: MaticAddresses.jEUR, t: "jEUR"}
      , {a: MaticAddresses.FRAX, t: "FRAX"}
    ];


    const controller = await CoreContractsHelper.createControllerWithPrices(signer);
    const templateAdapterStub = ethers.Wallet.createRandom().address;

    const platformAdapters: IItem[] = [
        {
            title: "aave3"
            , platformAdapter: await AdaptersHelper.createAave3PlatformAdapter(signer
                , controller.address
                , MaticAddresses.AAVE_V3_POOL
                , templateAdapterStub
                , templateAdapterStub
            )
        }
        , {
            title: "aaveTwo",
            platformAdapter: await AdaptersHelper.createAaveTwoPlatformAdapter(signer
                    , controller.address
                    , MaticAddresses.AAVE_V2_POOL
                    , templateAdapterStub
                )
        }
        , {
            title: "hunred finance",
            platformAdapter: await AdaptersHelper.createHundredFinancePlatformAdapter(signer
                , controller.address
                , MaticAddresses.HUNDRED_FINANCE_COMPTROLLER
                , templateAdapterStub
                , [
                    MaticAddresses.hDAI,
                    MaticAddresses.hMATIC,
                    MaticAddresses.hUSDC,
                    MaticAddresses.hETH,
                    MaticAddresses.hUSDT,
                    MaticAddresses.hWBTC,
                    MaticAddresses.hFRAX,
                    MaticAddresses.hLINK,
                ]
                , MaticAddresses.HUNDRED_FINANCE_ORACLE
            )
        }
        , {
            title: "DForce",
            platformAdapter: await AdaptersHelper.createDForcePlatformAdapter(signer
                , controller.address
                , MaticAddresses.DFORCE_CONTROLLER
                , templateAdapterStub
                , [
                    MaticAddresses.dForce_iUSDC,
                    MaticAddresses.dForce_iUSDT,
                    MaticAddresses.dForce_iUSX,
                    MaticAddresses.dForce_iDAI,
                    MaticAddresses.dForce_iWETH,
                    MaticAddresses.dForce_iWBTC,
                    MaticAddresses.dForce_iEUX,
                    MaticAddresses.dForce_iAAVE,
                    MaticAddresses.dForce_iCRV,
                    MaticAddresses.dForce_iDF,
                    MaticAddresses.dForce_iMATIC,
                ]
            )
        }
    ]

    const dest: Strategy[] = [];
    const lines: string[] = [];
    lines.push([
        "collateralAsset",
        "borrowAsset",
        "adapter",
        "apr",
        "borrowRateKind",
        "borrowRate",
        "converter",
        "ltv18",
        "liquidationThreshold18",
        "maxAmountToBorrowBT",
        "maxAmountToSupplyCT"
    ].join(","));

    const BLOCKS_PER_DAY = 40000;
    const SECONDS_PER_DAY = 86400;

    for (const collateral of assets) {
        for (const borrow of assets) {
            if (collateral == borrow) continue;

            for (const pa of platformAdapters) {
                console.log(`Collateral ${collateral.t} borrow=${borrow.t} adapter=${pa.title}`);
                const plan = await pa.platformAdapter.getConversionPlan(collateral.a, borrow.a);
                if (plan.converter == Misc.ZERO_ADDRESS) {
                    dest.push({
                        collateralAsset: collateral.t,
                        borrowAsset: borrow.t,
                        adapter: pa.title
                    });
                } else {
                    dest.push({
                        collateralAsset: collateral.t,
                        borrowAsset: borrow.t,
                        adapter: pa.title,
                        plan: plan,
                        apr: plan.borrowRateKind == 1
                            ? plan.borrowRate
                            : plan.borrowRate.mul(SECONDS_PER_DAY).div(BLOCKS_PER_DAY)
                    });
                }

                const st = dest[dest.length - 1];
                const line = [
                    st.collateralAsset,
                    st.borrowAsset,
                    st.adapter,
                    st.apr,
                    st.plan?.borrowRateKind,
                    st.plan?.borrowRate,
                    st.plan?.converter,
                    st.plan?.ltv18,
                    st.plan?.liquidationThreshold18,
                    st.plan?.maxAmountToBorrowBT,
                    st.plan?.maxAmountToSupplyCT
                ];

                lines.push(line.map(x => Aave3Helper.toString(x)).join(","));
            }
        }
    }

    writeFileSync('./tmp/compare_apr.csv', lines.join("\n"), 'utf8');
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });