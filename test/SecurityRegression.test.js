const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Governance and bounded reads", () => {
  let registry, admin, second, editor, viewer, reader;
  before(async () => { reader = await import("../frontend/src/asset-reader.mjs"); });
  beforeEach(async () => {
    [admin, second, editor, viewer] = await ethers.getSigners();
    registry = await ethers.deployContract("AssetRegistry");
    await registry.setRole(editor.address, 2);
    await registry.setRole(viewer.address, 1);
  });
  it("keeps Admins equal, forbids self-revocation, and enforces revoked Admin access", async () => {
    await registry.setRole(second.address, 4);
    await expect(registry.connect(second).revokeRole(second.address)).to.be.revertedWith("Tidak bisa mencabut role sendiri");
    await expect(registry.connect(second).setRole(second.address, 1)).to.be.revertedWith("Admin tidak boleh menurunkan diri sendiri");
    await registry.connect(second).revokeRole(admin.address);
    expect(await registry.getRole(admin.address)).to.equal(0);
    expect(await registry.getRole(second.address)).to.equal(4);
    await expect(registry.setRole(admin.address, 4)).to.be.revertedWith("Akses ditolak: role tidak cukup");
    await expect(registry.createAsset("A", "B", "C", "D", editor.address)).to.be.revertedWith("Akses ditolak: role tidak cukup");
    await registry.connect(second).setRole(admin.address, 4);
    expect(await registry.getRole(admin.address)).to.equal(4);
  });
  it("reads empty legacy registries and propagates authorization errors", async () => {
    expect((await reader.readAssetPage(registry.connect(viewer))).total).to.equal(0n);
    await expect(reader.readAssetPage(registry.connect(second))).to.be.rejectedWith("Akses ditolak");
    await expect(reader.readAssetPage(registry, 0n, 26)).to.be.rejectedWith("Rentang halaman");
  });
  it("bounds legacy reads, retains sparse/deleted IDs and uses one block snapshot", async () => {
    for (let i = 0; i < 40; i++) await registry.connect(editor).createAsset("A" + i, "IT", "Lt 2", "Baik", viewer.address);
    for (let i = 0; i < 12; i++) await registry.deleteAsset(i);
    const calls = [];
    const contract = {
      runner: registry.runner,
      getAsset: async (id, options) => { calls.push({ id, block: options.blockTag }); return registry.getAsset(id, options); },
      getAllAssets: () => { throw new Error("Aggregate read forbidden"); },
    };
    const empty = await reader.readAssetPage(contract, 0n);
    expect(empty.total).to.equal(40n);
    expect(empty.items).to.have.length(0);
    expect(empty.end).to.equal(12n);
    expect(calls.length).to.be.lessThan(30);
    expect(new Set(calls.map((call) => call.block)).size).to.equal(1);
    const page = await reader.readAssetPage(contract, 12n);
    expect(page.items.map((asset) => asset.id)).to.deep.equal(Array.from({ length: 12 }, (_, i) => BigInt(i + 12)));
    const last = await reader.readAssetPage(contract, 36n);
    expect(last.items).to.have.length(4);
    expect(last.end).to.equal(40n);
  });
  it("does not turn RPC errors or aborted reads into an empty page", async () => {
    const broken = { runner: registry.runner, getAsset: async () => { throw new Error("RPC unavailable"); } };
    await expect(reader.readAssetPage(broken)).to.be.rejectedWith("RPC unavailable");
    const controller = new AbortController();
    controller.abort();
    await expect(reader.readAssetPage(registry, 0n, 12, controller.signal)).to.be.rejected;
  });
});

