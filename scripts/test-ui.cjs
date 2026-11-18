// Active testing is isolated to in-process Hardhat and in-memory SQLite.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");
const { pathToFileURL } = require("node:url");
const { randomBytes } = require("node:crypto");
const hre = require("hardhat");
const { chromium } = require("playwright-core");
const Database = require("../backend/node_modules/better-sqlite3");
const { createApp } = require("../backend/server");
const output = path.join(__dirname, "../docker-audit-results/presubmission");
const results = { checks: [], network: "isolated Hardhat 31337", sepoliaWrites: 0, actualMetaMask: "NOT TESTED" };
let db, server, vite, browser;
const pass = (name) => { results.checks.push({ name, status: "PASS" }); console.log("PASS " + name); };
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const { ethers } = hre;
  const accounts = await ethers.getSigners();
  const registry = await ethers.deployContract("AssetRegistry");
  for (const [index, role] of [[1, 1], [2, 2], [3, 3]]) await registry.setRole(accounts[index].address, role);
  for (let i = 0; i < 15; i++) await registry.createAsset("Laptop Audit " + i, "Perangkat IT", "Ruang 301", i === 2 ? "Perlu perbaikan" : "Baik", accounts[1].address);
  const address = await registry.getAddress();
  const deployment = { address, chainId: 31337, codeHash: ethers.keccak256(await ethers.provider.getCode(address)) };
  const { abi } = await hre.artifacts.readArtifact("AssetRegistry");
  const { createServer } = await import(pathToFileURL(require.resolve("../frontend/node_modules/vite/dist/node/index.js")).href);
  // Reserve an ephemeral API port; the frontend proxy preserves browser origin.
  db = new Database(":memory:");
  let frontendOrigin;
  const express = require("../backend/node_modules/express");
  const proxyApp = express();
  server = proxyApp.listen(0, "127.0.0.1");
  await once(server, "listening");
  const apiBase = "http://127.0.0.1:" + server.address().port;
  vite = await createServer({
    root: path.join(__dirname, "../frontend"), configFile: path.join(__dirname, "../frontend/vite.config.js"),
    plugins: [{ name: "test-only-local-deployment", enforce: "pre", load(id) {
      if (id.replaceAll("\\", "/").endsWith("/frontend/src/contract.json")) return JSON.stringify({ ...deployment, abi });
    } }],
    define: { "import.meta.env.VITE_API_URL": JSON.stringify("") },
    server: { host: "127.0.0.1", port: 0, proxy: { "/api": apiBase } },
  });
  await vite.listen();
  frontendOrigin = "http://127.0.0.1:" + vite.httpServer.address().port;
  proxyApp.use(createApp({ db, registry, deployment, jwtSecret: randomBytes(32).toString("hex"), frontendOrigin }));
  const attack = '<img src=x onerror="window.auditXss=1">';
  db.prepare("INSERT INTO users(address,name,email,department) VALUES(?,?,?,?)").run(accounts[1].address, attack, "fixture@example.test", "Audit");
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let active = 0, chain = "0x7a69", rejectNext = false;
  await page.exposeFunction("auditRpc", async ({ method, params = [] }) => {
    if (["eth_requestAccounts", "eth_accounts"].includes(method)) return [accounts[active].address];
    if (method === "eth_chainId") return chain;
    if (method === "personal_sign") {
      if (rejectNext) { rejectNext = false; throw new Error("ACTION_REJECTED: user rejected signature"); }
      return accounts[active].signMessage(ethers.getBytes(params[0]));
    }
    if (method === "wallet_switchEthereumChain") { chain = params[0].chainId; return null; }
    try { return await hre.network.provider.send(method, params); }
    catch (error) { return { auditRpcError: { message: error.message, data: error.data, code: error.code || -32000 } }; }
  });
  await page.addInitScript(() => {
    const listeners = {};
    window.ethereum = {
      request: async (request) => {
        const result = await window.auditRpc(request);
        if (result?.auditRpcError) throw Object.assign(new Error(result.auditRpcError.message), result.auditRpcError);
        return result;
      },
      on: (event, callback) => (listeners[event] ||= []).push(callback),
      removeListener: (event, callback) => { listeners[event] = (listeners[event] || []).filter((cb) => cb !== callback); },
    };
    window.auditEmit = (event, value) => (listeners[event] || []).forEach((cb) => cb(value));
  });
  const button = (name) => page.getByRole("button", { name, exact: true });
  const login = async (index) => {
    active = index;
    await page.evaluate((address) => window.auditEmit("accountsChanged", [address]), accounts[index].address);
    await button("Masuk dengan MetaMask").click();
    await page.locator(".shell").waitFor();
    await page.locator("tbody tr").first().waitFor();
  };
  const fillAsset = async (name) => {
    await page.getByLabel("Nama aset", { exact: true }).fill(name);
    await page.getByLabel("Kategori", { exact: true }).fill("Perangkat IT");
    await page.getByLabel("Lokasi", { exact: true }).fill("Ruang 302");
    await page.getByLabel("Alamat wallet penanggung jawab", { exact: true }).fill(accounts[1].address);
  };
  await page.goto(frontendOrigin);
  await page.screenshot({ path: path.join(output, "ui-login.png"), fullPage: true });
  rejectNext = true;
  await button("Masuk dengan MetaMask").click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.locator(".shell").count(), 0);
  pass("Rejected login signature does not create a session");
  await login(0);
  await page.screenshot({ path: path.join(output, "ui-admin.png"), fullPage: true });
  assert.equal(await page.locator("tbody tr").count(), 12);
  await page.getByLabel("Cari aset di halaman ini").fill("Laptop Audit 2");
  assert.equal(await page.locator("tbody tr").count(), 1);
  await page.getByLabel("Cari aset di halaman ini").fill("");
  await button("Berikutnya").click();
  await page.getByRole("button", { name: "Laptop Audit 14", exact: true }).waitFor();
  assert.equal(await page.locator("tbody tr").count(), 3);
  await button("Sebelumnya").click();
  await page.getByRole("button", { name: "Laptop Audit 0", exact: true }).waitFor();
  await page.getByRole("button", { name: "Detail", exact: true }).first().click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  pass("Bounded asset pages, page-scoped search and accessible detail dialog");
  await button("Tambah aset").click(); await fillAsset("Aset Browser Baru"); await button("Simpan aset").click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal((await registry.getAsset(15)).name, "Aset Browser Baru");
  await page.getByLabel("Ubah AST-0000", { exact: true }).click();
  await page.getByLabel("Nama aset", { exact: true }).fill("Laptop Diubah"); await button("Simpan perubahan").click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal((await registry.getAsset(0)).name, "Laptop Diubah");
  await page.getByLabel("Hapus AST-0000", { exact: true }).click(); await button("Konfirmasi hapus").click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal((await registry.getAsset(0)).active, false);
  pass("Create, update and confirmed soft-delete through UI on isolated Hardhat");
  await button("Profil saya").click();
  await page.getByLabel("Nama lengkap").fill("Admin Audit"); await page.getByLabel("Email", { exact: true }).fill("admin@example.test"); await page.getByLabel("Departemen").fill("Operasional"); await button("Simpan profil").click();
  await page.getByText("Profil disimpan.", { exact: true }).waitFor();
  assert.equal(db.prepare("SELECT name FROM users WHERE address=?").get(accounts[0].address).name, "Admin Audit");
  await button("Data pengguna").click(); await page.getByText(attack, { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.auditXss || 0), 0);
  assert.equal(await page.locator("table img").count(), 0);
  await page.getByLabel(`Ubah profil ${attack}`, { exact: true }).click();
  await page.getByLabel("Nama lengkap").fill("Viewer Audit"); await button("Simpan perubahan profil").click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByLabel("Hapus profil Viewer Audit", { exact: true }).click(); await button("Konfirmasi hapus profil").click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(db.prepare("SELECT count(*) n FROM users WHERE address=?").get(accounts[1].address).n, 0);
  pass("Own profile CRUD, Admin profile update/delete and stored XSS escaping");
  await button("Kelola role").click(); await page.getByLabel("Alamat wallet", { exact: true }).fill(accounts[4].address); await page.getByLabel("Role", { exact: true }).selectOption("1"); await button("Simpan role").click();
  await page.getByText("Role disimpan.", { exact: true }).waitFor();
  assert.equal(await registry.getRole(accounts[4].address), 1n);
  const row = page.getByRole("row").filter({ hasText: accounts[4].address });
  await row.getByRole("button", { name: "Cabut", exact: true }).click(); await button("Konfirmasi cabut role").click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(await registry.getRole(accounts[4].address), 0n);
  pass("Admin role grant/revoke and governance warning");
  for (const [index, expected] of [[1, "Viewer"], [2, "Editor"], [3, "Manager"]]) {
    await login(index);
    assert.equal(await button("Kelola role").count(), 0);
    assert.equal(await button("Tambah aset").count(), index === 1 ? 0 : 1);
    assert.equal(await page.getByLabel("Hapus AST-0001", { exact: true }).count(), index === 3 ? 1 : 0);
    assert.equal(await button("Data pengguna").count(), index === 1 ? 0 : 1);
    assert.ok(await page.locator(".connection").textContent().then((text) => text.includes(expected)));
  }
  pass("Viewer/Editor/Manager controls follow four-role permissions");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  results.mobileCells = await page.locator("tbody tr").first().evaluate((row) => [...row.cells].map((cell) => ({
    width: cell.getBoundingClientRect().width, height: cell.getBoundingClientRect().height,
    text: cell.textContent, fontSize: getComputedStyle(cell).fontSize,
  })));
  await page.screenshot({ path: path.join(output, "ui-mobile.png"), fullPage: true });
  await button("Tambah aset").click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.keyboard.press("Escape");
  pass("390px mobile layout has no document overflow and dialogs close with Escape");
  assert.deepEqual(await page.evaluate(() => [Object.keys(localStorage), Object.keys(sessionStorage)]), [[], []]);
  await registry.revokeRole(accounts[3].address);
  await button("Masuk dengan MetaMask").waitFor({ timeout: 10000 });
  await login(1);
  chain = "0xaa36a7";
  await page.evaluate(() => window.auditEmit("chainChanged", "0xaa36a7"));
  await button("Masuk dengan MetaMask").waitFor();
  await button("Masuk dengan MetaMask").click();
  await page.getByText("Pindah jaringan MetaMask ke chain ID 31337.", { exact: true }).waitFor();
  chain = "0x7a69";
  await login(1);
  await page.evaluate(() => window.auditEmit("disconnect"));
  await button("Masuk dengan MetaMask").waitFor();
  assert.deepEqual(errors, []);
  pass("Revocation, wrong-chain/account/disconnect reset, memory-only JWT and no JS errors");
}
main().catch(async (error) => {
  results.error = error.message; console.error(error.message); process.exitCode = 1;
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) {
    await page.screenshot({ path: path.join(output, "ui-failure.png"), fullPage: true }).catch(() => {});
    console.error(await page.locator(".toast").allTextContents().catch(() => []));
  }
}).finally(async () => {
  if (browser) await browser.close();
  if (vite) await vite.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (db) db.close();
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "ui-results.json"), JSON.stringify(results, null, 2) + "\n");
});
