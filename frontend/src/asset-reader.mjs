import { Interface } from "ethers";

// Legacy IDs are contiguous and soft deletion never removes an ID.
// Bound every response to one asset and every displayed page to <=25 IDs.
export const ASSET_PAGE_SIZE = 12;
export const MAX_ASSET_TEXT_BYTES = 256;
const errors = new Interface(["error Error(string)"]);

export async function readAssetPage(contract, cursor = 0n, limit = ASSET_PAGE_SIZE, signal) {
  cursor = BigInt(cursor);
  if (cursor < 0n || !Number.isInteger(limit) || limit < 1 || limit > 25) {
    throw new Error("Rentang halaman aset tidak valid.");
  }
  const blockTag = await contract.runner.provider.getBlockNumber();
  const cache = new Map();
  const check = () => signal?.throwIfAborted();
  async function probe(id) {
    check();
    if (cache.has(id)) return cache.get(id);
    try {
      const value = await contract.getAsset(id, { blockTag });
      check();
      const asset = value.toObject();
      cache.set(id, asset);
      return asset;
    } catch (error) {
      check();
      let reason = error.reason || error.revert?.args?.[0];
      try { reason ||= errors.parseError(error.data)?.args?.[0]; } catch { /* Not an ABI revert. */ }
      if (reason === "Aset tidak ditemukan") {
        cache.set(id, null);
        return null;
      }
      // Authorization and RPC failures must never look like an empty registry.
      throw error;
    }
  }
  let total = 0n;
  if (await probe(0n)) {
    let low = 0n;
    let high = 1n;
    for (let i = 0; await probe(high); i++) {
      if (i >= 63) throw new Error("Rentang registry terlalu besar untuk pembacaan ini.");
      low = high;
      high *= 2n;
    }
    while (high - low > 1n) {
      const mid = (low + high) / 2n;
      if (await probe(mid)) low = mid;
      else high = mid;
    }
    total = high;
  }
  const end = cursor + BigInt(limit) < total ? cursor + BigInt(limit) : total;
  const items = [];
  // Sequential reads keep the RPC burst small, including on shared test RPCs.
  for (let id = cursor; id < end; id++) {
    const asset = await probe(id);
    if (asset?.active) items.push(asset);
  }
  check();
  return { items, total, cursor, end, blockTag };
}
