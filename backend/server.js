require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const { ethers } = require("ethers");
const contractInfo = require("./contract.json"); // dibuat otomatis oleh scripts/deploy.js

const ROLES = ["None", "Viewer", "Editor", "Manager", "Admin"];
const { PORT = 4000, JWT_SECRET, RPC_URL = "http://127.0.0.1:8545", FRONTEND_ORIGIN } = process.env;
if (!JWT_SECRET) throw new Error("JWT_SECRET belum diisi di backend/.env");

const provider = new ethers.JsonRpcProvider(RPC_URL);
const registry = new ethers.Contract(contractInfo.address, contractInfo.abi, provider);

// ---------- Off-chain database (SQLite) ----------
const db = new Database("data.db");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  address TEXT PRIMARY KEY,
  name TEXT, email TEXT, department TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS nonces (address TEXT PRIMARY KEY, nonce TEXT, expires INTEGER);
`);

const app = express();
app.use(cors({ origin: FRONTEND_ORIGIN || true }));
app.use(express.json());

const roleOf = async (addr) => ROLES[Number(await registry.getRole(addr))];
const norm = (a) => ethers.getAddress(a); // checksum + validasi

// ---------- Authentication: login dengan tanda tangan wallet ----------
app.get("/api/auth/nonce/:address", (req, res) => {
  try {
    const address = norm(req.params.address);
    const nonce = crypto.randomBytes(16).toString("hex");
    db.prepare("INSERT OR REPLACE INTO nonces VALUES (?,?,?)").run(address, nonce, Date.now() + 5 * 60 * 1000);
    res.json({ message: `Login ke Asset Logging dApp\nAlamat: ${address}\nNonce: ${nonce}` });
  } catch { res.status(400).json({ error: "Alamat tidak valid" }); }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const address = norm(req.body.address);
    const row = db.prepare("SELECT * FROM nonces WHERE address=?").get(address);
    if (!row || row.expires < Date.now()) return res.status(401).json({ error: "Nonce kedaluwarsa, coba lagi" });
    const message = `Login ke Asset Logging dApp\nAlamat: ${address}\nNonce: ${row.nonce}`;
    if (ethers.verifyMessage(message, req.body.signature) !== address)
      return res.status(401).json({ error: "Tanda tangan tidak cocok" });
    db.prepare("DELETE FROM nonces WHERE address=?").run(address); // nonce sekali pakai

    const role = await roleOf(address); // role dibaca dari blockchain
    if (role === "None") return res.status(403).json({ error: "Wallet ini belum memiliki role. Hubungi Admin." });
    const token = jwt.sign({ address, role }, JWT_SECRET, { expiresIn: "2h" });
    res.json({ token, address, role });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- Authorization middleware ----------
const auth = (...allowed) => async (req, res, next) => {
  try {
    const payload = jwt.verify((req.headers.authorization || "").replace("Bearer ", ""), JWT_SECRET);
    const role = await roleOf(payload.address); // cek ulang role terbaru di chain
    if (role === "None") return res.status(403).json({ error: "Role dicabut" });
    if (allowed.length && !allowed.includes(role)) return res.status(403).json({ error: "Akses ditolak" });
    req.user = { address: payload.address, role };
    next();
  } catch { res.status(401).json({ error: "Belum login" }); }
};

// ---------- Off-chain CRUD: profil user ----------
const fields = (b) => [b.name?.trim() || null, b.email?.trim() || null, b.department?.trim() || null];

// READ profil sendiri
app.get("/api/users/me", auth(), (req, res) => {
  const row = db.prepare("SELECT * FROM users WHERE address=?").get(req.user.address);
  res.json({ ...(row || { address: req.user.address }), role: req.user.role });
});

// CREATE / UPDATE profil sendiri
app.put("/api/users/me", auth(), (req, res) => {
  const [name, email, department] = fields(req.body);
  db.prepare(`INSERT INTO users (address,name,email,department) VALUES (?,?,?,?)
    ON CONFLICT(address) DO UPDATE SET name=?, email=?, department=?, updated_at=CURRENT_TIMESTAMP`)
    .run(req.user.address, name, email, department, name, email, department);
  res.json(db.prepare("SELECT * FROM users WHERE address=?").get(req.user.address));
});

// READ semua user (Admin, Manager & Editor)
app.get("/api/users", auth("Admin", "Manager", "Editor"), (_req, res) => {
  res.json(db.prepare("SELECT * FROM users ORDER BY created_at DESC").all());
});

// CREATE / UPDATE user mana pun (Admin)
app.put("/api/users/:address", auth("Admin"), (req, res) => {
  try {
    const address = norm(req.params.address);
    const [name, email, department] = fields(req.body);
    db.prepare(`INSERT INTO users (address,name,email,department) VALUES (?,?,?,?)
      ON CONFLICT(address) DO UPDATE SET name=?, email=?, department=?, updated_at=CURRENT_TIMESTAMP`)
      .run(address, name, email, department, name, email, department);
    res.json(db.prepare("SELECT * FROM users WHERE address=?").get(address));
  } catch { res.status(400).json({ error: "Alamat tidak valid" }); }
});

// DELETE profil user (Admin)
app.delete("/api/users/:address", auth("Admin"), (req, res) => {
  try {
    const r = db.prepare("DELETE FROM users WHERE address=?").run(norm(req.params.address));
    res.json({ deleted: r.changes });
  } catch { res.status(400).json({ error: "Alamat tidak valid" }); }
});

app.listen(PORT, () => console.log(`Backend jalan di http://localhost:${PORT}`));