describe("Proposed AssetRegistryV2 (local only)", () => {
  let registry, admin, editor, viewer, outsider, fields;
  beforeEach(async () => {
    [admin, editor, viewer, outsider] = await ethers.getSigners();
    registry = await ethers.deployContract("AssetRegistryV2");
    await registry.setRole(editor.address, 2);
    await registry.setRole(viewer.address, 1);
    fields = ["Laptop", "IT", "Lt 2", "Baik", viewer.address];
  });
  it("limits page sizes/cursors and permissions including empty registries", async () => {
    expect((await registry.getAssetsPage(0, 25))[0]).to.have.length(0);
    for (const limit of [0, 26, ethers.MaxUint256]) {
      await expect(registry.getAssetsPage(0, limit)).to.be.revertedWith("Ukuran halaman tidak valid");
      await expect(registry.getMembersPage(0, limit)).to.be.revertedWith("Ukuran halaman tidak valid");
    }
    await expect(registry.getAssetsPage(1, 1)).to.be.revertedWith("Cursor tidak valid");
    await expect(registry.connect(outsider).getAssetsPage(0, 1)).to.be.revertedWith("Akses ditolak: role tidak cukup");
    await expect(registry.connect(editor).getMembersPage(0, 1)).to.be.revertedWith("Akses ditolak: role tidak cukup");
  });
  it("bounds scanned IDs even when the entire requested page is deleted", async () => {
    for (let i = 0; i < 28; i++) await registry.connect(editor).createAsset(...fields);
    for (let i = 0; i < 25; i++) await registry.deleteAsset(i);
    const [first, next] = await registry.connect(viewer).getAssetsPage(0, 25);
    expect(first).to.have.length(0);
    expect(next).to.equal(25n);
    const [last, end] = await registry.connect(viewer).getAssetsPage(next, 25);
    expect(last.map((a) => a.id)).to.deep.equal([25n, 26n, 27n]);
    expect(end).to.equal(28n);
    expect(await registry.assetCount()).to.equal(28n);
    await expect(registry.updateAsset(0, ...fields)).to.be.revertedWith("Aset tidak ditemukan");
    await expect(registry.deleteAsset(0)).to.be.revertedWith("Aset tidak ditemukan");
  });
  it("rejects oversized UTF-8 input on create/update and preserves previous state", async () => {
    await registry.createAsset(...fields);
    for (let index = 0; index < 4; index++) {
      const invalid = [...fields]; invalid[index] = "é".repeat(129);
      await expect(registry.createAsset(...invalid)).to.be.revertedWith("Teks terlalu panjang");
      await expect(registry.updateAsset(0, ...invalid)).to.be.revertedWith("Teks terlalu panjang");
    }
    await registry.updateAsset(0, "x".repeat(256), ...fields.slice(1));
    expect((await registry.getAsset(0)).name).to.have.length(256);
    expect(await registry.assetCount()).to.equal(1n);
  });
  it("keeps fixed-page gas bounded as the registry grows", async () => {
    for (let i = 0; i < 5; i++) await registry.createAsset(...fields);
    const before = await registry.getAssetsPage.estimateGas(0, 5);
    for (let i = 0; i < 60; i++) await registry.createAsset(...fields);
    const after = await registry.getAssetsPage.estimateGas(0, 5);
    expect(after).to.be.at.most(before + 5000n);
    expect(after).to.be.lessThan(1000000n);
  });
  it("preserves events, timestamps, Editor restrictions, revocation and member history", async () => {
    await expect(registry.connect(editor).createAsset(...fields)).to.emit(registry, "AssetCreated").withArgs(0, editor.address);
    const original = await registry.getAsset(0);
    await expect(registry.connect(viewer).updateAsset(0, ...fields)).to.be.revertedWith("Akses ditolak: role tidak cukup");
    await expect(registry.connect(editor).deleteAsset(0)).to.be.revertedWith("Akses ditolak: role tidak cukup");
    await expect(registry.updateAsset(0, ...fields)).to.emit(registry, "AssetUpdated");
    await expect(registry.deleteAsset(0)).to.emit(registry, "AssetDeleted");
    const deleted = await registry.getAsset(0);
    expect(deleted.createdAt).to.equal(original.createdAt);
    expect(deleted.updatedAt).to.be.greaterThan(original.updatedAt);
    expect(deleted.active).to.equal(false);
    await registry.revokeRole(editor.address);
    await expect(registry.connect(editor).getAssetsPage(0, 1)).to.be.revertedWith("Akses ditolak: role tidak cukup");
    const [addresses, roles, next] = await registry.getMembersPage(0, 25);
    expect(addresses).to.have.length(3);
    expect(roles[1]).to.equal(0n);
    expect(next).to.equal(3n);
  });
});
