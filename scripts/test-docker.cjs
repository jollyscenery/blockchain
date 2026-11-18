const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Wallet } = require("../backend/node_modules/ethers");
const run = promisify(execFile);
const executable = process.platform === "win32" ? "docker.exe" : "docker";
// This dedicated Compose project uses disposable audit data.
const project = "buku-aset-audit-check";
const port = Number(process.env.DOCKER_TEST_PORT || 5176);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid DOCKER_TEST_PORT");
const base = "http://localhost:" + port;
const root = path.resolve(__dirname, "..");
const override = path.join(root, "docker-audit-results/docker-smoke.override.yml");
fs.mkdirSync(path.dirname(override), { recursive: true });
fs.writeFileSync(override, `services:\n  frontend:\n    ports: !override\n      - "127.0.0.1:${port}:8080"\n  backend:\n    environment:\n      FRONTEND_ORIGIN: ${base}\n`);
const info = require("../backend/contract.json");
const results = { project, checks: [], authorizedMetaMaskLogin: "NOT TESTED", sepoliaTransactions: 0 };
const compose = (...args) => run(executable, ["compose", "--project-directory", root, "-f", path.join(root, "docker-compose.yml"), "-f", override, "-p", project, ...args], { maxBuffer: 8 * 1024 * 1024 });
async function backend(code) {
  return (await compose("exec", "-T", "backend", "node", "-e", code)).stdout.trim();
}
async function ready() {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(base + "/api/health", { signal: AbortSignal.timeout(5000) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Docker API readiness timed out.");
}
const passed = (test, details) => { results.checks.push({ test, status: "PASS", details }); console.log("PASS " + test); };

async function main() {
  await compose("config", "--quiet");
  await compose("up", "-d", "--no-build", "--wait", "--wait-timeout", "180");
  await ready();
  const health = await (await fetch(base + "/api/health")).json();
  assert.equal(health.chainId, 11155111);
  assert.equal(health.address, info.address);
  passed("Sepolia startup and same-origin API proxy", health);

  const page = await fetch(base);
  const html = await page.text();
  assert.equal(page.status, 200);
  for (const header of ["content-security-policy", "x-content-type-options", "x-frame-options", "referrer-policy", "permissions-policy"]) {
    assert.ok(page.headers.get(header));
  }
  assert.equal(page.headers.get("server"), "nginx");
  assert.equal(page.headers.get("x-powered-by"), null);
  assert.ok(html.includes("Buku Aset"));
  assert.equal((await fetch(base + "/audit/spa/path")).status, 200);
  const script = /src="([^"]+\.js)"/.exec(html)?.[1];
  assert.ok(script);
  const compiled = await (await fetch(base + script)).text();
  assert.ok(!compiled.includes("http://127.0.0.1:4000"));
  passed("Static frontend, SPA fallback, security headers and relative API build");

  await compose("exec", "-T", "frontend", "nginx", "-t");
  const backendId = (await compose("ps", "-q", "backend")).stdout.trim();
  const frontendId = (await compose("ps", "-q", "frontend")).stdout.trim();
  for (const id of [backendId, frontendId]) {
    const data = JSON.parse((await run(executable, ["inspect", id])).stdout)[0];
    assert.ok(data.Config.User && !["root", "0"].includes(data.Config.User));
    assert.equal(data.HostConfig.ReadonlyRootfs, true);
    assert.ok(data.HostConfig.CapDrop.includes("ALL"));
    assert.ok(data.HostConfig.SecurityOpt.some((value) => value.startsWith("no-new-privileges")));
    if (id === backendId) assert.equal(Object.keys(data.HostConfig.PortBindings || {}).length, 0);
    else assert.equal(data.HostConfig.PortBindings["8080/tcp"][0].HostIp, "127.0.0.1");
  }
  for (const image of ["buku-aset-audit-backend:local", "buku-aset-audit-frontend:local"]) {
    const data = JSON.parse((await run(executable, ["image", "inspect", image])).stdout)[0];
    assert.ok(!data.Config.Env.some((value) => /^(JWT_SECRET|SEPOLIA_RPC_URL|DEPLOYER_PRIVATE_KEY)=/.test(value)));
  }
  const inventory = JSON.parse(await backend(
    "const fs=require('fs'); const p=require('./package.json'); console.log(JSON.stringify({" +
    "dependencies:Object.keys(p.dependencies),hardhat:fs.existsSync('./node_modules/hardhat')," +
    "vite:fs.existsSync('./node_modules/vite'),compiler:fs.existsSync('/usr/bin/g++')," +
    "envFile:fs.existsSync('./.env'),db:process.env.DB_PATH,uid:process.getuid()}))"
  ));
  assert.equal(inventory.hardhat, false);
  assert.equal(inventory.vite, false);
  assert.equal(inventory.compiler, false);
  assert.equal(inventory.envFile, false);
  assert.equal(inventory.db, "/data/data.db");
  assert.ok(inventory.uid > 0);
  await compose("exec", "-T", "frontend", "sh", "-c", "! command -v node && test ! -d /app/node_modules");
  passed("Container users, capabilities, mounts, ports, image environment and runtime inventory", inventory);

  const originDenied = await fetch(base + "/api/auth/nonce/" + Wallet.createRandom().address, {
    headers: { Origin: "https://untrusted.example" },
  });
  assert.equal(originDenied.status, 403);
  const unauthorized = await fetch(base + "/api/users/me", { headers: { Authorization: "Bearer tampered.jwt.value" } });
  assert.equal(unauthorized.status, 401);
  const wallet = Wallet.createRandom();
  const challengeUrl = base + "/api/auth/nonce/" + wallet.address;
  const first = await (await fetch(challengeUrl)).json();
  const second = await (await fetch(challengeUrl)).json();
  assert.notEqual(first.nonce, second.nonce);
  assert.ok(first.message.includes("Aplikasi: " + base));
  const proof = { address: wallet.address, nonce: first.nonce, signature: await wallet.signMessage(first.message) };
  const login = () => fetch(base + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify(proof),
  });
  assert.equal((await login()).status, 403); // Signature accepted, wallet has no Sepolia role.
  assert.equal((await login()).status, 401); // Challenge was consumed.
  passed("Proxied signature verification, nonce isolation/replay, CORS and unassigned-wallet rejection");

  let limited = false;
  for (let i = 0; i < 61; i++) {
    const address = "0x" + (90000 + i).toString(16).padStart(40, "0");
    const response = await fetch(base + "/api/auth/nonce/" + address, {
      headers: { "X-Forwarded-For": "198.51.100." + i, "X-Real-IP": "203.0.113." + i },
    });
    if (response.status === 429) { limited = true; break; }
    assert.equal(response.status, 200);
  }
  assert.ok(limited);
  passed("Nginx overwrites spoofed forwarded IPs and client rate limit remains effective");

  const probeAddress = "0x" + randomBytes(20).toString("hex");
  const probeName = "Docker persistence fixture";
  const seed = "const Database=require('better-sqlite3'); const db=new Database(process.env.DB_PATH);" +
    "db.prepare('INSERT INTO users (address,name,email,department) VALUES (?,?,?,?)').run(" +
    JSON.stringify(probeAddress) + "," + JSON.stringify(probeName) + ",'probe@example.test','Audit'); db.close();";
  await backend(seed);
  const read = "const Database=require('better-sqlite3'); const db=new Database(process.env.DB_PATH);" +
    "console.log(db.prepare('SELECT name FROM users WHERE address=?').get(" + JSON.stringify(probeAddress) + ")?.name); db.close();";
  await compose("restart", "backend", "frontend");
  await ready();
  assert.equal(await backend(read), probeName);
  passed("SQLite survives container restart using synthetic fixture");

  await compose("down");
  await compose("up", "-d", "--no-build", "--wait", "--wait-timeout", "180");
  await ready();
  assert.equal(await backend(read), probeName);
  passed("SQLite survives compose down/up");

  const backupPath = "/data/audit-backup-" + Date.now() + ".db";
  await backend("const Database=require('better-sqlite3'); const db=new Database(process.env.DB_PATH);" +
    "db.backup(" + JSON.stringify(backupPath) + ").then(()=>{db.close();" +
    "const copy=new Database(" + JSON.stringify(backupPath) + ",{readonly:true});" +
    "if(copy.prepare('SELECT name FROM users WHERE address=?').get(" + JSON.stringify(probeAddress) +
    ")?.name!==" + JSON.stringify(probeName) + ")process.exitCode=1;copy.close()}).catch(()=>{db.close();process.exitCode=1})");
  passed("Consistent SQLite backup contains fixture");

  await backend("const Database=require('better-sqlite3');const db=new Database(process.env.DB_PATH);" +
    "db.prepare('DELETE FROM users WHERE address=? AND name=?').run(" + JSON.stringify(probeAddress) + "," + JSON.stringify(probeName) + ");db.close()");
}
main().catch((error) => {
  results.error = error.message;
  process.exitCode = 1;
  console.error(error.message);
}).finally(async () => {
  await compose("down").catch(() => {});
  fs.mkdirSync("docker-audit-results", { recursive: true });
  fs.writeFileSync("docker-audit-results/docker-smoke.json", JSON.stringify(results, null, 2) + "\n");
});

