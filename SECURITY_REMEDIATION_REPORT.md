# Laporan Remediasi Keamanan dan Kesiapan Submission — Buku Aset

Pemeriksaan ulang: 18 November 2026, Asia/Jakarta. Laporan ini memperbarui laporan remediasi Docker yang sama. SECURITY_AUDIT_REPORT.md tanggal 17 November dipertahankan sebagai baseline historis; line number dan PoC di sana mengacu pada source sebelum hardening.

## 1. Hasil dan batas keputusan

Aplikasi tetap memakai contract Sepolia **0xda0349D26Fb38dfC3Cf416feB0a9670C5cb6ad1C**, chain ID **11155111**, ABI dan codeHash yang sama. Source legacy AssetRegistry.sol dipertahankan byte-for-byte. Tidak ada redeployment, transaksi tulis Sepolia, perubahan empat role, commit/push, atau penghapusan database/volume pengguna.

Hasil terkini: **20 contract/helper tests**, **16 backend tests**, **8 kelompok browser UI**, Vite production build, dan **8 kelompok Docker smoke test**. Login dan CRUD otomatis memakai wallet Hardhat disposable dan SQLite uji; pengujian Docker terhadap Sepolia hanya membaca blockchain dan memverifikasi signature wallet tanpa role.

Ekstensi MetaMask aktual dengan wallet Sepolia ber-role dan transaksi tulis Sepolia tetap **NOT TESTED** dalam pekerjaan ini. Tidak ada klaim aplikasi 100% aman. Penggunaan untuk audit universitas terkontrol sesuai dengan batasan yang dibuka dalam laporan ini.

## 2. Inspeksi dan baseline aktual

Repository sebenarnya berada di folder blockchain, di bawah workspace induk. Entry point frontend adalah index.html → src/main.jsx → src/App.jsx. Tidak ada router atau library UI berat. API adalah backend/server.js. Browser mengirim /api melalui Nginx ke backend:4000; backend membaca role Sepolia dan menyimpan profil SQLite. Transaksi aset/role berasal dari signer MetaMask.

Baseline ulang benar-benar dijalankan: 11 contract tests dan 14 backend tests PASS. Percobaan tes backend dalam sandbox sempat ditolak EACCES pada loopback; pengulangan berizin lulus. Compile V2 sempat membutuhkan download compiler Hardhat; pengulangan dengan akses jaringan berhasil. Kegagalan lingkungan tersebut tidak dilaporkan sebagai vulnerability aplikasi.

Git sudah memuat perubahan user dan file untracked sebelum pekerjaan ini. Tidak ada reset atau perubahan history. Folder dependency, cache, dist, virtualenv audit lama, dump, dan log lokal diidentifikasi sebagai generated/non-submission. Source/config sebelum edit dicatat sebagai hash tanpa nilai credential.

Nonce terpisah dan rate limits dari hardening sebelumnya sudah tersedia saat baseline. Pekerjaan ini memverifikasi kembali kontrol tersebut dan menambah cakupan tests; tidak mengklaimnya sebagai penemuan baru.

## 3. Status keamanan

| Temuan/observasi | Severity dan dasar | Status saat ini |
|---|---|---|
| AUD-01 getAllAssets tanpa batas | Medium, CVSS v4.0 5.3 dari PoC baseline | **MITIGATED pada dashboard; UNFIXED pada contract legacy** |
| AUD-02 challenge dapat diganti caller lain | Low, CVSS v4.0 2.0 pada baseline loopback | **FIXED** oleh nonce independen dari hardening sebelumnya; regression lulus |
| Pertumbuhan challenge/auth abuse | Risiko availability; disk exhaustion tidak diuji | **MITIGATED**, quota, expiry, row cap, trusted proxy boundary |
| getMembers tanpa batas | Keterbatasan arsitektur; ekspansi membutuhkan Admin | **UNFIXED pada legacy**, **FIXED dalam usulan V2 lokal** |
| String aset legacy tanpa batas | Risiko resource; eksploitasi batas RPC aktual belum diuji | **MITIGATED di form**, **UNFIXED on-chain legacy**, dibatasi pada V2 |
| Admin B dapat mencabut Admin A/deployer | Sesuai governance semua Admin setara | **Bukan confirmed vulnerability**; aturan dipertahankan dan diuji |
| Slither default numeric counters | Nilai uint256 default adalah nol | **Informational**, dibuat eksplisit pada V2 |
| Slither timestamp | Tidak ada otorisasi/bisnis berbasis waktu | **False positive pada comparison yang ditunjuk**, timestamp audit dipertahankan |
| Vite 5/esbuild advisories baseline | Development toolchain, termasuk kondisi Windows | **FIXED untuk advisory lama** melalui Vite 6.4.6; residual picomatch dipisahkan |
| Development dependency advisories tersisa | Versi terdampak dan call path diperiksa | **UNFIXED**, tidak termasuk runtime aplikasi |
| Tiga temuan aplikasi High yang pernah disebut | Laporan/PoC pendukung tidak tersedia | **NOT VERIFIED** |

