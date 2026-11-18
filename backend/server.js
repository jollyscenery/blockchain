const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");
const Database = require("better-sqlite3");
const { ethers } = require("ethers");
const { getDeploymentRpcUrl, readDeploymentCode } = require("../scripts/deployment-networks");

const ROLES = ["None", "Viewer", "Editor", "Manager", "Admin"];
const NONCE_TTL = 5 * 60 * 1000;
const MAX_AUTH_ROWS = 5000;
const ISSUER = "asset-logging-dapp";
const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

function walletAddress(value) {
  try {
    const address = ethers.getAddress(value);
    if (address !== ethers.ZeroAddress) return address;
  } catch {
    // Invalid wallet input is handled below.
  }
  throw badRequest("Alamat wallet tidak valid.");
}

function profileFields(body) {
  const fields = [["name", "Nama", 120], ["email", "Email", 254], ["department", "Departemen", 120]];
  const values = fields.map(([key, label, max]) => {
    const value = typeof body?.[key] === "string" ? body[key].trim() : "";
    if (!value || value.length > max) {
      throw badRequest(label + " wajib diisi (maksimal " + max + " karakter).");
    }
    return value;
  });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values[1])) throw badRequest("Format email tidak valid.");
  return values;
}

function createApp({ db, registry, deployment, jwtSecret, frontendOrigin, trustProxy = false }) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS users (" +
      "address TEXT PRIMARY KEY, name TEXT, email TEXT, department TEXT, " +
      "created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);" +
    "CREATE TABLE IF NOT EXISTS login_challenges (nonce TEXT PRIMARY KEY, address TEXT NOT NULL, expires INTEGER NOT NULL);" +
    "CREATE INDEX IF NOT EXISTS challenge_expiry ON login_challenges (expires);" +
    "CREATE TABLE IF NOT EXISTS auth_limits (key TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires INTEGER NOT NULL);" +
    "CREATE INDEX IF NOT EXISTS auth_limit_expiry ON auth_limits (expires);"
  );

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", trustProxy);
  app.use((req, res, next) => {
    if (req.get("Origin") && req.get("Origin") !== frontendOrigin) {
      return res.status(403).json({ error: "Origin aplikasi tidak diizinkan." });
    }
    next();
  });
  app.use(cors({ origin: frontendOrigin }));
  app.use(express.json({ limit: "16kb" }));

  const { address: contractAddress, chainId, codeHash } = deployment;
  const audience = [chainId, contractAddress, codeHash].join(":");
  const roleOf = async (address) => {
    const role = ROLES[Number(await registry.getRole(address))];
    if (!role) throw new Error("Role contract tidak dikenali.");
    return role;
  };
  const chainError = (res) => {
    console.error("Gagal membaca role dari AssetRegistry.");
    return res.status(503).json({ error: "Blockchain tidak dapat diakses. Periksa node dan deployment." });
  };
  const loginMessage = (address, nonce) => [
    "Login ke Asset Logging dApp", "Aplikasi: " + frontendOrigin, "Alamat: " + address,
    "Chain ID: " + chainId, "AssetRegistry: " + contractAddress, "Nonce: " + nonce,
  ].join("\n");

  const purgeChallenges = db.prepare("DELETE FROM login_challenges WHERE expires <= ?");
  const purgeLimits = db.prepare("DELETE FROM auth_limits WHERE expires <= ?");
  const incrementLimit = db.prepare(
    "INSERT INTO auth_limits (key, hits, expires) VALUES (?, 1, ?) " +
    "ON CONFLICT(key) DO UPDATE SET hits = hits + 1 WHERE hits < ?"
  );
  const limitCount = db.prepare("SELECT count(*) AS count FROM auth_limits");
  const findLimit = db.prepare("SELECT key FROM auth_limits WHERE key = ?");
  const limited = (res) => res.set("Retry-After", String(NONCE_TTL / 1000))
    .status(429).json({ error: "Terlalu banyak permintaan login. Coba lagi dalam lima menit." });
  function allow(key, maximum) {
    const now = Date.now();
    purgeLimits.run(now);
    purgeChallenges.run(now);
    if (!findLimit.get(key) && limitCount.get().count >= MAX_AUTH_ROWS) return false;
    return incrementLimit.run(key, now + NONCE_TTL, maximum).changes === 1;
  }
  const authLimit = (kind, maximum) => (req, res, next) => {
    if (!allow(kind + ":" + req.ip, maximum)) return limited(res);
    next();
  };

  app.get("/api/health", (_req, res) => {
    db.prepare("SELECT 1").get();
    res.set("Cache-Control", "no-store").json({ status: "ok", address: contractAddress, chainId });
  });

  // ---------- Login dengan tanda tangan wallet ----------
  app.get("/api/auth/nonce/:address", authLimit("challenge", 60), (req, res) => {
    const address = walletAddress(req.params.address);
    if (!allow("wallet:" + address, 20)) return limited(res);
    if (db.prepare("SELECT count(*) AS count FROM login_challenges").get().count >= MAX_AUTH_ROWS) {
      return res.set("Retry-After", "300").status(503).json({ error: "Kapasitas login sementara penuh. Coba lagi." });
    }
    const nonce = crypto.randomBytes(16).toString("hex");
    db.prepare("INSERT INTO login_challenges (nonce, address, expires) VALUES (?, ?, ?)")
      .run(nonce, address, Date.now() + NONCE_TTL);
    res.set("Cache-Control", "no-store").json({ nonce, message: loginMessage(address, nonce), deployment });
  });

  app.post("/api/auth/login", authLimit("login", 120), async (req, res, next) => {
    try {
      const address = walletAddress(req.body?.address);
      if (!/^[a-f0-9]{32}$/.test(req.body?.nonce || "")) {
        return res.status(401).json({ error: "Tantangan login tidak valid. Masuk kembali." });
      }
      const row = db.prepare("SELECT nonce, expires FROM login_challenges WHERE nonce = ? AND address = ?")
        .get(req.body.nonce, address);
      const expired = () => res.status(401).json({ error: "Nonce kedaluwarsa atau sudah dipakai. Masuk kembali." });
      if (!row || row.expires <= Date.now()) return expired();

      let signer;
      try {
        signer = ethers.verifyMessage(loginMessage(address, row.nonce), req.body.signature);
      } catch {
        return res.status(401).json({ error: "Tanda tangan tidak valid." });
      }
      if (signer !== address) return res.status(401).json({ error: "Tanda tangan tidak cocok." });

      // One SQL statement checks expiry and consumes only this exact challenge.
      const consumed = db.prepare("DELETE FROM login_challenges WHERE address = ? AND nonce = ? AND expires > ?")
        .run(address, row.nonce, Date.now());
      if (!consumed.changes) return expired();

      const role = await roleOf(address).catch(() => { chainError(res); });
      if (!role) return;
      if (role === "None") {
        return res.status(403).json({ error: "Wallet ini belum memiliki role. Hubungi Admin." });
      }
      const token = jwt.sign({ address }, jwtSecret, {
        algorithm: "HS256", audience, issuer: ISSUER, expiresIn: "2h",
      });
      res.set("Cache-Control", "no-store").json({ token, address, role });
    } catch (error) {
      next(error);
    }
  });

  // ---------- Role selalu dibaca ulang dari blockchain ----------
  const auth = (...allowed) => async (req, res, next) => {
    let address;
    try {
      const token = /^Bearer (\S+)$/i.exec(req.get("Authorization") || "")?.[1];
      const payload = jwt.verify(token, jwtSecret, { algorithms: ["HS256"], audience, issuer: ISSUER });
      address = walletAddress(payload.address);
    } catch {
      return res.status(401).json({ error: "Sesi tidak valid atau kedaluwarsa. Masuk kembali." });
    }

    const role = await roleOf(address).catch(() => { chainError(res); });
    if (!role) return;
    if (role === "None") return res.status(403).json({ error: "Role dicabut.", code: "ROLE_REVOKED" });
    if (allowed.length && !allowed.includes(role)) return res.status(403).json({ error: "Akses ditolak." });
    req.user = { address, role };
    next();
  };

  // ---------- CRUD profil SQLite ----------
  const userByAddress = db.prepare("SELECT * FROM users WHERE address = ?");
  const saveUser = db.prepare(
    "INSERT INTO users (address, name, email, department) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT(address) DO UPDATE SET name = excluded.name, email = excluded.email, " +
    "department = excluded.department, updated_at = CURRENT_TIMESTAMP"
  );
  const upsert = (address, body, res) => {
    saveUser.run(address, ...profileFields(body));
    res.json(userByAddress.get(address));
  };

  app.get("/api/users/me", auth(), (req, res) => {
    const { address, role } = req.user;
    const row = userByAddress.get(address);
    res.json({ ...(row || { address }), role });
  });

  app.put("/api/users/me", auth(), (req, res) => upsert(req.user.address, req.body, res));

  app.get("/api/users", auth("Editor", "Manager", "Admin"), (_req, res) => {
    res.json(db.prepare("SELECT * FROM users ORDER BY created_at DESC, address").all());
  });

  app.put("/api/users/:address", auth("Admin"), (req, res) => {
    upsert(walletAddress(req.params.address), req.body, res);
  });

  app.delete("/api/users/:address", auth("Admin"), (req, res) => {
    const address = walletAddress(req.params.address);
    if (address === req.user.address) return res.status(403).json({ error: "Admin hanya dapat menghapus profil pengguna lain." });
    const result = db.prepare("DELETE FROM users WHERE address = ?").run(address);
    res.json({ deleted: result.changes });
  });

  app.use((err, _req, res, _next) => {
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "JSON tidak valid." });
    if (err.type === "entity.too.large") return res.status(413).json({ error: "Isi permintaan terlalu besar." });
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error("Kesalahan server:", err.message);
    res.status(500).json({ error: "Terjadi kesalahan pada server." });
  });
  return app;
}

