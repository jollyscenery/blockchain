const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { mkdtempSync, rmSync } = require("node:fs");
const { once } = require("node:events");
const { tmpdir } = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const jwt = require("jsonwebtoken");
const { ethers } = require("hardhat");
const { createApp } = require("./server");

const jwtSecret = "fixture-only-asset-registry-test-secret";
const frontendOrigin = "http://localhost:5173";
const profile = { name: "Siti", email: "siti@example.test", department: "IT" };
let registry, deployment, admin, manager, editor, viewer, outsider, folder, db, server, base;

async function startApi() {
  db = new Database(path.join(folder, "test.db"));
  server = createApp({ db, registry, deployment, jwtSecret, frontendOrigin }).listen(0, "127.0.0.1");
  await once(server, "listening");
  base = "http://127.0.0.1:" + server.address().port;
}

async function stopApi() {
  await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  db.close();
  server = null;
}

before(async () => {
  [admin, manager, editor, viewer, outsider] = await ethers.getSigners();
  registry = await ethers.deployContract("AssetRegistry");
  await registry.waitForDeployment();
  await registry.setRole(manager.address, 3);
  await registry.setRole(editor.address, 2);
  await registry.setRole(viewer.address, 1);
  const address = await registry.getAddress();
  deployment = { address, chainId: 31337, codeHash: ethers.keccak256(await ethers.provider.getCode(address)) };
  folder = mkdtempSync(path.join(tmpdir(), "buku-aset-tests-"));
  await startApi();
});

