
export class BaseAddresses {
//region ----------------------------------------------------- Assets
    public static WETH = "0x4200000000000000000000000000000000000006".toLowerCase();
    /** Coinbase Wrapped Staked ETH */
    public static cbETH = "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22".toLowerCase();
    public static USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913".toLowerCase();
    public static USDbC = "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA".toLowerCase();
    public static DAI = "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb".toLowerCase();

    /** https://docs.moonwell.fi/moonwell/protocol-information/contracts */
    public static WELL = "0xff8adec2221f9f4d8dfbafa6b9a297d17603493d".toLowerCase();

//endregion ----------------------------------------------------- Assets

//region -------------------------------------------------------- Tetu
    public static TETU_LIQUIDATOR = "0x22e2625F9d8c28CB4BcE944E9d64efb4388ea991";
    public static TETU_DISTOPIA_SWAPPER = "0x60BF9c1FC8b93B6400608c82107a852C54aD110F";
    public static TETU_UNIV3_SWAPPER = "0x00379dD90b2A337C4652E286e4FBceadef940a21";
//endregion -------------------------------------------------------- Tetu

//region ----------------------------------------------------- AAVE3
    public static AAVE_V3_POOL = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5".toLowerCase();
    public static AAVE_V3_POOL_ADDRESS_PROVIDER = "0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D".toLowerCase();
    public static AAVE_V3_PRICE_ORACLE = "0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156".toLowerCase();

    /** Contract creator of ACL Manager: https://polygonscan.com/address/0xa72636cbcaa8f5ff95b2cc47f3cdee83f3294a0b#events */
    public static AAVE_V3_POOL_ADMIN = "0x9390b1735def18560c509e2d0bc090e9d6ba257a"; // "0x5B540d168E2468270a3b5C66DD1A6E4ecE6BE593".toLowerCase(); // 0xA9F30e6ED4098e9439B2ac8aEA2d3fc26BcEbb45
    public static AAVE_V3_POOL_OWNER = "0x9390B1735def18560c509E2d0bc090E9d6BA257a";
    /** https://basescan.org/tx/0x65ada47b1e29db97b062d601cc2d3d4ba3b4ce8d35b24efd65fd03dd1ca130f0 */
    public static AAVE_V3_EMERGENCY_ADMIN = "0x9e10C0A1Eb8FF6a0AaA53a62C7a338f35D7D9a2A";
    public static AAVE_V3_RISK_ADMIN = "0x12deb4025b79f2b43f6aef079f9d77c3f9a67bb6";
//endregion ----------------------------------------------------- AAVE3


//region ----------------------------------------------------- Moonwell: https://docs.moonwell.fi/moonwell/protocol-information/contracts
    public static MOONWELL_COMPTROLLER = "0xfBb21d0380beE3312B33c4353c8936a0F13EF26C".toLowerCase();
    public static MOONWELL_TEMPORAL_GOVERNOR = "0x8b621804a7637b781e2BbD58e256a591F2dF7d51".toLowerCase();
    public static MOONWELL_MULTI_REWARD_DISTRIBUTOR = "0xe9005b078701e2A0948D2EaC43010D35870Ad9d2".toLowerCase();
    public static MOONWELL_CHAINLINK_ORACLE = "0xEC942bE8A8114bFD0396A5052c36027f2cA6a9d0".toLowerCase();
    public static MOONWELL_WETH_ROUTER = "0x31CCFB038771d9bF486Ef7c7f3A9F91bE72124C4".toLowerCase();
    public static MOONWELL_DAI = "0x73b06D8d18De422E269645eaCe15400DE7462417".toLowerCase();
    public static MOONWELL_USDC = "0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22".toLowerCase();
    public static MOONWELL_USDBC = "0x703843C3379b52F9FF486c9f5892218d2a065cC8".toLowerCase();
    public static MOONWELL_WETH = "0x628ff693426583D9a7FB391E54366292F509D457".toLowerCase();
    public static MOONWELL_CBETH = "0x3bf93770f2d4a794c3d9EBEfBAeBAE2a8f09A5E5".toLowerCase();

