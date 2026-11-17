const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("AssetRegistry", () => {
  const denied = "Akses ditolak: role tidak cukup";
  const notFound = "Aset tidak ditemukan";
  const [VIEWER, EDITOR, MANAGER, ADMIN] = [1n, 2n, 3n, 4n];
  let registry, admin, manager, editor, viewer, other, fields;

  beforeEach(async () => {
    [admin, manager, editor, viewer, other] = await ethers.getSigners();
    registry = await ethers.deployContract("AssetRegistry");
    await registry.setRole(viewer.address, VIEWER);
    await registry.setRole(editor.address, EDITOR);
    await registry.setRole(manager.address, MANAGER);
    fields = ["Laptop", "IT", "Lt 2", "Baik", viewer.address];
  });

  it("memberi deployer role Admin dan mencatat event awal", async () => {
    expect(await registry.getRole(admin.address)).to.equal(ADMIN);
    await expect(registry.deploymentTransaction()).to.emit(registry, "RoleChanged")
      .withArgs(admin.address, ADMIN, admin.address);
  });

  it("mengizinkan Admin menetapkan semua role dan membaca daftar anggota", async () => {
    for (const role of [VIEWER, EDITOR, MANAGER, ADMIN]) {
      await expect(registry.setRole(other.address, role)).to.emit(registry, "RoleChanged")
        .withArgs(other.address, role, admin.address);
      expect(await registry.getRole(other.address)).to.equal(role);
    }
    const [addresses, roles] = await registry.getMembers();
    expect([...addresses]).to.deep.equal([admin.address, viewer.address, editor.address, manager.address, other.address]);
    expect([...roles]).to.deep.equal([ADMIN, VIEWER, EDITOR, MANAGER, ADMIN]);
    await registry.connect(other).setRole(viewer.address, EDITOR);
    expect(await registry.getRole(viewer.address)).to.equal(EDITOR);
  });

  it("mengizinkan Viewer membaca satu aset dan daftar aset", async () => {
    await registry.createAsset(...fields);
    const viewerRegistry = registry.connect(viewer);
    expect((await viewerRegistry.getAsset(0)).name).to.equal("Laptop");
    expect((await viewerRegistry.getAllAssets()).map(({ id }) => id)).to.deep.equal([0n]);
  });

  it("menolak tulis aset oleh Viewer dan hapus oleh Editor", async () => {
    await registry.createAsset(...fields);
    const viewerRegistry = registry.connect(viewer);
    await expect(viewerRegistry.createAsset(...fields)).to.be.revertedWith(denied);
    await expect(viewerRegistry.updateAsset(0, ...fields)).to.be.revertedWith(denied);
    await expect(viewerRegistry.deleteAsset(0)).to.be.revertedWith(denied);
    await expect(registry.connect(editor).deleteAsset(0)).to.be.revertedWith(denied);
  });

  it("menolak pengelolaan role oleh Manager, Editor, Viewer, dan None", async () => {
    for (const account of [manager, editor, viewer, other]) {
      const client = registry.connect(account);
      await expect(client.setRole(other.address, VIEWER)).to.be.revertedWith(denied);
      await expect(client.revokeRole(viewer.address)).to.be.revertedWith(denied);
      await expect(client.getMembers()).to.be.revertedWith(denied);
    }
  });

  it("menolak seluruh operasi aset oleh akun None", async () => {
    const client = registry.connect(other);
    expect(await client.getRole(other.address)).to.equal(0n);
    await expect(client.getAsset(0)).to.be.revertedWith(denied);
    await expect(client.getAllAssets()).to.be.revertedWith(denied);
    await expect(client.createAsset(...fields)).to.be.revertedWith(denied);
    await expect(client.updateAsset(0, ...fields)).to.be.revertedWith(denied);
    await expect(client.deleteAsset(0)).to.be.revertedWith(denied);
  });

  it("menyimpan semua field saat Editor membuat dan memperbarui aset", async () => {
    const client = registry.connect(editor);
    await expect(client.createAsset(...fields)).to.emit(registry, "AssetCreated").withArgs(0, editor.address);
    const createdAt = BigInt(await time.latest());
    const oldAsset = await client.getAsset(0);
    expect([...oldAsset]).to.deep.equal([0n, ...fields, editor.address, createdAt, createdAt, true]);

    const updated = ["Monitor", "Elektronik", "Lt 3", "Rusak", manager.address];
    await time.increase(60);
    await expect(client.updateAsset(0, ...updated)).to.emit(registry, "AssetUpdated").withArgs(0, editor.address);
    const updatedAt = BigInt(await time.latest());
    expect([...(await client.getAsset(0))]).to.deep.equal(
      [0n, ...updated, editor.address, createdAt, updatedAt, true],
    );
    expect(updatedAt > createdAt).to.equal(true);
  });

  it("mengizinkan Manager dan Admin membuat, mengubah, dan melakukan soft delete", async () => {
    for (const [id, account] of [manager, admin].entries()) {
      const client = registry.connect(account);
      await client.createAsset(...fields);
      await client.updateAsset(id, "Laptop B", ...fields.slice(1));
      const before = await client.getAsset(id);
      await time.increase(60);
      await expect(client.deleteAsset(id)).to.emit(registry, "AssetDeleted").withArgs(id, account.address);
      const after = await registry.connect(viewer).getAsset(id);
      expect([...after]).to.deep.equal([...before.slice(0, 8), BigInt(await time.latest()), false]);
      expect(await registry.connect(viewer).getAllAssets()).to.have.length(0);
      await expect(client.updateAsset(id, ...fields)).to.be.revertedWith(notFound);
      await expect(client.deleteAsset(id)).to.be.revertedWith(notFound);
    }
  });

  it("menolak ID yang belum ada", async () => {
    for (const id of [0, ethers.MaxUint256]) {
      await expect(registry.getAsset(id)).to.be.revertedWith(notFound);
      await expect(registry.updateAsset(id, ...fields)).to.be.revertedWith(notFound);
      await expect(registry.deleteAsset(id)).to.be.revertedWith(notFound);
    }
  });

  it("memvalidasi empat field teks dan custodian pada create dan update", async () => {
    await registry.createAsset(...fields);
    const invalid = [
      [" \t", "Nama wajib diisi"], ["", "Kategori wajib diisi"], [" ", "Lokasi wajib diisi"],
      ["\n", "Kondisi wajib diisi"], [ethers.ZeroAddress, "Alamat penanggung jawab tidak valid"],
    ];
    for (const [index, [value, reason]] of invalid.entries()) {
      const input = [...fields];
      input[index] = value;
      await expect(registry.createAsset(...input)).to.be.revertedWith(reason);
      await expect(registry.updateAsset(0, ...input)).to.be.revertedWith(reason);
    }
    expect((await registry.getAllAssets()).map(({ name }) => name)).to.deep.equal(["Laptop"]);
  });

  it("mencabut role dan menolak transisi role yang tidak valid", async () => {
    await expect(registry.revokeRole(viewer.address)).to.emit(registry, "RoleChanged")
      .withArgs(viewer.address, 0, admin.address);
    expect(await registry.getRole(viewer.address)).to.equal(0n);
    await expect(registry.connect(viewer).getAllAssets()).to.be.revertedWith(denied);
    await expect(registry.revokeRole(viewer.address)).to.be.revertedWith("Wallet belum memiliki role");
    await expect(registry.revokeRole(ethers.ZeroAddress)).to.be.revertedWith("Alamat tidak valid");
    await expect(registry.setRole(ethers.ZeroAddress, VIEWER)).to.be.revertedWith("Alamat tidak valid");
    await expect(registry.setRole(other.address, 0)).to.be.revertedWith("Gunakan revokeRole");
    await expect(registry.setRole(other.address, 5)).to.be.reverted;
    await expect(registry.revokeRole(admin.address)).to.be.revertedWith("Tidak bisa mencabut role sendiri");
    await expect(registry.setRole(admin.address, MANAGER)).to.be.revertedWith("Admin tidak boleh menurunkan diri sendiri");
  });
});
