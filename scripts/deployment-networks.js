const networks = new Map([
  [31337, { variable: "RPC_URL", url: "http://127.0.0.1:8545" }],
  [11155111, { variable: "SEPOLIA_RPC_URL", url: "https://ethereum-sepolia-rpc.publicnode.com" }],
]);

function getDeploymentRpcUrl(chainId) {
  const network = networks.get(chainId);
  if (!network) throw new Error("Chain ID tidak didukung. Gunakan 31337 (Hardhat Local) atau 11155111 (Sepolia).");
  const url = process.env[network.variable] || network.url;
  try {
    if (["http:", "https:"].includes(new URL(url).protocol)) return url;
  } catch {
    // Avoid including a credential-bearing URL in an error.
  }
  throw new Error(`Isi ${network.variable} dengan URL RPC HTTP(S) yang valid.`);
}

async function readDeploymentCode(provider, address, chainId) {
  const network = await provider.getNetwork().catch(() => {
    throw new Error(`Gagal membaca chain ID dari RPC untuk jaringan ${chainId}.`);
  });
  if (network.chainId !== BigInt(chainId)) {
    throw new Error(`RPC memakai chain ID ${network.chainId}, seharusnya ${chainId}.`);
  }
  const code = await provider.getCode(address).catch(() => {
    throw new Error(`Gagal membaca bytecode AssetRegistry dari RPC untuk jaringan ${chainId}.`);
  });
  if (code === "0x") throw new Error(`Contract tidak ditemukan di ${address}.`);
  return code;
}

module.exports = { getDeploymentRpcUrl, readDeploymentCode };
