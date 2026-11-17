const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const Factory = await hre.ethers.getContractFactory("AssetRegistry");
  const c = await Factory.deploy();
  await c.waitForDeployment();
  const address = await c.getAddress();
  const { chainId } = await hre.ethers.provider.getNetwork();
  const artifact = await hre.artifacts.readArtifact("AssetRegistry");

  const out = { address, chainId: Number(chainId), abi: artifact.abi };
  fs.writeFileSync(path.join(__dirname, "../frontend/src/contract.json"), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(__dirname, "../backend/contract.json"), JSON.stringify(out, null, 2));
  console.log("AssetRegistry deployed:", address, "chainId:", chainId.toString());
  console.log("ABI ditulis ke frontend/src/contract.json dan backend/contract.json");
}
main().catch((e) => { console.error(e); process.exit(1); });
