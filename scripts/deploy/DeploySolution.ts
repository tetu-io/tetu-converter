import {
  DeploySolutionUtils
} from "./DeploySolutionUtils";

/**
 * Deploy TetuConverter application to blockchain.
 * 1) Deploy all core contracts
 * 2) Deploy all Platform adapters and pool adapters
 * 3) Set up controller and borrow manager by default settings
 *
 * Set required network in .env, i.e.
 *      APP_HARDHAT_CHAIN_ID=137
 * and run one of the following commands to run the script on stand-alone hardhat:
 *      npx hardhat run scripts/deploy/DeploySolution.ts
 *      npx hardhat run --network localhost scripts/deploy/DeploySolution.ts
 */
async function main() {
  await DeploySolutionUtils.runMain();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });