
export class BaseAddresses {
//region ----------------------------------------------------- Assets
    public static WETH = "0x4200000000000000000000000000000000000006".toLowerCase();
    /** Coinbase Wrapped Staked ETH */
    public static cbETH = "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22".toLowerCase();
    public static USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913".toLowerCase();
    public static USDDbC = "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA".toLowerCase();
    public static DAI = "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb".toLowerCase();

    /** https://docs.moonwell.fi/moonwell/protocol-information/contracts */
    public static WELL = "0xff8adec2221f9f4d8dfbafa6b9a297d17603493d".toLowerCase();

//endregion ----------------------------------------------------- Assets

//region ----------------------------------------------------- AAVE3
    public static AAVE_V3_POOL = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5".toLowerCase();
    public static AAVE_V3_POOL_ADDRESS_PROVIDER = "0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D".toLowerCase();
    public static AAVE_V3_PRICE_ORACLE = "0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156".toLowerCase();

    /** Contract creator of ACL Manager: https://polygonscan.com/address/0xa72636cbcaa8f5ff95b2cc47f3cdee83f3294a0b#events */
    public static AAVE_V3_POOL_ADMIN = "0x5B540d168E2468270a3b5C66DD1A6E4ecE6BE593".toLowerCase();
    public static AAVE_V3_POOL_OWNER = ""; // todo
    public static AAVE_V3_EMERGENCY_ADMIN = ""; // todo
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

//endregion ----------------------------------------------------- Moonwell
}