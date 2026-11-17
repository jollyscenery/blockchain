const hre = require("hardhat");
const { writeDeployment } = require("./deployment-info");

async function main() {
  const Factory = await hre.ethers.getContractFactory("AssetRegistry");
  const c = await Factory.deploy();
  await c.waitForDeployment();
  const address = await c.getAddress();
  const { chainId } = await hre.ethers.provider.getNetwork();
  const artifact = await hre.artifacts.readArtifact("AssetRegistry");
  await writeDeployment(hre.ethers.provider, address, Number(chainId), artifact.abi);
}
main().catch((e) => { console.error(e); process.exit(1); });