    public static POOL_WETH_WELL_VOLATILE_AMM = "0xffA3F8737C39e36dec4300B162c2153c67c8352f".toLowerCase();
//endregion ----------------------------------------------------- Moonwell

//region ----------------------------------------------------- UniswapV3
    // stable pools
    public static UNISWAPV3_USDC_USDbC_100 = '0x06959273E9A65433De71F5A452D529544E07dDD0'.toLowerCase()
    public static UNISWAPV3_DAI_USDbC_100 = '0x22F9623817F152148B4E080E98Af66FBE9C5AdF8'.toLowerCase()
//endregion ----------------------------------------------------- UniswapV3

//region ----------------------------------------------------- AAVE3
    public static AAVE3_USDbC_ATOKEN = '0x0a1d576f3eFeF75b330424287a95A366e8281D54'.toLowerCase()
    public static AAVE3_USDbC_ATOKEN_HOLDER = '0x8cd7e29e4f9101bd516f91d4de89ddc7692198fd'.toLowerCase()
    public static AAVE3_WETH_ATOKEN = '0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7'.toLowerCase()
    public static AAVE3_WETH_ATOKEN_HOLDER = '0xb463c4d7c574bd0a05a1320186378dd6a7aeaa33'.toLowerCase()

//endregion ----------------------------------------------------- AAVE3

//region ----------------------------------------------------- Holders
    public static HOLDER_WETH = "0x4b581deda2f2c0650c3dfc506c86a8c140d9f699".toLowerCase();
    public static HOLDER_WETH_1 = "0x428ab2ba90eba0a4be7af34c9ac451ab061ac010".toLowerCase();
    public static HOLDER_WETH_2 = "0x4bb6b2efe7036020ba6f02a05602546c9f25bf28".toLowerCase();

    public static HOLDER_CBETH = "0xd746a2a6048c5d3aff5766a8c4a0c8cfd2311745".toLowerCase();
    public static HOLDER_CBETH_1 = "0x20fe51a9229eef2cf8ad9e89d91cab9312cf3b7a".toLowerCase();
    public static HOLDER_CBETH_2 = "0x48be343c86e5d2233e874b23dbf123b0c2f80857".toLowerCase();

    public static HOLDER_USDC = "0x20fe51a9229eef2cf8ad9e89d91cab9312cf3b7a".toLowerCase();
    public static HOLDER_USDC_1 = "0x27531dff315dc3edc2ed3445144401e83dabf455".toLowerCase();
    public static HOLDER_USDC_2 = "0x43771dab5f9caf7b08679f878fc4caa410fd07fd".toLowerCase();

    public static HOLDER_USDBC = "0xef6ca7d0ea5d711a393c8626698a804a9ee885c4".toLowerCase();
    public static HOLDER_USDBC_1 = "0xc9d05a1c3c8e01dcb701d6185cdc21a5bb94becb".toLowerCase();
    public static HOLDER_USDBC_2 = "0x03d03a026e71979be3b08d44b01eae4c5ff9da99".toLowerCase();

    public static HOLDER_DAI = "0xef6ca7d0ea5d711a393c8626698a804a9ee885c4".toLowerCase();
    public static HOLDER_DAI_1 = "0x20f03e26968b179025f65c1f4afadfd3959c8d03".toLowerCase();
    public static HOLDER_DAI_2 = "0xc68a33de9ceac7bdaed242ae1dc40d673ed4f643".toLowerCase();
    public static HOLDER_DAI_3 = "0xdfea018fac77287512404ac174d6d068c4e17a2e".toLowerCase();

    public static HOLDER_WELL = "0xea6a5607d6563abbf5cc10715c7ad144a12228e1".toLowerCase();
//endregion ----------------------------------------------------- Holders
}