async function start() {
  require("dotenv").config({ path: path.join(__dirname, ".env") });
  const {
    PORT = 4000,
    HOST = "127.0.0.1",
    DB_PATH = path.join(__dirname, "data.db"),
    JWT_SECRET,
    FRONTEND_ORIGIN = "http://localhost:5173",
    TRUST_PROXY_HOPS = "0",
  } = process.env;
  if (!JWT_SECRET || JWT_SECRET.length < 32) throw new Error("Isi JWT_SECRET acak minimal 32 karakter di backend/.env.");
  if (new URL(FRONTEND_ORIGIN).origin !== FRONTEND_ORIGIN) {
    throw new Error("FRONTEND_ORIGIN harus berupa origin lengkap tanpa path atau garis miring penutup.");
  }
  if (!["0", "1"].includes(TRUST_PROXY_HOPS)) throw new Error("TRUST_PROXY_HOPS harus 0 atau 1.");

  const deploymentFile = path.join(__dirname, "contract.json");
  if (!fs.existsSync(deploymentFile)) throw new Error("backend/contract.json belum tersedia. Sinkronkan deployment sesuai README.");
  const { address, abi, chainId, codeHash } = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
  const deployment = { address: walletAddress(address), chainId, codeHash };
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || !ethers.isHexString(codeHash, 32)) {
    throw new Error("Konfigurasi deployment tidak valid. Jalankan ulang sinkronisasi.");
  }

  const rpc = new ethers.FetchRequest(getDeploymentRpcUrl(chainId));
  rpc.timeout = 15000;
  const provider = new ethers.JsonRpcProvider(rpc, undefined, { cacheTimeout: -1 });
  try {
    const code = await readDeploymentCode(provider, deployment.address, chainId);
    if (ethers.keccak256(code) !== codeHash) {
      throw new Error("Bytecode AssetRegistry tidak cocok. Periksa RPC dan sinkronkan deployment.");
    }
    const registry = new ethers.Contract(deployment.address, abi, provider);
    const role = await registry.getRole(ethers.ZeroAddress).catch(() => {
      throw new Error("Gagal membaca role AssetRegistry. Periksa RPC dan ABI deployment.");
    });
    if (role !== 0n) throw new Error("AssetRegistry tidak valid.");

    process.umask(0o077);
    const databasePath = path.resolve(__dirname, DB_PATH);
    fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
    const db = new Database(databasePath);
    const app = createApp({
      db, registry, deployment, jwtSecret: JWT_SECRET, frontendOrigin: FRONTEND_ORIGIN,
      trustProxy: TRUST_PROXY_HOPS === "1" ? 1 : false,
    });
    const server = app.listen(Number(PORT), HOST, () => {
      console.log("Backend jalan di http://" + HOST + ":" + PORT + " | AssetRegistry " + deployment.address + " | Chain " + chainId);
    }).on("error", (error) => {
      provider.destroy();
      db.close();
      console.error("Backend gagal berjalan:", error.message);
      process.exitCode = 1;
    });
    let closing = false;
    const shutdown = () => {
      if (closing) return;
      closing = true;
      server.close(() => {
        provider.destroy();
        db.close();
      });
      setTimeout(() => server.closeAllConnections(), 8000).unref();
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  } catch (error) {
    provider.destroy();
    throw error;
  }
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Backend gagal berjalan:", error.message);
    process.exitCode = 1;
  });
}
module.exports = { createApp };
