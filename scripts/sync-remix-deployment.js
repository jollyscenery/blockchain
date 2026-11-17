const fs = require("node:fs/promises");
const path = require("node:path");
const { getAddress, isAddress, Interface, JsonRpcProvider } = require("ethers");
const { writeDeployment } = require("./deployment-info");
const { getDeploymentRpcUrl } = require("./deployment-networks");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

// Remix and Hardhat can encode different source paths in the Solidity metadata.
function executableCode(bytecode) {
  const hex = bytecode.slice(2);
  const metadataBytes = Number.parseInt(hex.slice(-4), 16);
  const metadataStart = hex.length - (metadataBytes + 2) * 2;
  if (metadataStart < 2 || hex.slice(metadataStart, metadataStart + 2) !== "a2") {
    throw new Error("Metadata compiler tidak sesuai. Periksa pengaturan Solidity di README.");
  }
  return hex.slice(0, metadataStart);
}

// Reuse Hardhat's pinned compiler and original input without replacing the Paris artifact.
async function shanghaiBytecode({ sourceName, contractName }) {
  const hre = require("hardhat");
  const tasks = require("hardhat/builtin-tasks/task-names");
  const build = await hre.artifacts.getBuildInfo(`${sourceName}:${contractName}`);
  if (!build) throw new Error("Build info tidak ditemukan. Jalankan npm run compile -- --force.");
  const { solcVersion } = build;
  const input = { ...build.input, settings: { ...build.input.settings, evmVersion: "shanghai" } };
  const solc = await hre.run(tasks.TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, { solcVersion, quiet: true });
  const output = await (solc.isSolcJs
    ? hre.run(tasks.TASK_COMPILE_SOLIDITY_RUN_SOLCJS, { input, solcJsPath: solc.compilerPath })
    : hre.run(tasks.TASK_COMPILE_SOLIDITY_RUN_SOLC, { input, solcPath: solc.compilerPath, solcVersion }));
  return "0x" + output.contracts[sourceName][contractName].evm.deployedBytecode.object;
}

async function main() {
  const [rawAddress, rawChainId, abiFile] = process.argv.slice(2);
  if (!rawAddress || !rawChainId || !abiFile) {
    throw new Error("Gunakan: npm run sync:remix -- <alamat> <31337|11155111> <remix-abi.json>");
  }
  const chainId = Number(rawChainId);
  const rpcUrl = getDeploymentRpcUrl(chainId);
  if (!isAddress(rawAddress)) throw new Error("Alamat contract tidak valid.");
  const address = getAddress(rawAddress);
  const abi = JSON.parse((await fs.readFile(abiFile, "utf8")).replace(/^\uFEFF/, ""));
  const artifact = require("../artifacts/contracts/AssetRegistry.sol/AssetRegistry.json");
  const abiEntries = (value) => value.map((entry) => {
    const fragments = new Interface([entry]).format();
    if (fragments.length !== 1) throw new Error("ABI memuat entri yang tidak valid.");
    return fragments[0];
  }).sort();
  if (!Array.isArray(abi) || JSON.stringify(abiEntries(abi)) !== JSON.stringify(abiEntries(artifact.abi))) {
    throw new Error("ABI Remix berbeda dengan ABI AssetRegistry. Kompilasi ulang contract yang benar.");
  }

  const provider = new JsonRpcProvider(rpcUrl);
  try {
    await writeDeployment(provider, address, chainId, abi, async (code) => {
      const deployed = executableCode(code);
      if (deployed === executableCode(artifact.deployedBytecode)) return;
      if (chainId === 11155111 && deployed === executableCode(await shanghaiBytecode(artifact))) return;
      throw new Error("Bytecode berbeda dari AssetRegistry. Periksa alamat dan pengaturan compiler Remix.");
    });
  } finally {
    provider.destroy();
  }
}

main().catch((error) => {
  console.error(error.code === "MODULE_NOT_FOUND" ? "Jalankan npm run compile terlebih dahulu." : error.message);
  process.exitCode = 1;
});
