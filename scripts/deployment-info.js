const fs = require("node:fs");
const path = require("node:path");
const { getAddress, keccak256, ZeroAddress } = require("ethers");
const { readDeploymentCode } = require("./deployment-networks");

async function writeDeployment(provider, address, chainId, abi, validateCode) {
  address = getAddress(address);
  if (address === ZeroAddress) throw new Error("Alamat contract tidak valid.");
  const code = await readDeploymentCode(provider, address, chainId);
  if (validateCode) await validateCode(code);

  const out = { address, chainId, abi, codeHash: keccak256(code) };
  for (const file of ["frontend/src/contract.json", "backend/contract.json"]) {
    fs.writeFileSync(path.resolve(__dirname, "..", file), JSON.stringify(out, null, 2) + "\n");
  }
  console.log(`AssetRegistry ${address} pada chain ID ${chainId}.`);
  console.log("Deployment disalin ke frontend/src/contract.json dan backend/contract.json.");
}

module.exports = { writeDeployment };