Tidak ada CVSS baru yang dibuat untuk optimisasi, governance yang memang dimaksudkan, atau risiko yang belum direproduksi. CVSS 5.3/2.0 di atas adalah penilaian baseline, bukan klaim severity otomatis pada semua deployment.

### 3.1 AUD-01: agregasi legacy dan mitigasi dashboard

Akar masalah: contracts/AssetRegistry.sol getAllAssets melakukan dua traversal seluruh array termasuk sejarah soft delete, alokasi seluruh record aktif, dan pengembalian string tanpa batas. PoC baseline mencatat 601 aset aktif memerlukan 16.684.724 gas, melewati budget lokal 16.000.000. Ambang ini tidak dianggap ambang pasti RPC Sepolia.

Perbaikan consumer berada di frontend/src/asset-reader.mjs dan Assets pada App.jsx. Dashboard tidak lagi memanggil getAllAssets. ID legacy berurutan dan tidak dihapus secara fisik, sehingga count ditentukan dengan exponential/binary probes getAsset pada satu blockTag. Halaman membaca paling banyak 12 ID secara sekuensial; API helper menolak limit di atas 25. Setiap eth_call mengembalikan satu aset, dengan pemeriksaan role kontrak tetap berlaku. Batas 64 perluasan mencegah pencarian tak berhenti.

Error hanya diperlakukan sebagai akhir registry bila revert ABI Error(string) tepat menyatakan Aset tidak ditemukan. Error role/RPC dipropagasikan. AbortController mencegah hasil sesi/halaman lama menimpa state baru. Statistik aktif dan pencarian secara eksplisit berlabel per halaman; total ID mencakup riwayat terhapus.

Reproduksi regression: create 40 aset di Hardhat, soft delete 12 ID pertama, baca halaman kosong 0–11, lanjut 12–23, lalu halaman akhir 36–39. Test menolak penggunaan fungsi aggregate, memastikan jumlah probe terikat, satu snapshot blok, dan propagasi error/abort. Browser juga menelusuri halaman 12+3 record dan menjalankan CRUD lokal sebenarnya.

Residual: getAllAssets pada Sepolia masih sama; client lain tetap bisa memanggilnya. Satu record legacy dapat memiliki string besar karena batas form bisa dilewati melalui Remix/caller lain. RPC quota, latency sejumlah probe logaritmis, dan batas response provider tetap relevan. Tidak ada klaim pagination native legacy sudah diperbaiki.

