# Buku Aset — Docker dan Audit Phase 1

## 1. Gambaran proyek

Buku Aset adalah proyek COMP6873001 Blockchain Fundamental, BINUS University. Aset dan role disimpan pada Ethereum. Profil pengguna disimpan dalam SQLite.

Mode utama memakai **Ethereum Sepolia**, chain ID **11155111**, contract **0xda0349D26Fb38dfC3Cf416feB0a9670C5cb6ad1C**. Alamat dan ABI publik sudah disertakan untuk menjalankan deployment yang tersedia.

## 2. Arsitektur sistem

Browser menjalankan React dan MetaMask. Nginx melayani hasil build React di `http://localhost:5173` dan meneruskan `/api/` ke `backend:4000` pada jaringan Compose. Express membaca role dari Sepolia dan menyimpan profil pada volume SQLite. MetaMask menandatangani pesan login serta transaksi aset dan role.

Backend memvalidasi chain ID dan hash bytecode sebelum membuka layanan. Frontend memakai deployment yang sama.

## 3. Teknologi

| Bagian | Teknologi |
|---|---|
| Contract dan wallet | Solidity 0.8.24, Remix IDE, Sepolia, MetaMask, ethers.js v6 |
| Frontend | React 18, Vite 6.4.6 saat build, Nginx saat runtime |
| Backend | Node.js 24, Express 4, better-sqlite3 |
| Autentikasi | Challenge acak sekali pakai, tanda tangan wallet, JWT dua jam |
| Pengembangan | Hardhat 2, ethers/chai plugins, Chai/Mocha |
| Distribusi | Docker Compose, dua service |

## 4. Prasyarat perangkat lunak

Mode Sepolia memerlukan Docker Desktop dengan Linux containers, browser dan MetaMask, koneksi internet, serta wallet uji yang telah diberi role oleh Admin. Docker memasang dependensi dan membangun aplikasi.

Node.js, npm, Hardhat, dan Remix di host digunakan untuk alur pengembangan alternatif pada bagian 20. Siapkan folder pribadi yang dapat ditulis dan port lokal 5173.

## 5. Instalasi Docker pada Windows

