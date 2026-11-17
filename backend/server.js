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

function createApp({ db, registry, deployment, jwtSecret, frontendOrigin }) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS users (" +
      "address TEXT PRIMARY KEY, name TEXT, email TEXT, department TEXT, " +
      "created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);" +
    "CREATE TABLE IF NOT EXISTS nonces (address TEXT PRIMARY KEY, nonce TEXT, expires INTEGER);"
  );

  const app = express();
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

  // ---------- Login dengan tanda tangan wallet ----------
  app.get("/api/auth/nonce/:address", (req, res) => {
    const address = walletAddress(req.params.address);
    const nonce = crypto.randomBytes(16).toString("hex");
    db.prepare("INSERT OR REPLACE INTO nonces (address, nonce, expires) VALUES (?, ?, ?)")
      .run(address, nonce, Date.now() + NONCE_TTL);
    res.set("Cache-Control", "no-store").json({ message: loginMessage(address, nonce), deployment });
  });

  app.post("/api/auth/login", async (req, res, next) => {
    try {
      const address = walletAddress(req.body?.address);
      const row = db.prepare("SELECT nonce, expires FROM nonces WHERE address = ?").get(address);
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
      const consumed = db.prepare("DELETE FROM nonces WHERE address = ? AND nonce = ? AND expires > ?")
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
    JWT_SECRET,
    FRONTEND_ORIGIN = "http://localhost:5173",
  } = process.env;
  if (!JWT_SECRET || JWT_SECRET.length < 32) throw new Error("Isi JWT_SECRET acak minimal 32 karakter di backend/.env.");

  const deploymentFile = path.join(__dirname, "contract.json");
  if (!fs.existsSync(deploymentFile)) throw new Error("backend/contract.json belum tersedia. Sinkronkan deployment sesuai README.");
  const { address, abi, chainId, codeHash } = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
  const deployment = { address: walletAddress(address), chainId, codeHash };
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || !ethers.isHexString(codeHash, 32)) {
    throw new Error("Konfigurasi deployment tidak valid. Jalankan ulang sinkronisasi.");
  }

  const provider = new ethers.JsonRpcProvider(getDeploymentRpcUrl(chainId), undefined, { cacheTimeout: -1 });
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

    const db = new Database(path.join(__dirname, "data.db"));
    const app = createApp({ db, registry, deployment, jwtSecret: JWT_SECRET, frontendOrigin: FRONTEND_ORIGIN });
    app.listen(Number(PORT), "127.0.0.1", () => {
      console.log("Backend jalan di http://127.0.0.1:" + PORT + " | AssetRegistry " + deployment.address + " | Chain " + chainId);
    }).on("error", (error) => {
      provider.destroy();
      db.close();
      console.error("Backend gagal berjalan:", error.message);
      process.exitCode = 1;
    });
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