Pemetaan: [CWE-770](https://cwe.mitre.org/data/definitions/770.html), [SCSVS-BLOCK-1](https://scs.owasp.org/SCSVS/controls/SCSVS-BLOCK-1/), [SCSTG-TEST-0008](https://scs.owasp.org/SCSTG/tests/SCSVS-BLOCK/SCSTG-TEST-0008/).

### 3.2 V2 terpisah, hanya lokal

contracts/AssetRegistryV2.sol mempertahankan hierarki, events, CRUD, soft delete, serta governance setara. V2 mengganti aggregate dengan getAssetsPage/getMembersPage, limit 1–25, cursor valid, serta nextCursor berdasarkan jumlah ID yang dipindai. Halaman yang seluruhnya terhapus tetap maju, tanpa mengejar 25 record aktif melalui traversal tak terbatas.

V2 membatasi empat field teks masing-masing 256 byte UTF-8, menyimpan timestamp audit, menginisialisasi n/j secara eksplisit, dan memakai length lokal pada loop yang sesuai. Tests meliputi limit/cursor invalid, None/Editor/Viewer restrictions, deleted gaps, oversized multibyte create/update, state lama tidak berubah setelah revert, event/timestamp, member revocation, dan gas halaman tetap setelah registry bertambah dari 5 menjadi 65 aset.

V2 **tidak dideploy**. ABI V2 tidak menggantikan ABI publik. scripts/deploy.js dan sync:remix tetap menargetkan legacy AssetRegistry. Rencana migrasi pada README memerlukan keputusan deployment dan penyesuaian consumer. Create ulang mengubah timestamp/createdBy, sehingga provenance lama tidak boleh diklaim otomatis dipertahankan.

### 3.3 Governance dan otorisasi

Test lokal memberikan Admin kepada B, memverifikasi B tidak dapat self-revoke/self-downgrade, lalu B mencabut A. A menjadi None dan tidak dapat mengelola role atau aset. B tetap Admin dan dapat memberi kembali role A. Ini sesuai aturan semula; tidak ada protected-deployer policy yang disisipkan.

Test baseline tetap memverifikasi Viewer read-only, Editor tidak dapat delete, Manager tidak dapat mengelola role, None ditolak, serta event dan transisi soft delete. Backend selalu membaca role on-chain pada API berizin; UI hanya mengatur usability. Signature/JWT tidak memberi kemampuan melewati kontrak.

### 3.4 Backend, SQLite dan sesi

Kontrol yang dipertahankan: randomBytes(16), challenge per nonce/address/expiry, DELETE bersyarat sekali pakai sebelum JWT issuance, HS256, issuer/audience/expiry dua jam, prepared SQL, whitelist tiga field profil, origin checks dan body limit 16 KB. JWT hanya berada di React memory. Tidak ada private key di server.

Quota lima menit: 60 challenge/client, 20 challenge/wallet, 120 login/client; table challenge dan limiter masing-masing cap 5.000 baris. Expired entries dibersihkan. Nginx menimpa forwarded IP, backend Docker mempercayai satu hop tanpa published port, mode manual trust proxy nol.

Tests tambahan memeriksa unsigned/tampered JWT, issuer berbeda, JSON rusak/oversized dengan response generik, serta inisialisasi ulang schema yang mempertahankan profil dan table nonce lama. Tests lama tetap memeriksa replay paralel, signature/nonce substitution, expiry, mass assignment, SQL payload sebagai teks, IDOR, downgrade/revocation dan persistensi SQLite. Tidak diperlukan perubahan schema baru pada pekerjaan ini.

Residual: quota wallet dapat menunda challenge baru selama jendela limit saat disalahgunakan, namun proof yang sudah ada tidak diganti. JWT yang disalin tetap bearer sampai expiry selama wallet ber-role; logout UI tidak menghapus token yang sudah disalin. Model revoke/re-grant dan perlindungan layanan di jaringan publik membutuhkan keputusan terpisah. [CWE-799](https://cwe.mitre.org/data/definitions/799.html), [WSTG JWT](https://wstg.owasp.org/latest/4-Web_Application_Security_Testing/06-Session_Management/10-JSON_Web_Tokens/).

## 4. Dependency BEFORE → AFTER

Audit enam scope dijalankan ulang sebelum dan sesudah edit. Lockfiles sinkron; npm ci benar-benar lulus di root, backend, frontend, serta builder Docker. Hardhat tetap major 2. Toolbox 5 yang memuat Ignition, gas reporter, TypeChain dan verifier yang tidak dipakai diganti plugin ethers/chai yang benar-benar digunakan. Transitive override yang kehilangan consumer dihapus; override lodash tetap major 4 dan sudah diuji.

| Scope | BEFORE total (low/moderate/high) | AFTER total (low/moderate/high) |
|---|---|---|
| Root full | 47 (30/3/14) | 26 (17/3/6) |
| Backend full | 0 | 0 |
| Frontend full | 2 (0/1/1) | 4 (0/0/4) |
| Root production | 0 | 0 |
| Backend production | 0 | 0 |
| Frontend production | 0 | 0 |

Jumlah gabungan package findings turun 49 → 30, High 15 → 10. Frontend bukan nol: empat package findings setelah update adalah picomatch, fdir, tinyglobby, dan Vite yang mewarisi satu advisory picomatch. Ini diungkap, bukan disembunyikan atau disebut empat vulnerability source aplikasi.

Vite 5.4.21 tidak memiliki patch untuk advisory Windows/editor dan traversal yang dinilai. Migrasi satu major ke 6.4.6 dipilih karena patch pada jalur 6.x tersedia, Node 24 didukung, plugin React 4.7 kompatibel, config hanya memakai plugin React, dan tidak ada Sass/SSR/custom resolver/API eksperimental. Build, dev browser tests, Docker serta integrasi wallet test dipakai untuk validasi. [Migrasi resmi Vite 5 → 6](https://v6.vite.dev/guide/migration), [contoh advisory patched pada 6.4.4](https://github.com/advisories/GHSA-587h-7wmj-h5pm).

| Paket tersisa | Versi terpasang | Advisory dan keterjangkauan | Keputusan |
|---|---|---|---|
| picomatch | 4.0.7 | GHSA-fc5q-39xc-vjpf; ReDoS pola extglob. Dipakai file matching tooling; profil/API tidak diteruskan sebagai glob. | Tidak ada patch upstream tercatat; jangan menjalankan tooling pada pola/proyek tidak tepercaya. |
| serialize-javascript | 6.0.2 | GHSA-5c6j-r48x-rmvq, GHSA-qj8w-gfj5-8c6v, GHSA-m5mm-p8h7-m29v; Mocha serializer, bukan serializer API profil. | Fixed range major 7 di luar range owner; hindari override lintas major tanpa test worker/serializer khusus. |
| tmp | 0.0.33 | GHSA-52f5-9888-hmc6, GHSA-ph9p-34f9-6g65; opsi path sementara milik compiler/tooling, tidak dikendalikan API. | Owner update diperlukan; perubahan 0.x dapat mengubah API. |
| glob | 10.5.0 | GHSA-3g3m-2fjr-6pw4; cancellation traversal filesystem tooling. | Fixed major 14.0.2 di luar range owner. |
| minimatch | 9.0.9 | GHSA-g3hv-75wg-m249; pola khusus/optimisasi tooling. | Fixed major 11.0.1 di luar range owner. |
| diff | 7.0.0 | GHSA-73rr-hh4g-fpgx; parsePatch/applyPatch input tak tepercaya. API tidak memproses patch. | Patch pada major 8, tidak di-force. |
| elliptic | 6.6.1 | GHSA-848j-6mx2-7j84; legacy crypto tooling. Wallet menggunakan MetaMask/ethers v6. | Tidak ada fixed version tercatat; migrasi owner berisiko kompatibilitas. |
| cookie | 0.4.2 | GHSA-pxg6-pf52-xh8x; serializer cookie tooling. API aplikasi memakai bearer JWT dan dependency backend terpisah. | Update owner; API 0.x perlu review. |

Semua paket di tabel adalah development/transitive. Raw audit-evidence mencatat paths, advisory URL, range, severity upstream, serta fixAvailable. npm menawarkan perubahan major/relokasi paket pada beberapa kasus; audit fix --dry-run tidak memperbaiki jumlah 26 dan tidak diterapkan. Tidak ada audit suppression, audit fix --force, atau unsupported cross-major override baru.

Advisory picomatch belum memiliki fixed version pada record yang dibaca. [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf). Satu pola berbahaya pada development tooling masih berisiko; static Nginx runtime dan backend production tidak memuat jalur tersebut. Nol npm production advisories bukan bukti nol vulnerability source atau OS image. Audit CVE OS-level lengkap belum dilakukan.

## 5. Slither: seluruh hasil ditinjau

Perintah nyata: `security-audit/tools/Scripts/slither.exe . --compile-force-framework hardhat --hardhat-ignore-compile --json docker-audit-results/presubmission/slither-after.json` setelah compile 0.8.24. Slither 0.11.6 menganalisis **2 contracts, 102 detectors, 11 results**, JSON success=true. Exit nonzero karena temuan detector, bukan klaim analisis bersih.

| Contract | Detector | Jumlah | Impact/confidence tool | Lokasi | Penilaian manual |
|---|---|---|---|---|---|
| Legacy | uninitialized-local | 2 | Medium/Medium | n baris 118, j baris 121 | Numeric default nol; tidak ada baca sebelum nilai terdefinisi. Informational. Source legacy sengaja dipertahankan agar cocok dengan deployment. |
| Legacy | cache-array-length | 3 | Optimization/High | members baris 68, assets baris 119 dan 122 | Optimisasi valid, tidak menyelesaikan pertumbuhan aggregate. |
| Legacy | timestamp | 3 | Low/Medium | getAsset 112, updateAsset 135, deleteAsset 146 | Comparison sebenarnya ID/length/active. Timestamp hanya audit metadata; false positive taint pada storage. |
| V2 | timestamp | 3 | Low/Medium | getAsset 128, updateAsset 160, deleteAsset 171 | Penjelasan sama. Timestamp sah dipertahankan. |

BEFORE legacy 8 → AFTER legacy 8; V2 tambahan 3. V2 menghasilkan **0 uninitialized-local** dan **0 cache-array-length**. Tidak ada detector disembunyikan. [Slither detector reference](https://github.com/crytic/slither/wiki/Detector-Documentation), [Solidity default values](https://docs.soliditylang.org/en/v0.8.24/control-structures.html#default-value).

## 6. UI dan Docker

| Before | After | Alasan |
|---|---|---|
| Form inline dan tabel sederhana | Dashboard navy/light, stats dari data aktual, modal create/edit/detail | Hierarki dan ruang kerja lebih jelas |
| Aggregate list | Rentang ID, search/filter per halaman dan empty/loading states | Mengurangi beban RPC dan mencegah statistik palsu |
| confirm bawaan | Native dialog, Escape/focus, konfirmasi delete/revoke | Aksesibilitas dan tindakan destruktif yang jelas |
| Status transaksi teks | Toast, tahap wallet/mining, tautan Sepolia Etherscan tervalidasi | Pengguna dapat melacak hasil transaksi |
| Tabel horizontal pada mobile | Kartu aset responsif; navigasi ringkas | Aksi aset tetap terlihat pada layar sempit |
| Google Fonts eksternal | System font, tanpa request font pihak ketiga | Build/run tidak bergantung font eksternal; CSP style/font self |

Tidak ada fake asset/statistic/activity atau runtime demo bypass. Browser tests memasukkan fixture melalui Hardhat dan SQLite lokal sebenarnya; config public source tidak ditimpa. Browser harness memakai provider EIP-1193 terkontrol, bukan ekstensi MetaMask asli.

Transaksi memeriksa ulang eth_accounts dan chain ID sebelum send, memakai ref lock agar klik cepat tidak mengirim dua transaksi, serta menolak hasil sesi yang sudah berubah. Dialog pending mencegah perubahan form. Backend/kontrak tetap menjadi enforcement otoritatif.

Compose tetap dua service dengan SQLite named volume yang sama. Non-root, read-only root filesystem, cap_drop ALL, no-new-privileges, tmpfs/resource limits, health checks, hanya localhost:5173 published dan backend tanpa host binding dipertahankan. Nginx memakai SPA fallback, proxy internal, forwarded IP overwrite, CSP tanpa unsafe-inline style, dan security headers. Runtime frontend tidak memiliki Node/tooling; backend hanya dependency produksi. Secret diinjeksi saat runtime melalui .env.docker dan tidak masuk build context/image.

Smoke script kini memakai port test 5176 dan override Compose lokal supaya tidak perlu menghentikan stack utama. Test hanya restart/down-up proyek buku-aset-audit-check dan memakai profil sintetis serta volume test. Tidak ada penghapusan volume user.

## 7. Perintah dan hasil yang dieksekusi

| Perintah/check | Hasil |
|---|---|
| npm.cmd ci (root), npm.cmd ci --prefix backend/frontend | PASS untuk ketiga scope |
| npm.cmd run compile -- --force | PASS, Solidity 0.8.24 Paris, 2 files |
| npm.cmd test | PASS, 20 tests termasuk 11 baseline |
| npm.cmd run test:backend | PASS, 16 tests termasuk 6 baseline |
| npm.cmd run test:ui | PASS, 8 kelompok Chrome/Hardhat/SQLite |
| npm.cmd run build --prefix frontend | PASS, Vite 6.4.6 |
| npm audit [--prefix backend/frontend], masing-masing --omit=dev | Dijalankan semua; jumlah BEFORE/AFTER di bagian 4 |
| Slither command bagian 5 | EXECUTED, 11 findings reviewed; bukan clean claim |
| docker compose config --quiet | PASS |
| docker compose build | PASS, kedua image |
| docker compose up --build -d --wait --wait-timeout 180 | PASS, kedua service default healthy |
| node scripts/test-docker.cjs | PASS, 8 kelompok, port audit 5176 |
| Profile survives restart dan down/up | PASS pada volume uji sintetis |
| SQLite consistent backup | PASS, backup dibuka dan record uji terbaca |
| Backend no published port, frontend localhost binding | PASS pada container inspect |
| Image env /.env, runtime inventory | PASS pada pola/paths yang diperiksa |
| Audit production dari dalam container backend | PASS, 0 advisory, 0 dev dependencies |
| node scripts/verify-deployment.cjs | PASS baca-saja: chain/address/hash/ABI/executable legacy cocok |
| Actual MetaMask Sepolia authorized login/write CRUD | NOT TESTED; manual checklist di README |

Browser groups mencakup rejection signature, pagination/search/detail, create/update/soft delete, own/Admin profile CRUD, XSS escaping, role grant/revoke, semua role controls, mobile tanpa document overflow, wrong chain/account/disconnect resets, revoked session, dan memory-only JWT. Tidak ada uncaught JS error pada jalur yang diuji.

## 8. File yang berubah pada pemeriksaan ini

| File | Tujuan |
|---|---|
| frontend/src/App.jsx | Dashboard, dialogs, role-aware controls, state/tx guards, page reads |
| frontend/src/styles.css | Sistem visual, responsive cards, focus/reduced-motion |
| frontend/src/ui.jsx | Icon inline SVG dan komponen presentasi minimal |
| frontend/src/asset-reader.mjs | Consumer pagination legacy dengan snapshot dan batas panggilan |
| frontend/index.html | Metadata dan system font tanpa font eksternal |
| frontend/.dockerignore | Memasukkan helper/komponen baru ke allowlist build |
| frontend/nginx.conf | Mengetatkan CSP style/font setelah menghapus dependency font eksternal |
| frontend/package.json, frontend/package-lock.json | Migrasi Vite yang diuji dan reproducible lock |
| package.json, package-lock.json | Plugin Hardhat yang digunakan dan optional browser-test dependency |
| hardhat.config.js | Register hanya ethers/chai plugins; compiler/network tetap |
| contracts/AssetRegistryV2.sol | Proposal terpisah, tidak dideploy |
| test/SecurityRegression.test.js | Governance, bounded legacy reads, V2 dan gas regression |
| backend/server.test.js, backend/security.test.js | JWT/input/schema-preservation regression |
| scripts/test-ui.cjs | Browser EIP-1193/Hardhat/SQLite harness terisolasi |
| scripts/verify-deployment.cjs | Verifikasi read-only, tidak mengubah konfigurasi |
| scripts/test-docker.cjs | Port audit terpisah dan pemeriksaan inventory |
| .gitignore | Mengabaikan tooling Slither/coverage lokal |
| README.md, SECURITY_REMEDIATION_REPORT.md | Panduan Indonesia dan bukti/status terkini |

Backend runtime source/schema, Dockerfiles/Compose, setup-docker.ps1, kontrak legacy, ABI/config publik dan arsip Phase 1 dipertahankan. File lain yang sudah berubah di Git sebelum pekerjaan tidak direvert.

## 9. Residual risks dan verifikasi manual

Prioritas berikutnya adalah menyelesaikan checklist MetaMask ber-role dan Sepolia CRUD dengan persetujuan pemilik state, lalu memutuskan migrasi pagination native bila kapasitas registry membutuhkan. Legacy getMembers, aggregate external consumers, oversized legacy records, trust/quota RPC, stateless JWT lifecycle, serta development tooling advisories tetap perlu diperhatikan.

Cakupan tidak meliputi formal verification, prolonged DoS, semua browser/mobile fisik, compromise RPC, OS image vulnerability scan lengkap, atau pengoperasian private key/MetaMask pribadi. Pemeriksaan Chrome terisolasi dan satu viewport mobile bukan jaminan semua perangkat.

Submission akhir memakai source allowlist, public ABI/config, tests, Docker, examples, laporan, serta bukti audit terkurasi. Tidak memuat .env aktif, secret, private key, personal SQLite, node_modules, dist/cache/artifacts/coverage, Git, backup ZIP, virtualenv atau temporary logs. Credential lokal dibandingkan tanpa dicetak; pattern scan tidak dapat menjamin setiap format rahasia tak dikenal.

Contract legacy SHA-256: 565faa54fbe3b363f79bd6fd160438743f39c7b1ecb041346917bdcc0d2174df. Kedua contract.json SHA-256: 4c33174525f9ca933aacddb92bc93d8c3f264dc8af20cff9de5d383f469871cb. ZIP Phase 1 SHA-256: 47e7013483145cb97b93cc457bf8e04c8c36e9843ec48261bed2caf6dd80dc4d. SUBMISSION_MANIFEST.sha256 dalam ZIP mencatat source akhir; source manifest historis tetap mengacu baseline.
