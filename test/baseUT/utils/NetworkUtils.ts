import {ethers, network} from "hardhat";

export async function isPolygonForkInUse() {
  const localHardhatIsInUse = network.name === "localhost" || network.name === "hardhat";
  const net = await ethers.provider.getNetwork();
  return net.chainId === 137 && localHardhatIsInUse;
}