# Asset Logging dApp (Buku Aset)

dApp pencatatan aset dengan blockchain sebagai database utama.

| Persyaratan | Implementasi |
|---|---|
| Data on-chain | `contracts/AssetRegistry.sol` menyimpan aset dan role |
| Otorisasi 4 role | Admin, Manager, Editor, Viewer (dicek di smart contract, backend, dan UI) |
| Autentikasi wallet | MetaMask + tanda tangan pesan (nonce sekali pakai) lalu JWT |
| CRUD on-chain | Aset: create/update (Editor+), read (Viewer+), delete soft-delete (Manager+) |
| CRUD off-chain | Profil pengguna di SQLite lewat REST API Express |

## Hak akses
Urutan level: **Viewer < Editor < Manager < Admin**.

| Aksi | Viewer | Editor | Manager | Admin |
|---|---|---|---|---|
| Lihat aset | ya | ya | ya | ya |
| Tambah / ubah aset | - | ya | ya | ya |
| Hapus aset | - | - | ya | ya |
| Kelola role | - | - | - | ya |
| Profil sendiri | ya | ya | ya | ya |
| Lihat daftar pengguna | - | ya | ya | ya |
| Ubah / hapus profil pengguna lain | - | - | - | ya |

Wallet yang men-deploy contract otomatis menjadi **Admin pertama**. Wallet tanpa role tidak bisa login.

## Struktur
```
contracts/  scripts/  test/  hardhat.config.js   -> smart contract (Hardhat)
backend/                                          -> Express + SQLite (off-chain)
frontend/                                         -> React + Vite + ethers v6
```

## Menjalankan secara lokal
Prasyarat: Node.js 18+ dan MetaMask.

```bash
# 1. Install dan jalankan blockchain lokal (terminal 1)
npm install
npx hardhat node

# 2. Deploy contract (terminal 2) - otomatis membuat contract.json untuk backend & frontend
npx hardhat test
npm run deploy:local

# 3. Backend (terminal 3)
cd backend && npm install
cp .env.example .env      # isi JWT_SECRET
npm start

# 4. Frontend (terminal 4)
cd frontend && npm install
cp .env.example .env
npm run dev               # buka http://localhost:5173
```

### Setup MetaMask (lokal)
1. Tambah jaringan: RPC `http://127.0.0.1:8545`, Chain ID `31337`.
2. Import akun #0 dari output `npx hardhat node` (akun ini = Admin pertama).
3. Login, buka **Kelola role**, lalu beri role Manager/Editor/Viewer ke akun lain (import akun #1, #2, #3 untuk uji).

## Deploy ke Sepolia (opsional)
1. Salin `.env.example` ke `.env`, isi `SEPOLIA_RPC_URL` dan `DEPLOYER_PRIVATE_KEY` (akun testnet, jangan akun utama).
2. `npm run deploy:sepolia`
3. Isi `RPC_URL` di `backend/.env` dengan RPC Sepolia, lalu jalankan backend dan frontend seperti di atas.

## Catatan desain
- Delete on-chain berupa **soft delete** (`active=false`) karena data blockchain tidak bisa dihapus; riwayatnya tetap ada di event log.
- Nilai enum role: None=0, Viewer=1, Editor=2, Manager=3, Admin=4. Mengubah enum berarti contract harus di-deploy ulang.
- Role selalu dibaca ulang dari blockchain di setiap request backend, jadi pencabutan role langsung berlaku.
- `contract.json` (alamat + ABI) dibuat oleh script deploy; sertakan di pengumpulan agar deployment bisa direproduksi.
