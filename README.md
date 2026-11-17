# Asset Logging dApp (Buku Aset)

Mini Project Blockchain Phase 1 untuk mata kuliah COMP6873001 Blockchain Fundamental, BINUS University. Buku Aset mencatat inventaris kantor di Hardhat Local atau Ethereum Sepolia dan menyimpan profil pengguna di SQLite.

## Arsitektur

- **Remix IDE** mengompilasi `contracts/AssetRegistry.sol` dan memakai MetaMask untuk deploy serta menguji contract di Hardhat Local atau Ethereum Sepolia.
- **React 18 + Vite 5** memakai ethers.js v6 untuk membaca contract dan mengirim transaksi bertanda tangan MetaMask ke alamat yang sama.
- **Hardhat** menjalankan blockchain lokal (chain ID `31337`), menyediakan compile Solidity 0.8.24 dan pengujian otomatis.
- **Express 4** membaca role dari AssetRegistry melalui RPC dan mengelola profil lewat **SQLite** (better-sqlite3).

**On-chain** tersimpan ID, nama, kategori, lokasi, kondisi, alamat penanggung jawab, pembuat, waktu pembuatan dan perubahan, status aktif, role wallet, serta event perubahan. Penghapusan mengubah `active` menjadi `false`. `getAllAssets()` melewati aset tersebut, sedangkan `getAsset(id)` tetap mengembalikan datanya. Data blockchain dapat diperiksa melalui node.

**Off-chain** tersimpan alamat wallet, nama, email, departemen, waktu pembuatan dan perubahan profil, serta nonce login sementara di `backend/data.db`.

## Hak akses

Urutan dan nilai Solidity `None = 0`, `Viewer = 1`, `Editor = 2`, `Manager = 3`, `Admin = 4`.

| Aksi | Viewer | Editor | Manager | Admin |
|---|---|---|---|---|
| Lihat aset | Ya | Ya | Ya | Ya |
| Tambah dan ubah aset | — | Ya | Ya | Ya |
| Hapus aset (soft delete) | — | — | Ya | Ya |
| Baca anggota, atur dan cabut role | — | — | — | Ya |
| Buat, baca, dan ubah profil sendiri | Ya | Ya | Ya | Ya |
| Baca direktori profil | — | Ya | Ya | Ya |
| Ubah dan hapus profil pengguna lain | — | — | — | Ya |

Wallet deployer otomatis menjadi Admin. Wallet dengan role `None` ditolak saat login dan saat memanggil fungsi aset. `getRole(address)` dapat dipanggil publik. Admin tidak dapat mencabut atau menurunkan rolenya sendiri.

## Autentikasi

React meminta akses MetaMask, mengecek chain ID dan kecocokan deployment, lalu meminta tantangan dari Express. Tantangan berisi alamat wallet, origin aplikasi, chain ID, alamat AssetRegistry, dan nonce acak dengan masa berlaku lima menit. MetaMask menandatangani pesan. Express memverifikasi alamat penanda tangan dan mengonsumsi nonce melalui satu operasi SQL bersyarat sebelum membaca role dan menerbitkan JWT dua jam. Setiap endpoint profil memverifikasi JWT dan membaca ulang role dari blockchain. Perubahan akun, jaringan, atau putus koneksi MetaMask mengakhiri sesi di React. React memeriksa ulang role pada sesi aktif setiap beberapa detik.

## Instalasi

Gunakan Node.js 24 LTS, npm, browser dengan MetaMask, dan koneksi internet untuk instalasi dependensi, pengunduhan compiler, dan akses Remix. Jalankan dari folder `blockchain`. Di Windows PowerShell, gunakan `npm.cmd` dan `npx.cmd` jika execution policy memblokir skrip npm.

```bash
npm ci
npm ci --prefix backend
npm ci --prefix frontend
npm run compile
npm test
npm run test:backend
```

Untuk demo Hardhat Local, jalankan node di terminal 1 dari folder `blockchain`. Alur Sepolia memakai RPC testnet publik.

```bash
npm run node -- --hostname 127.0.0.1
```