after(async () => {
  if (server) await stopApi();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

async function api(route, { method = "GET", body, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(base + route, { method, headers, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json(), headers: response.headers };
}

async function challenge(wallet, signer = wallet) {
  const address = wallet.address.toLowerCase();
  const response = await api("/api/auth/nonce/" + address);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(response.data.deployment, deployment);
  assert.ok(response.data.message.includes(wallet.address));
  assert.ok(response.data.message.includes(deployment.address));
  return { address, signature: await signer.signMessage(response.data.message), nonce: response.data.nonce };
}

const submit = (body) => api("/api/auth/login", { method: "POST", body });
const login = async (wallet) => submit(await challenge(wallet));

async function tokenFor(wallet, expectedRole) {
  const response = await login(wallet);
  assert.equal(response.status, 200);
  assert.equal(response.data.address, wallet.address);
  assert.equal(response.data.role, expectedRole);
  assert.equal(jwt.decode(response.data.token).exp - jwt.decode(response.data.token).iat, 7200);
  return response.data.token;
}

test("accepts wallet signatures, normalizes addresses and issues role-based sessions", async () => {
  await tokenFor(admin, "Admin");
  await tokenFor(manager, "Manager");
  await tokenFor(editor, "Editor");
  const token = await tokenFor(viewer, "Viewer");
  assert.deepEqual((await api("/api/users/me", { token })).data, { address: viewer.address, role: "Viewer" });
  assert.equal((await login(outsider)).status, 403);
  assert.equal((await api("/api/auth/nonce/not-an-address")).status, 400);
  assert.equal((await submit({ address: ethers.ZeroAddress })).status, 400);
});

test("rejects malformed, mismatched and expired signatures while preserving outstanding challenges", async () => {
  const mismatched = await challenge(viewer, editor);
  assert.equal((await submit(mismatched)).status, 401);
  assert.equal((await submit({ ...mismatched, signature: "invalid" })).status, 401);
  const replaced = await challenge(viewer);
  const current = await challenge(viewer);
  assert.equal((await submit(replaced)).status, 200);
  assert.equal((await submit(current)).status, 200);
  const expired = await challenge(viewer);
  db.prepare("UPDATE login_challenges SET expires = ? WHERE address = ?").run(Date.now() - 1, viewer.address);
  assert.equal((await submit(expired)).status, 401);
});

test("accepts only one submission during concurrent login and rejects later replay", async () => {
  const proof = await challenge(editor);
  const results = await Promise.all([submit(proof), submit(proof), submit(proof)]);
  assert.deepEqual(results.map((response) => response.status).sort(), [200, 401, 401]);
  assert.equal((await submit(proof)).status, 401);
});

test("rejects missing, forged, expired and incorrectly scoped JWTs", async () => {
  const claims = { address: admin.address };
  const { address, chainId, codeHash } = deployment;
  const options = { algorithm: "HS256", issuer: "asset-logging-dapp", audience: [chainId, address, codeHash].join(":") };
  const forged = jwt.sign(claims, "different-signing-key", options);
  const expired = jwt.sign(claims, jwtSecret, { ...options, expiresIn: -1 });
  const wrongAudience = jwt.sign(claims, jwtSecret, { ...options, audience: "another-deployment" });
  const wrongAlgorithm = jwt.sign(claims, jwtSecret, { ...options, algorithm: "HS384" });
  const wrongIssuer = jwt.sign(claims, jwtSecret, { ...options, issuer: "another-application" });
  const valid = jwt.sign(claims, jwtSecret, options).split(".");
  const tampered = [valid[0], Buffer.from(JSON.stringify({ address: viewer.address })).toString("base64url"), valid[2]].join(".");
  const unsigned = jwt.sign(claims, null, { ...options, algorithm: "none" });
  for (const token of [undefined, forged, expired, wrongAudience, wrongAlgorithm, wrongIssuer, tampered, unsigned]) {
    assert.equal((await api("/api/users/me", { token })).status, 401);
  }
});

test("checks the current on-chain role after downgrade and revocation", async () => {
  const token = await tokenFor(editor, "Editor");
  assert.equal((await api("/api/users", { token })).status, 200);
  await registry.setRole(editor.address, 1);
  assert.equal((await api("/api/users", { token })).status, 403);
  assert.equal((await api("/api/users/me", { token })).data.role, "Viewer");
  await registry.revokeRole(editor.address);
  assert.equal((await api("/api/users/me", { token })).data.code, "ROLE_REVOKED");
  assert.equal((await login(editor)).status, 403);
  await registry.setRole(editor.address, 2);
});

test("validates profile input and permissions, persists SQLite CRUD and preserves roles", async () => {
  const viewerToken = await tokenFor(viewer, "Viewer");
  const editorToken = await tokenFor(editor, "Editor");
  const managerToken = await tokenFor(manager, "Manager");
  const adminToken = await tokenFor(admin, "Admin");
  const save = (route, token, body) => api(route, { method: "PUT", body, token });
  const remove = (address, token) => api("/api/users/" + address, { method: "DELETE", token });
  const viewerRoute = "/api/users/" + viewer.address;

  for (const invalid of [{ ...profile, name: 1 }, { ...profile, email: "invalid" }, { ...profile, department: " " }]) {
    assert.equal((await save("/api/users/me", viewerToken, invalid)).status, 400);
  }
  const name = "Siti'); DROP TABLE users; --";
  const created = await save("/api/users/me", viewerToken, { ...profile, name, address: admin.address, role: "Admin" });
  assert.equal(created.status, 200);
  assert.equal(created.data.address, viewer.address);
  assert.equal(created.data.name, name);
  assert.ok(created.data.created_at && created.data.updated_at);
  assert.equal((await api("/api/users/me", { token: viewerToken })).data.name, name);
  assert.equal((await api("/api/users/me", { token: adminToken })).data.name, undefined);
  const updated = await save("/api/users/me", viewerToken, { ...profile, department: "Operasi" });
  assert.equal(updated.data.department, "Operasi");
  assert.equal(updated.data.created_at, created.data.created_at);

  assert.equal((await api("/api/users", { token: viewerToken })).status, 403);
  for (const token of [editorToken, managerToken, adminToken]) {
    assert.equal((await api("/api/users", { token })).data[0].address, viewer.address);
  }
  assert.equal((await save(viewerRoute, editorToken, profile)).status, 403);
  assert.equal((await remove(viewer.address, managerToken)).status, 403);
  assert.equal((await remove(admin.address, adminToken)).status, 403);
  assert.equal((await save("/api/users/invalid", adminToken, profile)).status, 400);
  assert.equal((await save(viewerRoute, adminToken, { ...profile, email: "edited@example.test" })).status, 200);

  await stopApi();
  await startApi();
  assert.equal((await api("/api/users/me", { token: viewerToken })).data.email, "edited@example.test");
  assert.deepEqual((await remove(viewer.address, adminToken)).data, { deleted: 1 });
  assert.deepEqual((await api("/api/users/me", { token: viewerToken })).data, { address: viewer.address, role: "Viewer" });
  assert.equal(await registry.getRole(viewer.address), 1n);
});