1. Instal Docker Desktop melalui [panduan resmi Windows](https://docs.docker.com/desktop/setup/install/windows-install/).
2. Ikuti petunjuk WSL 2 dan virtualisasi dari installer. Restart Windows jika diminta.
3. Jalankan Docker Desktop dan pilih Linux containers.
4. Periksa dari PowerShell.

```powershell
docker version
docker compose version
```

Bagian Server pada `docker version` harus menampilkan Docker Engine.

## 6. Mengekstrak ZIP

Contoh ini memakai ZIP dari folder Downloads.

```powershell
Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\Asset-Logging-dApp-Submission-Final.zip" -DestinationPath "$env:USERPROFILE\Documents\Buku-Aset-Docker"
Set-Location "$env:USERPROFILE\Documents\Buku-Aset-Docker\blockchain"
```

Folder aktif harus memuat `docker-compose.yml`, `backend`, `frontend`, dan `scripts`.

## 7. Menyiapkan variabel lingkungan

Jalankan helper proyek untuk membuat `.env.docker` dengan secret acak.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-docker.ps1
```

Helper mempertahankan konfigurasi yang sudah ada. Jika diperlukan, sunting file lokal tersebut.

| Variabel | Nilai |
|---|---|
| JWT_SECRET | Dibuat helper, minimal 32 karakter |
| FRONTEND_ORIGIN | `http://localhost:5173` |
| SEPOLIA_RPC_URL | Kosong untuk HTTPS RPC publik, atau endpoint Sepolia khusus |

`FRONTEND_ORIGIN` harus persis sama dengan origin browser. Simpan kredensial RPC pada file lokal tersebut. Compose mengatur `HOST=0.0.0.0`, `DB_PATH=/data/data.db`, `NODE_ENV=production`, dan `TRUST_PROXY_HOPS=1` pada backend.

## 8. Menghasilkan JWT_SECRET dengan aman

Helper memakai `RandomNumberGenerator` Windows untuk membuat 32 byte acak menjadi 64 karakter heksadesimal. Secret disimpan tanpa dicetak.

Untuk membuat konfigurasi secara manual pada folder baru, gunakan perintah berikut.

```powershell
if (Test-Path -LiteralPath .env.docker) { throw 'Konfigurasi sudah ada.' }
$secretBytes = New-Object byte[] 32
$generator = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $generator.GetBytes($secretBytes) } finally { $generator.Dispose() }
$secret = [BitConverter]::ToString($secretBytes).Replace('-', '').ToLowerInvariant()
(Get-Content -LiteralPath .env.docker.example) -replace '^JWT_SECRET=.*$', ('JWT_SECRET=' + $secret) |
    Set-Content -LiteralPath .env.docker -Encoding ascii
```

Simpan file konfigurasi secara pribadi. Administrator Docker dapat memeriksa lingkungan container.

## 9. Menjalankan Docker Compose

Dari folder `blockchain`, jalankan perintah utama berikut.

```powershell
docker compose up --build -d
docker compose ps
docker compose config --quiet
```

Build pertama mengunduh image dan dependensi. Backend harus sehat sebelum frontend dimulai. Health memeriksa proses dan SQLite. Sepolia divalidasi saat startup, dan setiap API berizin membaca role terbaru.

## 10. Membuka Buku Aset

Buka [Buku Aset](http://localhost:5173). Periksa API melalui Nginx.

```powershell
Invoke-RestMethod -Uri http://localhost:5173/api/health
```

Hasil menampilkan status `ok`, chain ID `11155111`, dan alamat AssetRegistry proyek.

## 11. Mengatur MetaMask Sepolia

Aktifkan **Show test networks**, pilih **Sepolia** untuk situs Buku Aset, dan cocokkan chain ID `11155111`. Pilih wallet uji yang memiliki role. Transaksi memerlukan ETH uji Sepolia. Setelah berganti akun atau jaringan, login kembali. [Panduan MetaMask](https://support.metamask.io/configure/networks/how-to-view-testnets-in-metamask/)

Auditor Mode A tidak perlu men-deploy ulang contract Sepolia. Deployment yang tersedia dapat dipakai langsung. Untuk mereproduksi deployment melalui Remix pada lingkungan yang Anda kelola, ikuti langkah ini.

1. Unggah `contracts/AssetRegistry.sol` ke [Remix IDE](https://remix.ethereum.org/).
2. Pilih compiler `0.8.24+commit.e11b9ed9`, EVM **Paris** atau **Shanghai**, dan optimizer nonaktif.
3. Compile dan pilih contract **AssetRegistry**.
4. Buka **Deploy & Run → Browser Extension → MetaMask**. Periksa jaringan, akun deployer, dan Value `0`.
5. Untuk deployment baru yang disengaja, klik Deploy dan konfirmasi wallet. Constructor tanpa parameter.
6. Panggil `getRole(alamatDeployer)` dan harapkan `4`.
7. Salin ABI dari **Solidity Compiler → ABI** menjadi `remix-abi.json` dan catat alamat deployment.
8. Pada alur pengembangan yang memakai Node.js, jalankan `npm.cmd run compile` lalu `npm.cmd run sync:remix -- ALAMAT 11155111 remix-abi.json`.
9. Rebuild frontend dan restart backend agar keduanya memakai konfigurasi baru.

Panduan antarmuka tersedia pada [dokumentasi Remix](https://remix-ide.readthedocs.io/en/latest/run.html).

## 12. Mendapatkan role dari Admin

Kirim **alamat publik wallet uji** kepada Admin kelompok pemilik deployment. Sebutkan role dan tujuan audit. Admin memakai **Kelola role** atau `setRole(alamat, angkaRole)` di Remix.

| Role | Angka |
|---|---|
| None | 0 |
| Viewer | 1 |
| Editor | 2 |
| Manager | 3 |
| Admin | 4 |

Wallet tanpa role ditolak saat login. Auditor yang perlu Admin mandiri dapat memakai Mode B pada bagian 20.

## 13. Menguji login

Klik **Masuk dengan MetaMask**, izinkan koneksi, lalu periksa pesan. Pesan harus memuat origin `http://localhost:5173`, alamat wallet, chain ID Sepolia, alamat contract, dan nonce.

Setiap challenge berlaku lima menit dan memiliki identifier sendiri. Backend memverifikasi tanda tangan serta mengonsumsi challenge secara atomik sebelum menerbitkan JWT. Role dibaca ulang pada setiap API profil. Pergantian akun/jaringan mengakhiri sesi React.

Batas lima menit adalah 60 challenge per client, 20 per wallet, dan 120 permintaan login per client. HTTP 429 meminta client menunggu lima menit.

## 14. Menguji CRUD on-chain

Sepakati perubahan Sepolia dengan kelompok pemilik aset. Gunakan mode lokal untuk serangan aktif dan pengujian beban.

1. Login sebagai Editor, Manager, atau Admin. Klik **Tambah aset**, lalu isi nama, kategori, lokasi, kondisi, dan custodian nonzero pada **Aset**. UI membatasi setiap field teks pada 256 byte UTF-8 untuk menghindari transaksi yang tidak wajar; contract legacy sendiri belum memiliki batas ini.
2. Simpan, konfirmasi di MetaMask, dan tunggu blok. Aset akan muncul.
3. Klik **Ubah**, simpan perubahan, dan verifikasi hasilnya.
4. Sebagai Manager atau Admin, pilih **Hapus**. Soft delete menetapkan `active=false`.
5. Viewer dapat membaca aset. Klik **Muat ulang aset** untuk melihat transaksi dari browser lain atau Remix.
6. Gunakan **Detail** untuk melihat timestamp, pembuat, dan custodian. **Ubah** serta **Hapus** mengikuti role. Dialog penghapusan meminta konfirmasi.
7. Gunakan **Berikutnya/Sebelumnya** untuk berpindah rentang 12 ID. Pencarian dan filter berlaku pada halaman saat ini; kartu statistik diberi label sesuai cakupannya. ID riwayat mencakup soft delete, sehingga halaman dapat kosong walaupun rentang berikutnya masih berisi aset.
8. Notifikasi menampilkan tahap konfirmasi wallet dan mining; transaksi Sepolia menyediakan tautan Etherscan.

Di Remix, muat ABI dan alamat yang sama melalui **Add Contract**. Periksa `getAsset(id)` setelah perubahan React. Aset terhapus masih memiliki riwayat, sedangkan `getAllAssets()` melewatinya.

Dashboard memakai getAsset per ID dan snapshot blok yang sama, tanpa memanggil getAllAssets. Penghitungan rentang memakai pencarian eksponensial/biner atas ID yang berurutan. Pembacaan aggregate legacy tetap rentan jika dipanggil langsung; mitigasi dashboard dibahas pada bagian 21.

## 15. Menguji CRUD off-chain

Buka **Profil saya**, isi nama/email/departemen, lalu simpan untuk membuat profil. Buka kembali untuk membaca data, ubah departemen untuk menguji update. Admin dapat membuka **Data pengguna**, mengubah seluruh field profil pengguna lain, lalu menghapus profil uji.

Database kosong dibuat pada named volume baru. Penghapusan profil mempertahankan role on-chain.

## 16. Menguji empat role

| Aksi | Viewer | Editor | Manager | Admin |
|---|---|---|---|---|
| Membaca aset | Ya | Ya | Ya | Ya |
| Membuat/mengubah aset | — | Ya | Ya | Ya |
| Soft delete aset | — | — | Ya | Ya |
| Mengelola role | — | — | — | Ya |
| Membuat/membaca/mengubah profil sendiri | Ya | Ya | Ya | Ya |
| Melihat direktori profil | — | Ya | Ya | Ya |
| Mengubah/menghapus profil orang lain | — | — | — | Ya |

Gunakan wallet berbeda, berganti akun, lalu login kembali. Suite otomatis menguji penolakan langsung pada contract dan API. Pencabutan role berlaku walaupun JWT lama masih ada.

## 17. Melihat log Docker

```powershell
docker compose logs --tail=100
docker compose logs -f backend frontend
docker compose ps
```

Ctrl+C menghentikan tampilan log. Startup backend menampilkan alamat contract dan chain ID. Bagikan log yang telah diperiksa agar konfigurasi pribadi tetap terlindungi.

## 18. Menghentikan dan memulai ulang

```powershell
docker compose restart
docker compose stop
docker compose start
docker compose down
docker compose up -d
```

Volume profil bertahan saat `down` menghapus container dan jaringan. Untuk perubahan source, gunakan `docker compose up --build -d`. Setelah mengubah lingkungan, gunakan `docker compose up -d --force-recreate`.

## 19. Persistensi SQLite dan backup

Database berada di `/data/data.db` pada volume `buku-aset-audit_profiles`. User node memiliki izin menulis. Data bertahan melewati restart dan siklus down/up.

Buat backup SQLite yang konsisten dan salin ke host.

```powershell
New-Item -ItemType Directory -Path .\backups -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$containerBackup = "/data/backup-$stamp.db"
docker compose exec backend node -e "const Database=require('better-sqlite3'); const db=new Database(process.env.DB_PATH); db.backup('$containerBackup').then(()=>db.close()).catch(()=>{process.exitCode=1;db.close()})"
docker compose cp "backend:$containerBackup" ".\backups\profiles-$stamp.db"
```

Folder backups memuat data pribadi dan dikecualikan dari paket. Pemulihan menggunakan backup pilihan ke volume ketika layanan dihentikan. Verifikasi backup pada lingkungan uji terlebih dahulu.

Reset berikut **menghapus seluruh data profil dan challenge dalam volume uji**. Pastikan backup tersedia dan data memang disposable.

```powershell
docker compose down
docker volume rm buku-aset-audit_profiles
docker compose up -d
```

Instalasi Docker memakai volume sendiri. Database instalasi manual pada host terpisah dari volume tersebut.

## 20. Pengujian keamanan Hardhat terisolasi

### Mode A — Sepolia

Docker utama memakai deployment bersama pada bagian 1. Minta role dari Admin dan sepakati transaksi uji.

### Mode B — salinan lokal

Mode ini memakai Node.js 24 dan npm pada host. Ekstrak ZIP ke folder baru sehingga deployment dan database lokal berada pada salinan terpisah. Contoh berikut memakai ZIP dari folder Downloads; sesuaikan path bila berbeda.

```powershell
$localAuditPath = Join-Path $env:TEMP ('Buku-Aset-Local-' + [guid]::NewGuid().ToString('N'))
Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\Asset-Logging-dApp-Submission-Final.zip" -DestinationPath $localAuditPath
Set-Location (Join-Path $localAuditPath 'blockchain')
npm.cmd ci
npm.cmd ci --prefix backend
npm.cmd ci --prefix frontend
npm.cmd run compile
npm.cmd test
npm.cmd run test:backend
npm.cmd run build --prefix frontend
Get-Location
```

Buka empat terminal pada folder salinan tersebut.

**Terminal lokal 1**

```powershell
npm.cmd run node -- --hostname 127.0.0.1
```

**Terminal lokal 2**

```powershell
npm.cmd run deploy:local
```

Akun Hardhat #0 menjadi Admin. Script menulis konfigurasi dalam salinan lokal.

**Terminal lokal 3**

Salin contoh konfigurasi lalu sunting nilainya.

```powershell
Copy-Item .\backend\.env.example .\backend\.env
```

Isi JWT_SECRET acak. Gunakan `DB_PATH=audit-data.db`, `HOST=127.0.0.1`, `TRUST_PROXY_HOPS=0`, dan `FRONTEND_ORIGIN=http://localhost:5174`.

```powershell
$localSecret = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
(Get-Content -LiteralPath .\backend\.env) -replace '^JWT_SECRET=.*$', ('JWT_SECRET=' + $localSecret) -replace '^DB_PATH=.*$', 'DB_PATH=audit-data.db' -replace '^FRONTEND_ORIGIN=.*$', 'FRONTEND_ORIGIN=http://localhost:5174' |
    Set-Content -LiteralPath .\backend\.env -Encoding ascii
```

```powershell
npm.cmd start --prefix backend
```

**Terminal lokal 4**

```powershell
npm.cmd run dev --prefix frontend -- --host localhost --port 5174 --strictPort
```

Tambahkan Hardhat Local pada MetaMask dengan RPC `http://127.0.0.1:8545` dan chain ID `31337`. Impor akun disposable dari output node lokal. Buka `http://localhost:5174`. Admin lokal dapat menetapkan seluruh role.

Untuk deploy melalui Remix ke node lokal, gunakan file kanonis, compiler 0.8.24, Paris, optimizer nonaktif, dan wallet lokal pada Browser Extension. Simpan ABI dan alamat pada salinan lokal, lalu jalankan `npm.cmd run sync:remix -- ALAMAT_LOKAL 31337 remix-abi.json`.

### Instalasi manual Sepolia

Gunakan tiga perintah npm ci di atas pada source yang memakai konfigurasi Sepolia. Salin `backend/.env.example` ke `backend/.env`, isi secret, pertahankan origin `http://localhost:5173`, lalu jalankan backend dan Vite pada terminal terpisah.

```powershell
npm.cmd start --prefix backend
```

```powershell
npm.cmd run dev --prefix frontend -- --host localhost --port 5173 --strictPort
```

Salin `frontend/.env.example` bila URL backend perlu diubah. Hentikan frontend Docker bila port 5173 akan dipakai Vite. Sinkronisasi Sepolia yang disengaja memakai `npm.cmd run compile` lalu `npm.cmd run sync:remix -- 0xda0349D26Fb38dfC3Cf416feB0a9670C5cb6ad1C 11155111 remix-abi.json`.

### Perintah verifikasi untuk developer/auditor

Setelah npm ci untuk ketiga folder pada salinan uji, jalankan:

```powershell
npm.cmd run compile -- --force
npm.cmd test
npm.cmd run test:backend
npm.cmd run test:ui
npm.cmd run build --prefix frontend
node scripts/verify-deployment.cjs
```

Test UI memakai Chrome terisolasi, contract Hardhat in-process, dan SQLite in-memory. Tidak membaca profil Chrome/MetaMask pribadi dan tidak menulis Sepolia. Set CHROME_PATH bila Chrome berada di lokasi lain; default Windows adalah C:/Program Files/Google/Chrome/Application/chrome.exe. Verifikasi deployment hanya membaca RPC Sepolia dan membandingkan bytecode executable dengan compiler 0.8.24 Shanghai.

```powershell
npm.cmd audit
npm.cmd audit --prefix backend
npm.cmd audit --prefix frontend
npm.cmd audit --omit=dev
npm.cmd audit --omit=dev --prefix backend
npm.cmd audit --omit=dev --prefix frontend
```

Audit penuh dapat exit 1 karena advisory development yang tercatat dalam laporan. Hindari audit fix --force. Patch/migrasi berikutnya perlu regression tests.

Untuk Slither opsional, instal Python 3 lalu jalankan pada salinan uji:

```powershell
py -m venv .audit-tools
.\.audit-tools\Scripts\python.exe -m pip install slither-analyzer==0.11.6
npm.cmd run compile -- --force
.\.audit-tools\Scripts\slither.exe . --compile-force-framework hardhat --hardhat-ignore-compile --json slither-results.json
```

Slither dapat exit nonzero karena warning. Legacy mempertahankan delapan hasil historis; V2 memiliki tiga warning timestamp yang dijelaskan dalam laporan. Jangan menafsirkan jumlah warning sebagai jumlah vulnerability terkonfirmasi.

Smoke test Docker opsional memakai port 5176 dan volume proyek terpisah, sehingga aplikasi utama di port 5173 tetap tersedia:

```powershell
docker compose build
node scripts/test-docker.cjs
```

Script memerlukan Node/dependensi backend pada host untuk tooling audit saja, serta Compose 2.24.4+ yang mendukung !override. Data sintetis dan backup uji berada pada volume buku-aset-audit-check_profiles; volume utama tidak dihapus. Hasil lokal berada di docker-audit-results.

### Usulan V2 dan rencana migrasi

1. Jalankan npm test; suite V2 menguji pagination, deleted-ID gaps, gas halaman tetap, ukuran teks, role, event, dan timestamp.
2. Tinjau source V2 secara terpisah. API aggregate diganti API paginated; frontend legacy belum dialihkan ke V2.
3. Bila tim menyetujui migrasi, tentukan jaringan/alamat baru dan lakukan review sebelum deployment apa pun.
4. Admin mengekspor role serta aset legacy melalui pembacaan yang berizin. Tentukan mapping ID lama-baru dan simpan provenance ekspor.
5. Create pada contract baru akan memiliki timestamp/createdBy baru. Jangan mengklaim metadata lama otomatis dipertahankan; mekanisme import khusus memerlukan desain/review terpisah.
6. Uji deployment dan pemetaan role/aset sepenuhnya di Hardhat. Perbarui consumer API paginated, ABI/hash/address kedua sisi secara eksplisit hanya untuk deployment yang disetujui. Simpan konfigurasi legacy untuk rollback aplikasi; transaksi blockchain tidak dapat di-rollback.

## 21. Catatan keamanan

Kedua runtime memakai non-root user, filesystem read-only, capability yang dilepas, dan batas resource. Hanya frontend dipublikasikan pada `127.0.0.1:5173`. Backend memakai jaringan Compose dengan akses keluar untuk RPC.

Frontend runtime berisi Nginx dan build statis. Backend runtime memuat dependensi produksi. Tooling Vite/esbuild/Hardhat berada di tahap build atau alur pengembangan.

Challenge terpisah, konsumsi atomik, rate limit, dan pembersihan data kedaluwarsa diterapkan. Nginx mengganti forwarded IP. Mode manual memakai `TRUST_PROXY_HOPS=0`.

Temuan `getAllAssets()` pada deployment immutable masih **UNFIXED ON-CHAIN**. Dashboard sudah **MITIGATED** melalui pembacaan getAsset per ID, maksimal 12 ID per halaman, snapshot blok, dan pembatalan hasil sesi lama. Setiap eth_call mengembalikan satu record dan tetap memakai signer ber-role. Record legacy dengan string sangat besar masih berpotensi membebani satu panggilan. `getMembers()` pada layar Admin masih membaca seluruh riwayat anggota.

`contracts/AssetRegistryV2.sol` adalah usulan terpisah, hanya diuji pada Hardhat. V2 menyediakan getAssetsPage/getMembersPage dengan maksimal 25 ID yang dipindai dan teks maksimum 256 byte. Tidak ada deployment V2, penggantian ABI, atau migrasi Sepolia otomatis.

Semua Admin legacy mempunyai kewenangan yang sama. Admin B boleh mencabut Admin A, termasuk deployer; self-revoke dan self-downgrade ditolak. Ini sesuai spesifikasi, bukan privilege escalation. Kebijakan protected owner memerlukan keputusan governance terpisah.

Data blockchain bersifat publik meskipun fungsi baca aplikasi memeriksa role. Simpan informasi pribadi hanya pada profil SQLite sesuai kebutuhan.

`SECURITY_AUDIT_REPORT.md` adalah baseline sebelum hardening. `SECURITY_REMEDIATION_REPORT.md` memuat status versi Docker, hasil test, advisory, serta batasan. PoC baseline menggambarkan perilaku versi sebelum perbaikan.

## 22. Pemecahan masalah

| Gejala | Tindakan |
|---|---|
| Docker Engine belum tersedia | Jalankan Docker Desktop dan periksa WSL 2 serta Linux containers. |
| Build gagal mengunduh metadata image/DNS Docker Hub | Periksa koneksi Docker Desktop dan coba ulang perintah build. Jangan menonaktifkan verifikasi TLS. |
| .env.docker belum ada | Jalankan helper pada bagian 7. |
| JWT_SECRET ditolak | Isi secret acak minimal 32 karakter lalu recreate backend. |
| Backend unhealthy | Periksa log, koneksi internet, RPC Sepolia, alamat, chain ID, dan code hash. |
| RPC timeout/rate limit | Isi endpoint HTTPS khusus lalu recreate backend. |
| Port 5173 digunakan | Hentikan proses lain pada port itu. |
| API mengembalikan HTML Vite | Hentikan Vite lama pada port 5173, termasuk listener IPv6 ::1. Localhost dapat memilih IPv6 sementara Docker memakai 127.0.0.1. |
| Nginx 502 | Periksa health/log backend dan restart frontend setelah backend pulih. |
| Origin ditolak | Cocokkan URL browser dan FRONTEND_ORIGIN. |
| Wallet tanpa role | Minta role dari Admin atau gunakan Mode B. |
| HTTP 429 | Tunggu lima menit. |
| SQLite tidak dapat ditulis | Periksa volume dan user node. Backup sebelum pemeliharaan izin. |
| Pembacaan aset/anggota gagal | Periksa RPC, retry, dan batasan legacy/string besar/getMembers pada bagian 21. |
| Hardhat ESM gagal | Jalankan npm ci dengan lockfile proyek untuk memulihkan Hardhat 2 dan plugin yang terkunci. |

## 23. Pengumpulan dan instruksi audit

ZIP Docker menyertakan source, contract, tests, Compose, Dockerfiles, Nginx, safe environment examples, lockfiles, konfigurasi publik, ABI Remix, dan laporan keamanan. Secret aktif, database pribadi, installed dependencies, Git history, dan artefak sementara dikecualikan.

Urutan tercepat setelah ekstraksi adalah berikut.

```powershell
Set-Location .\blockchain
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-docker.ps1
docker compose up --build -d
docker compose ps
```

Buka `http://localhost:5173`, pilih Sepolia, dan login dengan wallet ber-role. Gunakan Mode B untuk serangan aktif. Hasil verifikasi serta daftar perubahan ada dalam laporan remediasi.

Checklist manual integrasi MetaMask yang perlu diselesaikan pemilik wallet:

- Connect MetaMask, pilih Sepolia, dan tandatangani pesan login dengan origin yang benar.
- Buka dashboard Admin; periksa wallet, network, dan role.
- Dengan persetujuan pemilik state bersama, create/update/soft delete aset uji dan periksa transaksi Etherscan.
- Tetapkan Viewer pada wallet uji; pastikan tidak ada kontrol tulis dan pemanggilan langsung tetap ditolak.
- Simpan profil, restart Docker, login kembali, dan pastikan profil bertahan.

Transaksi interaktif MetaMask pada Sepolia tidak diklaim PASS oleh suite otomatis. Pengujian tulis otomatis hanya memakai Hardhat lokal.
