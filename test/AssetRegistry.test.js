const { expect } = require("chai");
const { ethers } = require("hardhat");

// Role: 1=Viewer, 2=Editor, 3=Manager, 4=Admin
describe("AssetRegistry", () => {
  let c, admin, manager, editor, viewer, other;
  beforeEach(async () => {
    [admin, manager, editor, viewer, other] = await ethers.getSigners();
    c = await (await ethers.getContractFactory("AssetRegistry")).deploy();
    await c.setRole(manager.address, 3);
    await c.setRole(editor.address, 2);
    await c.setRole(viewer.address, 1);
  });

  it("deployer menjadi Admin", async () => { expect(await c.getRole(admin.address)).to.equal(4); });

  it("Editor bisa create & update, Viewer tidak bisa", async () => {
    await c.connect(editor).createAsset("Laptop", "IT", "Lt 2", "Baik", editor.address);
    await c.connect(editor).updateAsset(0, "Laptop X", "IT", "Lt 3", "Baik", editor.address);
    expect((await c.connect(viewer).getAsset(0)).name).to.equal("Laptop X");
    await expect(c.connect(viewer).createAsset("x", "", "", "", viewer.address)).to.be.reverted;
  });

  it("Editor tidak bisa delete, Manager bisa (soft delete)", async () => {
    await c.connect(editor).createAsset("Meja", "Furniture", "Lt 1", "Baik", editor.address);
    await expect(c.connect(editor).deleteAsset(0)).to.be.reverted;
    await c.connect(manager).deleteAsset(0);
    expect((await c.connect(viewer).getAllAssets()).length).to.equal(0);
  });

  it("hanya Admin yang bisa kelola role", async () => {
    await expect(c.connect(manager).setRole(other.address, 1)).to.be.reverted;
    await expect(c.connect(manager).revokeRole(viewer.address)).to.be.reverted;
    await c.setRole(other.address, 1);
    expect(await c.getRole(other.address)).to.equal(1);
    await c.revokeRole(other.address);
    expect(await c.getRole(other.address)).to.equal(0);
  });

  it("tanpa role tidak bisa membaca", async () => {
    await expect(c.connect(other).getAllAssets()).to.be.reverted;
  });
});
