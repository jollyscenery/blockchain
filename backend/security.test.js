const assert = require("node:assert/strict");
const { before, beforeEach, afterEach, test } = require("node:test");
const { once } = require("node:events");
const Database = require("better-sqlite3");
const { ethers } = require("hardhat");
const { createApp } = require("./server");

const jwtSecret = "security-regression-fixture-secret-only";
const frontendOrigin = "http://localhost:5173";
let wallet, registry, deployment, db, server, base;
before(async () => {
  [wallet] = await ethers.getSigners();
  registry = await ethers.deployContract("AssetRegistry");
  await registry.waitForDeployment();
  deployment = {
    address: await registry.getAddress(), chainId: 31337,
    codeHash: ethers.keccak256(await ethers.provider.getCode(await registry.getAddress())),
  };
});
beforeEach(async () => {
  db = new Database(":memory:");
  server = createApp({ db, registry, deployment, jwtSecret, frontendOrigin }).listen(0, "127.0.0.1");
  await once(server, "listening");
  base = "http://127.0.0.1:" + server.address().port;
});
afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
});
const nonce = (address = wallet.address, headers = {}) => fetch(base + "/api/auth/nonce/" + address, { headers });
async function proof(challenge, address = wallet.address) {
  return { address, nonce: challenge.nonce, signature: await wallet.signMessage(challenge.message) };
}
const login = (body) => fetch(base + "/api/auth/login", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("preserves two pending challenges and consumes each exactly once under concurrent requests", async () => {
  const first = await (await nonce()).json();
  const second = await (await nonce()).json();
  assert.notEqual(first.nonce, second.nonce);
  const signed = await proof(first);
  const attempts = await Promise.all([login(signed), login(signed), login(signed)]);
  assert.deepEqual(attempts.map((response) => response.status).sort(), [200, 401, 401]);
  assert.equal((await login(await proof(second))).status, 200);
});

test("rejects nonce substitution between challenges and wallet addresses", async () => {
  const first = await (await nonce()).json();
  const second = await (await nonce()).json();
  const signed = await proof(first);
  assert.equal((await login({ ...signed, nonce: second.nonce })).status, 401);
  assert.equal((await login({ ...signed, address: ethers.Wallet.createRandom().address })).status, 401);
  assert.equal((await login({ ...signed, nonce: undefined })).status, 401);
  assert.equal((await login(signed)).status, 200);
});

test("limits wallet issuance without invalidating an outstanding proof", async () => {
  const first = await (await nonce()).json();
  for (let i = 0; i < 19; i++) assert.equal((await nonce()).status, 200);
  const limited = await nonce();
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "300");
  assert.equal((await login(await proof(first))).status, 200);
});

test("bounds client issuance and ignores forged forwarded IP headers in direct mode", async () => {
  for (let i = 0; i < 60; i++) {
    const address = "0x" + (10000 + i).toString(16).padStart(40, "0");
    assert.equal((await nonce(address, { "X-Forwarded-For": "198.51.100." + i })).status, 200);
  }
  assert.equal((await nonce(wallet.address, { "X-Forwarded-For": "203.0.113.9" })).status, 429);
  assert.equal(db.prepare("SELECT count(*) AS count FROM login_challenges").get().count, 60);
});

test("limits invalid login attempts per client", async () => {
  for (let i = 0; i < 120; i++) assert.equal((await login({ address: wallet.address })).status, 401);
  assert.equal((await login({ address: wallet.address })).status, 429);
});

test("cleans expired challenges and limits, then permits legitimate login", async () => {
  const expired = await (await nonce()).json();
  db.prepare("UPDATE login_challenges SET expires = ?").run(Date.now() - 1);
  db.prepare("UPDATE auth_limits SET expires = ?").run(Date.now() - 1);
  assert.equal((await login(await proof(expired))).status, 401);
  const fresh = await (await nonce()).json();
  assert.equal((await login(await proof(fresh))).status, 200);
  assert.equal(db.prepare("SELECT count(*) AS count FROM login_challenges").get().count, 0);
  assert.equal(db.prepare("SELECT count(*) AS count FROM auth_limits WHERE expires <= ?").get(Date.now()).count, 0);
});

test("rejects untrusted origins before challenge allocation and exposes safe health information", async () => {
  const denied = await nonce(wallet.address, { Origin: "https://untrusted.example" });
  assert.equal(denied.status, 403);
  assert.equal(db.prepare("SELECT count(*) AS count FROM login_challenges").get().count, 0);
  const health = await fetch(base + "/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("x-powered-by"), null);
  assert.deepEqual(await health.json(), { status: "ok", address: deployment.address, chainId: 31337 });
  const approved = await nonce(wallet.address, { Origin: frontendOrigin });
  assert.equal(approved.headers.get("access-control-allow-origin"), frontendOrigin);
  assert.ok((await approved.json()).message.includes("Aplikasi: " + frontendOrigin));
});

test("bounds outstanding storage without removing existing challenges", async () => {
  const first = await (await nonce()).json();
  const insert = db.prepare("INSERT INTO login_challenges (nonce,address,expires) VALUES (?,?,?)");
  db.transaction(() => {
    for (let i = 0; i < 4999; i++) {
      insert.run(i.toString(16).padStart(32, "0"), wallet.address, Date.now() + 300000);
    }
  })();
  assert.equal((await nonce(ethers.Wallet.createRandom().address)).status, 503);
  assert.equal((await login(await proof(first))).status, 200);
});

test("rejects malformed and oversized JSON without leaking internal errors", async () => {
  for (const [body, status] of [["{broken", 400], [JSON.stringify({ address: wallet.address, padding: "x".repeat(17000) }), 413]]) {
    const response = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    assert.equal(response.status, status);
    const data = await response.json();
    assert.equal(typeof data.error, "string");
    assert.equal(data.stack, undefined);
    assert.equal(JSON.stringify(data).includes("node_modules"), false);
  }
});

test("preserves profiles and legacy nonce rows when initializing the existing database again", async () => {
  db.exec("CREATE TABLE nonces (address TEXT PRIMARY KEY,nonce TEXT,expires INTEGER)");
  db.prepare("INSERT INTO users(address,name,email,department) VALUES (?,?,?,?)")
    .run(wallet.address, "Existing profile", "existing@example.test", "Audit");
  db.prepare("INSERT INTO nonces VALUES (?,?,?)").run(wallet.address, "old-fixture", Date.now() + 300000);
  createApp({ db, registry, deployment, jwtSecret, frontendOrigin });
  assert.equal(db.prepare("SELECT name FROM users WHERE address=?").get(wallet.address).name, "Existing profile");
  assert.equal(db.prepare("SELECT count(*) n FROM nonces").get().n, 1);
  assert.equal((await login(await proof(await (await nonce()).json()))).status, 200);
});