Biarkan terminal ini tetap berjalan sepanjang demo. Di MetaMask, tambahkan jaringan khusus **Hardhat Local**, RPC `http://127.0.0.1:8545`, chain ID `31337`, simbol `ETH`. Gunakan profil browser khusus demo dan impor akun uji Hardhat #0 (Admin), #1 (Manager), #2 (Editor), dan #3 (Viewer). Akun #4 dapat dipakai untuk menguji penetapan Admin tambahan. Gunakan kunci akun uji yang ditampilkan terminal Hardhat hanya untuk jaringan lokal ini. Catat **alamat publik** setiap akun sebagai `A0` sampai `A4`.

## Deploy melalui Remix IDE

### Hardhat Local (31337)

1. Buka [Remix IDE](https://remix.ethereum.org/). Situs tersebut mengarahkan pengguna ke [alamat Remix saat ini](https://app.remix.live/). Di **Files → Create → Upload files**, pilih `contracts/AssetRegistry.sol`, lalu buka file yang diunggah.
2. Buka **Solidity Compiler**, pilih `0.8.24+commit.e11b9ed9`, buka **Advanced Configurations**, pilih EVM **paris**, dan biarkan optimizer nonaktif. Klik **Compile AssetRegistry.sol** lalu pilih contract **AssetRegistry**.
3. Buka **Deploy & Run Transactions**. Pilih **Browser Extension**, kemudian **MetaMask**. Pada antarmuka lama, pilih **Injected Provider – MetaMask**. Di MetaMask, pastikan RPC **Hardhat Local** adalah `http://127.0.0.1:8545` dengan chain ID `31337`. Remix dapat menampilkan label **GoChain Testnet (31337)** untuk angka tersebut. Cocokkan alamat akun aktif di Remix dengan `A0`, pilih contract **AssetRegistry**, isi **Value** `0`, dan nonaktifkan **Verify Contract on Explorers** jika tampil.
4. Klik **Deploy**, lalu konfirmasi transaksi lokal di MetaMask. Constructor tidak memiliki parameter. Salin alamat dari **Deployed Contracts** dan panggil `getRole(A0)`. Hasil yang diharapkan `4`.
5. Kembali ke **Solidity Compiler** dan klik **ABI** di bagian **Copy to Clipboard**. Tombol **Compilation Details** juga memuat ABI. Simpan array JSON tersebut sebagai `remix-abi.json` di folder `blockchain`.
6. Terminal 2, dari folder `blockchain`, masukkan alamat dari langkah 4.

```bash
npm run sync:remix -- ALAMAT_DARI_REMIX 31337 remix-abi.json
```

Script memeriksa chain ID, ABI, keberadaan contract dan kecocokan bytecode eksekusi dengan hasil kompilasi kanonis. Metadata Solidity dapat berbeda karena nama/path file di Remix dan Hardhat. Script menulis alamat, ABI, chain ID, dan hash bytecode RPC yang sama ke `frontend/src/contract.json` dan `backend/contract.json`.

Untuk pengujian terpisah, `npm run deploy:local` melakukan deploy dengan Hardhat dan menimpa kedua file konfigurasi tersebut. Jika menjalankannya, sinkronkan lagi alamat Remix dan mulai ulang aplikasi sebelum demo. Contract dengan enum tiga role lama perlu di-deploy ulang. Deployment dan data aset baru akan memiliki keadaan blockchain sendiri. Data profil SQLite tetap tersimpan.

Panduan antarmuka [Solidity Compiler](https://remix-ide.readthedocs.io/en/latest/compile.html) dan [Deploy & Run](https://remix-ide.readthedocs.io/en/latest/run.html).

### Ethereum Sepolia (11155111)

Paket pengumpulan Phase 1 menyertakan konfigurasi publik dan ABI untuk AssetRegistry di `0xda0349D26Fb38dfC3Cf416feB0a9670C5cb6ad1C`. Untuk memakai deployment ini, instal dependensi lalu ikuti bagian **Jalankan aplikasi** dan pilih Sepolia di MetaMask. Untuk login, gunakan wallet dengan role yang telah diberikan oleh Admin. Wallet yang melakukan transaksi memerlukan ETH uji Sepolia.

1. Aktifkan **Show test networks** di menu jaringan MetaMask dan pilih **Sepolia** (chain ID `11155111`) untuk Remix. [Panduan jaringan uji MetaMask](https://support.metamask.io/configure/networks/how-to-view-testnets-in-metamask/)
2. Untuk deployment baru, kompilasi `contracts/AssetRegistry.sol` dengan Solidity **0.8.24**, target **Paris** atau **Shanghai**, dan optimizer nonaktif. Di **Deploy & Run Transactions → Browser Extension**, pilih MetaMask dan pastikan Sepolia aktif sebelum menyetujui deploy. Untuk contract yang sudah di-deploy, gunakan alamat dan ABI deployment tersebut.
3. Panggil `getRole(alamatDeployer)` dan cek hasil `4`. Salin **ABI** hasil kompilasi sebagai `remix-abi.json` di root, lalu jalankan perintah berikut dari root setelah `npm run compile`.

```bash
npm run sync:remix -- ALAMAT_DARI_REMIX 11155111 remix-abi.json
```

Script memeriksa chain ID, alamat, ABI, dan bytecode deployment Sepolia. Script membandingkan bytecode dengan build Hardhat Paris dan mencoba build Shanghai dari sumber yang sama bila diperlukan. Build tambahan tersebut memakai compiler Hardhat 0.8.24 dan tidak mengubah artefak Paris. Kedua `contract.json` berisi konfigurasi yang sama.

Backend memilih RPC dari chain ID di `contract.json`. Hardhat Local memakai `RPC_URL` dengan bawaan `http://127.0.0.1:8545`. Sepolia memakai `SEPOLIA_RPC_URL` dengan bawaan [RPC publik Sepolia dari PublicNode](https://ethereum.publicnode.com/). Untuk endpoint khusus, isi `SEPOLIA_RPC_URL` di `.env` root untuk sinkronisasi dan di `backend/.env` untuk backend, atau sediakan variabel lingkungan tersebut pada kedua proses. Simpan kredensial RPC di konfigurasi lokal.

Setelah sinkronisasi, mulai ulang backend dan frontend. Pilih **Sepolia** juga untuk situs Buku Aset di MetaMask. React memeriksa chain ID sebelum meminta tanda tangan login.

## Jalankan aplikasi

Gunakan terminal 3. Salin `backend/.env.example` ke `backend/.env` dan isi `JWT_SECRET` dengan nilai acak. Perintah berikut menghasilkan nilai lokal.

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

```bash
cd backend
npm start
```

Backend memakai `http://127.0.0.1:4000`. Cocokkan alamat dan chain ID di log startup dengan Remix.

Terminal 4. Salin `frontend/.env.example` ke `frontend/.env` bila perlu mengubah URL backend.

```bash
cd frontend
npm run dev -- --host localhost --port 5173 --strictPort
```

Buka `http://localhost:5173`. `FRONTEND_ORIGIN` di `backend/.env` harus persis sama dengan origin yang dibuka di browser.

## Checklist demo Remix dan React

Ganti `A0`–`A4` dengan alamat publik wallet. Setiap kali berganti wallet, cocokkan kolom **Account** di Remix dengan akun aktif MetaMask. Jika akun belum tersedia, tambahkan akun itu ke izin koneksi situs Remix. Isi parameter string di kolom terpisah melalui tombol expand fungsi. Konfirmasi transaksi yang diizinkan di MetaMask dan tunggu sampai masuk blok.

| Urutan | Wallet dan lokasi | Tindakan | Hasil yang diharapkan |
|---|---|---|---|
| 1 | #0, Remix | `getRole(A0)` | `4` |
| 2 | #0, Remix | `setRole(A1, 3)`, `setRole(A2, 2)`, `setRole(A3, 1)`. Opsional `setRole(A4, 4)`. Panggil `getMembers()`. | Alamat dan nilai role benar. |
| 3 | #2, Remix | `createAsset("Laptop Demo", "IT", "Lab 2", "Baik", A2)`. Catat `id` dari event `AssetCreated`, biasanya `0` untuk aset pertama. | Event mencatat ID baru dan pembuat `A2`. |
| 4 | #3, Remix | `getAsset(id)` dan `getAllAssets()`. Coba juga `updateAsset(id, "Ubah Ditolak", "IT", "Lab 2", "Baik", A2)`. | Aset aktif terlihat. Perubahan ditolak. |
| 5 | #0, React | **Masuk dengan MetaMask**, izinkan koneksi dan tandatangani tantangan. Buka **Aset** atau klik **Muat ulang aset**. | Role Admin dan **Laptop Demo** dari langkah 3 terlihat. |
| 6 | #2, React | Ganti akun lalu masuk lagi. Klik **Ubah** untuk **Laptop Demo**, ganti nama ke **Laptop Demo Revisi** dan lokasi ke **Lab 3**. Simpan dan konfirmasi. | Baris diperbarui setelah transaksi dikonfirmasi. Tombol hapus dan tab **Kelola role** tidak tampil. |
| 7 | #2, Remix | `getAsset(id)` lalu coba `deleteAsset(id)`. | Nama dan lokasi dari langkah 6 terlihat. Penghapusan ditolak dengan `Akses ditolak: role tidak cukup`. |
| 8 | #1, Remix | Coba `setRole(A3, 2)` dan `revokeRole(A3)`. | Kedua aksi ditolak dengan `Akses ditolak: role tidak cukup`. |
| 9 | #1, React dan Remix | Masuk sebagai Manager. Tambahkan aset uji kedua lewat **Aset**. Hapus **Laptop Demo Revisi** di React. Di Remix, panggil `getAsset(id)`, `getAllAssets()`, lalu `deleteAsset(idKedua)`. | Pembuatan dan penghapusan dikonfirmasi. Aset pertama hilang dari daftar aktif, riwayatnya tetap terbaca dengan `active = false`. Aset kedua hilang dari React setelah **Muat ulang aset**. |
| 10 | #3, React | Masuk sebagai Viewer. Buat profil melalui **Profil saya** dengan nama, email, dan departemen. Buka ulang profil untuk membaca data, lalu ubah departemen dan simpan. | Profil tersimpan. Tab **Data pengguna** dan **Kelola role** tidak tampil. |
| 11 | #0, React | Masuk sebagai Admin. Buka **Data pengguna**, ubah profil `A3`, periksa perubahan di tabel, lalu hapus profilnya. | Baris hilang. `getRole(A3)` tetap `1` dan Viewer masih bisa masuk untuk mengisi ulang profil. |
| 12 | #0, Remix, lalu #3 | `revokeRole(A3)` dan `getRole(A3)`. Coba login React atau panggil `getAllAssets()` dari akun #3. | Role `0`, sesi aktif Viewer berakhir, login dan pembacaan aset ditolak. |

Di **Kelola role** React, Admin dapat menetapkan Viewer, Editor, Manager, dan Admin sesuai angka pada tabel, serta mencabut akses wallet lain. Gunakan akun uji yang sudah dicabut untuk mengulangi demonstrasi dari UI.

Untuk melihat sesi Viewer aktif berakhir saat role dicabut, jalankan React dengan akun #3 pada profil browser demo terpisah saat Admin melakukan transaksi pencabutan.

## Pengujian

| Perintah | Hasil |
|---|---|
| `npm run compile` | 1 file Solidity berhasil dikompilasi dengan 0.8.24, target Paris. |
| `npm test` | 11 pengujian Hardhat lulus, termasuk CRUD, pembatasan role, validasi, timestamp, soft delete, dan event. |
| `npm run test:backend` | 6 pengujian Express/SQLite dengan AssetRegistry asli di Hardhat lulus, termasuk tanda tangan, nonce kedaluwarsa dan replay serentak, JWT, role terbaru, dan persistensi setelah server dibuka ulang. |
| `npm run deploy:local` | Deployment opsional ke chain `31337` berhasil dan menghasilkan kedua konfigurasi. |
| `npm run sync:remix -- ALAMAT 31337 FILE_ABI` | ABI ekspor Remix dan bytecode hasil deploy cocok. Kedua konfigurasi identik. Uji chain ID salah, alamat cacat, ABI tidak lengkap, alamat tanpa contract, dan bytecode berbeda semuanya ditolak. |
| `npm run sync:remix -- ALAMAT 11155111 FILE_ABI` | Sinkronisasi deployment Sepolia lulus lewat RPC baca-saja. ABI dan hash bytecode dari RPC cocok dengan kedua konfigurasi yang identik. |
| `npm start --prefix backend` | Express berhasil berjalan dengan konfigurasi Hardhat Local dan Sepolia pada pengujian terpisah. |
| `npm run build --prefix frontend` | Build Vite 5 berhasil setelah sinkronisasi dengan deployment Remix. |

Uji Chrome memakai provider wallet uji EIP-1193 yang terhubung ke Hardhat Local. Keempat role, login dengan tanda tangan, jaringan salah, pergantian akun, penolakan transaksi, CRUD aset dan profil, serta pencabutan role lulus. Pada IDE Remix yang aktif, Solidity 0.8.24 berhasil dikompilasi dan deployer mendapat role `4`. Aset `0` dibuat di Remix, tampil di React, lalu diubah dari React. Pembacaan `getAsset(0)` di Remix menampilkan nama dan lokasi yang baru. Soft delete dari Remix mengubah status aset menjadi `false` dan mengeluarkan aset tersebut dari daftar aktif.

Jalankan checklist demo dengan ekstensi MetaMask dan wallet uji untuk memverifikasi persetujuan koneksi, tanda tangan, deploy, dan transaksi pada browser presentasi. Verifikasi otomatis di Chrome memakai provider uji.

## Pemecahan masalah

| Gejala | Tindakan |
|---|---|
| MetaMask belum tersedia | Pasang dan buka ekstensi pada profil browser demo. |
| Chain ID salah | Pilih jaringan deployment di MetaMask. Gunakan Hardhat Local `31337` dengan RPC `http://127.0.0.1:8545`, atau Sepolia `11155111` dengan RPC Sepolia. |
| `contract.json` belum tersedia | Jalankan sinkronisasi dari root lalu mulai ulang backend dan Vite. |
| ABI atau bytecode berbeda | Pilih contract AssetRegistry dari file kanonis. Gunakan 0.8.24 dengan optimizer nonaktif dan target Paris untuk Hardhat Local, atau Paris maupun Shanghai untuk Sepolia. Pastikan ABI dan alamat berasal dari deployment yang sama. |
| Contract tidak ditemukan | Cek node dan jaringan MetaMask. Deploy melalui Remix, lalu sinkronkan alamat baru. |
| Wallet tidak berwenang | Periksa `getRole(alamat)`. Minta Admin menetapkan role dan masuk kembali. |
| Transaksi gagal | Periksa role, ID aset aktif, field wajib, alamat custodian nonzero, saldo ETH uji, dan status konfirmasi di MetaMask. |
| Backend tidak bisa dihubungi | Periksa log Express, `JWT_SECRET`, port 4000, `VITE_API_URL`, serta `FRONTEND_ORIGIN`. |
| SQLite error | Gunakan Node.js 24 LTS, ulangi `npm ci --prefix backend`, dan pastikan folder `backend` dapat ditulis. Cadangkan `data.db` sebelum tindakan pemulihan. |
| Node Hardhat di-restart | Lakukan deploy dan sinkronisasi ulang, lalu mulai ulang backend dan frontend. Jika MetaMask menyimpan nonce transaksi lama, bersihkan aktivitas dan data nonce untuk akun uji di pengaturan MetaMask. |

## Berkas pengumpulan

`Asset-Logging-dApp-Phase1-Final.zip` berisi source contract, script, pengujian, backend, frontend, konfigurasi Hardhat dan Vite, ketiga manifest dan lockfile npm, contoh `.env.example`, `.gitignore`, dan README ini. Paket juga menyertakan `remix-abi.json`, `backend/contract.json`, dan `frontend/src/contract.json` untuk deployment publik Sepolia. Jalankan sinkronisasi ulang jika alamat atau jaringan demo berubah.

File `.env` aktif, kredensial RPC, kunci wallet, data SQLite, riwayat Git, `node_modules/`, `artifacts/`, `cache/`, `dist/`, dan file sementara berada di luar paket. Backend membuat database SQLite lokal saat pertama dijalankan.
