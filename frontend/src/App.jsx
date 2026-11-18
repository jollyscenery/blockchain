import { useState, useEffect, useCallback, useRef } from "react";
import { BrowserProvider, Contract, getAddress, isAddress, keccak256, ZeroAddress } from "ethers";
import { readAssetPage, ASSET_PAGE_SIZE, MAX_ASSET_TEXT_BYTES } from "./asset-reader.mjs";
import { Icon, Badge, Dialog, EmptyState, Skeleton, Stat } from "./ui.jsx";

const deployments = import.meta.glob("./contract.json", { eager: true, import: "default" });
const info = deployments["./contract.json"];
const networkLabel = info?.chainId === 11155111 ? "Sepolia (chain ID 11155111)" : `chain ID ${info?.chainId ?? 31337}`;
const API = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:4000";
const ROLE = ["None", "Viewer", "Editor", "Manager", "Admin"];
const EMPTY = { name: "", category: "", location: "", condition: "Baik", custodian: "" };
const canReadUsers = (role) => ROLE.indexOf(role) >= 2;
const validWallet = (address) => isAddress(address) && getAddress(address) !== ZeroAddress;
const tag = (id) => "AST-" + String(id).padStart(4, "0");
const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);
const date = (stamp) => new Date(Number(stamp) * 1000).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
const explorer = (hash) => info?.chainId === 11155111 && /^0x[0-9a-f]{64}$/i.test(hash || "") ? `https://sepolia.etherscan.io/tx/${hash}` : null;

async function request(path, options = {}, token) {
  const headers = {};
  if (options.body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(API + path, { ...options, headers });
  } catch {
    throw new Error("Backend tidak dapat diakses. Periksa konfigurasi dan jalankan server.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(data.error || `Permintaan gagal (HTTP ${response.status}).`), {
      status: response.status, code: data.code,
    });
  }
  return data;
}

export default function App() {
  const [session, setSession] = useState(null);
  const [tab, setTab] = useState("assets");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const walletVersion = useRef(0);
  const transactionLock = useRef(false);

  const notify = useCallback((text, type = "ok", hash = null) => setMsg({ text, type, hash }), []);
  const fail = useCallback((error) => {
    if (error?.name === "AbortError") return;
    const rejected = error?.code === "ACTION_REJECTED" || error?.code === 4001;
    notify(rejected ? "Permintaan ditolak di MetaMask." :
      error?.reason || error?.info?.error?.message || error?.shortMessage || error?.message || String(error), "err");
  }, [notify]);

  const resetSession = useCallback((message) => {
    walletVersion.current++;
    setSession(null);
    setTab("assets");
    setMsg(message ? { text: message, type: "err" } : null);
  }, []);

  useEffect(() => {
    const wallet = window.ethereum;
    if (!wallet?.on) return;
    const accountChanged = () => resetSession("Akun MetaMask berubah. Masuk kembali.");
    const chainChanged = () => resetSession(`Jaringan MetaMask berubah. Pilih ${networkLabel} dan masuk kembali.`);
    const disconnected = () => resetSession("Koneksi MetaMask terputus. Masuk kembali.");
    wallet.on("accountsChanged", accountChanged);
    wallet.on("chainChanged", chainChanged);
    wallet.on("disconnect", disconnected);
    return () => {
      wallet.removeListener("accountsChanged", accountChanged);
      wallet.removeListener("chainChanged", chainChanged);
      wallet.removeListener("disconnect", disconnected);
    };
  }, [resetSession]);

  useEffect(() => {
    if (!session) return;
    let active = true;
    let timer;
    async function refreshRole() {
      try {
        const role = ROLE[Number(await session.contract.getRole(session.address))];
        if (!active) return;
        if (!role || role === "None") {
          resetSession("Role dicabut. Hubungi Admin.");
          return;
        }
        if (role !== session.role) {
          setSession({ ...session, role });
          if (role !== "Admin") setTab((tab) => tab === "roles" || (tab === "users" && !canReadUsers(role)) ? "assets" : tab);
          notify(`Role wallet berubah menjadi ${role}.`);
        }
      } catch (error) {
        if (active) fail(error);
      } finally {
        if (active) timer = setTimeout(refreshRole, 3000);
      }
    }
    timer = setTimeout(refreshRole, 3000);
    return () => { active = false; clearTimeout(timer); };
  }, [session, resetSession, notify, fail]);

  const token = session?.token;
  const sessionVersion = session?.version;
  const sessionFail = useCallback((error) => {
    if (sessionVersion === walletVersion.current) fail(error);
  }, [sessionVersion, fail]);
  const api = useCallback(async (path, opts) => {
    const version = walletVersion.current;
    try {
      const data = await request(path, opts, token);
      if (version !== walletVersion.current) throw new DOMException("Sesi berubah.", "AbortError");
      return data;
    } catch (error) {
      if (version !== walletVersion.current) throw new DOMException("Sesi berubah.", "AbortError");
      if (error.status === 401 || error.code === "ROLE_REVOKED") resetSession(error.message);
      throw error;
    }
  }, [token, resetSession]);

  async function transact(send, success) {
    if (transactionLock.current) return false;
    transactionLock.current = true;
    const version = walletVersion.current;
    setPending(true);
    notify("Konfirmasi transaksi di MetaMask.");
    try {
      const [chainId, accounts] = await Promise.all([
        window.ethereum.request({ method: "eth_chainId" }),
        window.ethereum.request({ method: "eth_accounts" }),
      ]);
      if (Number(BigInt(chainId)) !== info.chainId || !accounts[0] ||
          getAddress(accounts[0]) !== session.address || version !== walletVersion.current) {
        resetSession("Akun atau jaringan berubah. Masuk kembali dengan wallet yang sesuai.");
        return false;
      }
      const tx = await send();
      let hash = tx.hash;
      if (version === walletVersion.current) notify("Menunggu konfirmasi blockchain…", "progress", hash);
      try {
        await tx.wait();
      } catch (error) {
        if (error.code !== "TRANSACTION_REPLACED" || error.cancelled || error.receipt?.status !== 1) throw error;
        hash = error.replacement?.hash || error.receipt.hash || hash;
      }
      if (version !== walletVersion.current) return false;
      notify(success, "ok", hash);
      return true;
    } catch (error) {
      if (version === walletVersion.current) fail(error);
      return false;
    } finally {
      setPending(false);
      transactionLock.current = false;
    }
  }

  async function login() {
    setBusy(true); setMsg(null);
    let version = walletVersion.current;
    try {
      if (!info) throw new Error("Deployment belum disinkronkan. Ikuti langkah Remix di README.");
      if (!window.ethereum) throw new Error("MetaMask belum terpasang.");
      const wallet = window.ethereum;
      const [account] = await wallet.request({ method: "eth_requestAccounts" });
      version = walletVersion.current;
      setMsg(null);
      const provider = new BrowserProvider(wallet, undefined, { cacheTimeout: -1 });
      const net = await provider.getNetwork();
      if (Number(net.chainId) !== info.chainId)
        throw new Error(`Pindah jaringan MetaMask ke ${networkLabel}.`);
      if (!account) throw new Error("Pilih akun di MetaMask.");
      const address = getAddress(account);
      const [code, challenge] = await Promise.all([
        provider.getCode(info.address),
        request(`/api/auth/nonce/${address}`),
      ]);
      const { deployment } = challenge;
      if (code === "0x" || keccak256(code) !== info.codeHash ||
          deployment?.address !== info.address || deployment?.chainId !== info.chainId ||
          deployment?.codeHash !== info.codeHash) {
        throw new Error("AssetRegistry di MetaMask, frontend, dan backend berbeda. Sinkronkan deployment lalu mulai ulang aplikasi.");
      }
      if (version !== walletVersion.current) return;
      const signer = await provider.getSigner(address);
      const signature = await signer.signMessage(challenge.message);
      if (version !== walletVersion.current) return;
      const data = await request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ address, signature, nonce: challenge.nonce }),
      });
      if (version !== walletVersion.current) return;
      const contract = new Contract(info.address, info.abi, signer);
      setSession({ address, role: data.role, token: data.token, contract, version });
    } catch (error) {
      if (version === walletVersion.current) fail(error);
    } finally {
      setBusy(false);
    }
  }

  async function switchNetwork() {
    try {
      if (!window.ethereum) throw new Error("MetaMask belum terpasang.");
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x" + info.chainId.toString(16) }] });
      notify("Jaringan dipilih. Silakan masuk dengan MetaMask.");
    } catch (error) { fail(error); }
  }

  if (!session) {
    return (
      <div className="login">
        <section className="login-story"><div className="brand"><span className="brand-mark"><Icon name="assets" size={25} /></span><div>Buku Aset<small>ASSET MANAGEMENT</small></div></div>
          <div className="story-content"><span className="eyebrow">TRANSPARAN. TERLACAK. TERKELOLA.</span><h1>Setiap aset,<br />punya cerita<br /><span>yang tercatat.</span></h1><p>Kelola inventaris dengan catatan blockchain yang dapat diverifikasi. Satu tempat untuk aset dan tanggung jawab tim Anda.</p>
            <div className="story-feature"><Icon name="roles" /><span>Empat role. Akses sesuai tanggung jawab.</span></div><div className="story-feature"><Icon name="clock" /><span>Riwayat perubahan tersimpan di Ethereum.</span></div></div>
          <small className="story-footer">BINUS University · Blockchain Fundamental</small>
        </section>
        <section className="login-main"><div className="box"><Badge tone="green"><span className="status-dot" />{info?.chainId === 11155111 ? "Ethereum Sepolia" : "Hardhat Local"}</Badge><h2>Selamat datang.</h2><p className="sub">Hubungkan wallet untuk mengakses ruang kerja aset Anda.</p>
          <div className="wallet-tile"><span className="wallet-symbol"><Icon name="wallet" size={27} /></span><div><strong>Masuk dengan wallet</strong><small>Tanda tangan pesan, tanpa biaya gas.</small></div></div>
          {msg && <div className={`msg ${msg.type}`} role="alert">{msg.text}</div>}
          <button className="btn login-action" onClick={login} disabled={busy}><Icon name="wallet" />{busy ? "Menunggu MetaMask…" : "Masuk dengan MetaMask"}<Icon name="arrow" size={18} /></button>
          <button className="text-button network-switch" onClick={switchNetwork} disabled={busy}>Pilih {info?.chainId === 11155111 ? "Sepolia" : "Hardhat Local"} di MetaMask</button>
          <p className="login-note"><Icon name="roles" size={17} />Wallet harus memiliki role dari Admin. Gunakan alamat publik untuk meminta akses.</p>
          <div className="deployment-note"><span>SMART CONTRACT</span><code>{info?.address}</code><small>Chain ID {info?.chainId} · Private key tetap di wallet Anda</small></div>
        </div><small className="login-copyright">Buku Aset / Phase 1</small></section>
      </div>
    );
  }

  const { role, contract } = session;
  const tabs = [["assets", "Aset"], ["profile", "Profil saya"]];
  if (canReadUsers(role)) tabs.push(["users", "Data pengguna"]);
  if (role === "Admin") tabs.push(["roles", "Kelola role"]);

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><span className="brand-mark"><Icon name="assets" size={24} /></span><div>Buku Aset<small>ASSET MANAGEMENT</small></div></div>
        <div className="nav-label">RUANG KERJA</div>
        <nav className="nav" aria-label="Navigasi utama">
          {tabs.map(([k, l]) => (
            <button key={k} disabled={pending} aria-current={tab === k ? "page" : undefined} onClick={() => { setTab(k); setMsg(null); }}><Icon name={k} />{l}{tab === k && <span className="nav-dot" />}</button>
          ))}
        </nav>
        <div className="sidebar-note"><Icon name="roles" /><strong>Catatan yang bisa dipercaya</strong><p>Perubahan aset diverifikasi melalui transaksi blockchain.</p></div>
        <div className="me"><span className="avatar">{role.slice(0, 1)}</span><div><strong>{role}</strong><code title={session.address}>{short(session.address)}</code></div><button className="icon-button" aria-label="Keluar" onClick={() => resetSession()}><Icon name="logout" size={18} /></button></div>
      </aside>
      <div className="workspace"><header className="topbar"><div className="breadcrumb">Ruang kerja <span>/</span> <strong>{tabs.find(([k]) => k === tab)?.[1]}</strong></div><div className="connection"><Badge tone="green"><span className="status-dot" />{info.chainId === 11155111 ? "Sepolia" : "Hardhat Local"}</Badge><Badge tone="blue">{role}</Badge><span className="wallet-address" title={session.address}><Icon name="wallet" size={16} />{short(session.address)}</span></div></header>
        <main className="main" key={session.address + ":" + session.version}>
          {tab === "assets" && <Assets contract={contract} role={role} pending={pending} transact={transact} notify={notify} fail={sessionFail} />}
          {tab === "profile" && <Profile api={api} notify={notify} fail={sessionFail} />}
          {tab === "users" && canReadUsers(role) && <Users api={api} me={session.address} role={role} notify={notify} fail={sessionFail} />}
          {tab === "roles" && role === "Admin" && <Roles contract={contract} me={session.address} pending={pending} transact={transact} notify={notify} fail={sessionFail} />}
        </main><footer className="workspace-footer">Buku Aset <span>On-chain assets. Off-chain profiles.</span></footer>
      </div>
      {msg && <div className={`toast ${msg.type}`} role={msg.type === "err" ? "alert" : "status"}><span className="toast-icon"><Icon name={pending ? "clock" : msg.type === "err" ? "close" : "check"} /></span><div>{msg.text}{explorer(msg.hash) && <a href={explorer(msg.hash)} target="_blank" rel="noopener noreferrer">Lihat transaksi di Etherscan <Icon name="arrow" size={13} /></a>}</div><button className="icon-button" aria-label="Tutup notifikasi" onClick={() => setMsg(null)}><Icon name="close" size={17} /></button></div>}
    </div>
  );
}


/* ---------------- On-chain: bounded legacy reads ---------------- */
function Assets({ contract, role, pending, transact, notify, fail }) {
  const [page, setPage] = useState(null);
  const [cursor, setCursor] = useState(0n);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [form, setForm] = useState(null);
  const [editId, setEditId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [query, setQuery] = useState("");
  const [condition, setCondition] = useState("");
  const canWrite = ["Admin", "Manager", "Editor"].includes(role);
  const canDelete = role === "Admin" || role === "Manager";
  const refresh = () => setReload((value) => value + 1);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoadFailed(false);
    readAssetPage(contract, cursor, ASSET_PAGE_SIZE, controller.signal).then((data) => {
      if (!controller.signal.aborted) setPage(data);
    }).catch((error) => {
      if (!controller.signal.aborted) { setLoadFailed(true); fail(error); }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [contract, cursor, reload, fail]);
  const items = page?.items || [];
  const filtered = items.filter((asset) => [asset.name, asset.category, asset.location, asset.custodian, tag(asset.id)].some((v) => v.toLowerCase().includes(query.toLowerCase())) && (!condition || asset.condition === condition));
  async function submit(event) {
    event.preventDefault();
    const fields = [form.name, form.category, form.location, form.condition].map((value) => value.trim());
    if (fields.some((value) => !value)) return notify("Lengkapi nama, kategori, lokasi, dan kondisi.", "err");
    if (fields.some((value) => new TextEncoder().encode(value).length > MAX_ASSET_TEXT_BYTES)) return notify("Setiap field aset maksimal 256 byte UTF-8. Persingkat teks Anda.", "err");
    const custodian = form.custodian.trim();
    if (!validWallet(custodian)) return notify("Alamat penanggung jawab belum valid.", "err");
    const created = editId === null;
    if (await transact(() => created ? contract.createAsset(...fields, custodian) : contract.updateAsset(editId, ...fields, custodian), created ? "Aset ditambahkan." : "Aset diperbarui.")) {
      setForm(null); refresh();
    }
  }
  async function remove() {
    if (await transact(() => contract.deleteAsset(deleting.id), "Aset dihapus.")) { setDeleting(null); refresh(); }
  }
  const conditions = [...new Set(["Baik", "Perlu perbaikan", "Rusak", ...(form ? [form.condition] : [])])];
  return <>
    <div className="page-heading"><div><span className="eyebrow">INVENTARIS ON-CHAIN</span><h1>Ikhtisar aset</h1><p className="sub">Aset tertata. Setiap perubahan punya jejak.</p></div>{canWrite && <button className="btn" disabled={pending} onClick={() => { setEditId(null); setForm({ ...EMPTY }); }}><Icon name="plus" size={18} />Tambah aset</button>}</div>
    <div className="stats"><Stat label="Aset aktif" value={page ? items.length : "—"} note="Dalam rentang halaman ini" /><Stat label="Total ID riwayat" value={page ? page.total.toString() : "—"} note="Termasuk aset yang dihapus" icon="clock" /><Stat label="Perlu perhatian" value={page ? items.filter((a) => a.condition !== "Baik").length : "—"} note="Kondisi selain Baik di halaman ini" icon="roles" /></div>
    <section className="panel"><div className="panel-heading"><div><h2>Daftar aset</h2><p>Data langsung dari {info.chainId === 11155111 ? "Ethereum Sepolia" : "Hardhat Local"}.</p></div><button className="btn ghost" disabled={pending || loading} onClick={refresh}><Icon name="refresh" size={16} />Muat ulang aset</button></div>
      <div className="table-toolbar"><label className="search"><Icon name="search" size={18} /><input aria-label="Cari aset di halaman ini" placeholder="Cari nama, tag, atau lokasi…" value={query} onChange={(e) => setQuery(e.target.value)} /></label><select aria-label="Filter kondisi" value={condition} onChange={(e) => setCondition(e.target.value)}><option value="">Semua kondisi</option>{conditions.map((c) => <option key={c}>{c}</option>)}</select></div>
      <div className="sheet">
        {loading ? <Skeleton label="Memuat aset dari blockchain…" /> : loadFailed ? <EmptyState title="Data belum dapat dimuat" action={<button className="btn ghost" onClick={refresh}>Coba lagi</button>}>Periksa jaringan dan koneksi RPC Anda.</EmptyState> : filtered.length === 0 ? <EmptyState title={items.length ? "Tidak ada hasil yang cocok" : "Belum ada aset aktif di rentang ini"}>{items.length ? "Ubah pencarian atau filter kondisi." : "Rentang berikutnya mungkin memuat aset lain. Aset yang dihapus tetap memiliki riwayat."}</EmptyState> : <table className="assets-table">
          <thead><tr><th scope="col">Aset</th><th scope="col">Kategori</th><th scope="col">Lokasi</th><th scope="col">Kondisi</th><th scope="col">Penanggung jawab</th><th scope="col">Aksi</th></tr></thead><tbody>{filtered.map((asset) => <tr key={asset.id.toString()}>
            <td><div className="asset-cell"><span className="asset-symbol"><Icon name="assets" size={19} /></span><div><button className="asset-name" onClick={() => setDetail(asset)}>{asset.name}</button><small>{tag(asset.id)}</small></div></div></td><td data-label="Kategori"><span className="category">{asset.category}</span></td><td data-label="Lokasi">{asset.location}</td><td data-label="Kondisi"><Badge tone={asset.condition === "Baik" ? "green" : asset.condition === "Rusak" ? "red" : "amber"}>{asset.condition}</Badge></td><td data-label="Penanggung jawab" className="addr" title={asset.custodian}>{short(asset.custodian)}</td>
            <td><div className="acts"><button className="text-button" onClick={() => setDetail(asset)}>Detail</button>{canWrite && <button className="icon-button" aria-label={`Ubah ${tag(asset.id)}`} disabled={pending} onClick={() => { setEditId(asset.id); setForm({ name: asset.name, category: asset.category, location: asset.location, condition: asset.condition, custodian: asset.custodian }); }}><Icon name="edit" size={17} /></button>}{canDelete && <button className="icon-button danger-text" aria-label={`Hapus ${tag(asset.id)}`} disabled={pending} onClick={() => setDeleting(asset)}><Icon name="trash" size={17} /></button>}</div></td>
          </tr>)}</tbody></table>}
      </div>
      <div className="pagination"><span>{page && page.total > 0n ? `ID ${cursor}–${page.end > cursor ? page.end - 1n : cursor} dari ${page.total} ID riwayat` : "Belum ada riwayat aset"}<small>Pencarian dan statistik berlaku pada halaman ini.</small></span><div className="acts"><button className="btn ghost" disabled={loading || pending || cursor === 0n} onClick={() => setCursor(cursor - BigInt(ASSET_PAGE_SIZE))}>Sebelumnya</button><button className="btn ghost" disabled={loading || pending || !page || page.end >= page.total} onClick={() => setCursor(cursor + BigInt(ASSET_PAGE_SIZE))}>Berikutnya</button></div></div>
    </section>
    <p className="integrity-note"><Icon name="roles" size={16} />Catatan blockchain dapat diverifikasi. Penghapusan aset bersifat soft delete.</p>
    {form && canWrite && <Dialog title={editId === null ? "Tambah aset" : `Ubah ${tag(editId)}`} onClose={() => setForm(null)} busy={pending}><p className="sub">Perubahan memerlukan konfirmasi transaksi di MetaMask.</p><form onSubmit={submit} className="form-grid"><fieldset disabled={pending}>
      <label>Nama aset<input required autoFocus maxLength={256} placeholder="Contoh: MacBook Pro 14 inci" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><div className="field-row"><label>Kategori<input required maxLength={256} placeholder="Contoh: Perangkat IT" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></label><label>Lokasi<input required maxLength={256} placeholder="Contoh: Ruang 301" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label></div>
      <label>Kondisi<select aria-label="Kondisi" value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })}>{conditions.map((c) => <option key={c}>{c}</option>)}</select></label><label>Alamat wallet penanggung jawab<input required spellCheck="false" placeholder="0x…" value={form.custodian} onChange={(e) => setForm({ ...form, custodian: e.target.value })} /></label><small className="field-hint">Maksimal 256 byte per field teks. Alamat harus valid dan bukan zero address.</small>
      <div className="dialog-actions"><button type="button" className="btn ghost" onClick={() => setForm(null)}>Batal</button><button className="btn">{pending ? "Menunggu transaksi…" : editId === null ? "Simpan aset" : "Simpan perubahan"}</button></div>
    </fieldset></form></Dialog>}
    {detail && <Dialog title={tag(detail.id)} onClose={() => setDetail(null)}><h3 className="detail-title">{detail.name}</h3><dl className="details">{[["Kategori", detail.category], ["Lokasi", detail.location], ["Kondisi", detail.condition], ["Penanggung jawab", detail.custodian], ["Dibuat oleh", detail.createdBy], ["Dibuat pada", date(detail.createdAt)], ["Diperbarui pada", date(detail.updatedAt)]].map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></Dialog>}
    {deleting && canDelete && <Dialog title="Hapus aset?" busy={pending} onClose={() => setDeleting(null)}><p>{tag(deleting.id)} — {deleting.name} akan disembunyikan dari daftar aktif. Riwayat tetap ada di blockchain.</p><div className="dialog-actions"><button className="btn ghost" disabled={pending} onClick={() => setDeleting(null)}>Batal</button><button className="btn danger" disabled={pending} onClick={remove}>Konfirmasi hapus</button></div></Dialog>}
  </>;
}

/* ---------------- Off-chain: profiles ---------------- */
const profileFields = ({ name, email, department } = {}) => ({ name: name || "", email: email || "", department: department || "" });
function ProfileFields({ values, change, disabled }) {
  return <fieldset disabled={disabled}><label>Nama lengkap<input required maxLength={120} value={values.name} onChange={(e) => change({ ...values, name: e.target.value })} /></label><label>Email<input required maxLength={254} type="email" value={values.email} onChange={(e) => change({ ...values, email: e.target.value })} /></label><label>Departemen<input required maxLength={120} value={values.department} onChange={(e) => change({ ...values, department: e.target.value })} /></label></fieldset>;
}
function Profile({ api, notify, fail }) {
  const [values, setValues] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const load = useCallback(async () => {
    setLoadFailed(false);
    try { setValues(profileFields(await api("/api/users/me"))); } catch (error) { setLoadFailed(true); fail(error); }
  }, [api, fail]);
  useEffect(() => { load(); }, [load]);
  async function save(event) {
    event.preventDefault(); setBusy(true);
    try { setValues(profileFields(await api("/api/users/me", { method: "PUT", body: JSON.stringify(values) }))); notify("Profil disimpan."); }
    catch (error) { fail(error); } finally { setBusy(false); }
  }
  return <><div className="page-heading"><div><span className="eyebrow">AKUN ANDA</span><h1>Profil saya</h1><p className="sub">Informasi pribadi untuk melengkapi ruang kerja Anda.</p></div><Badge tone="blue">Off-chain · SQLite</Badge></div><div className="profile-layout"><section className="panel"><div className="panel-heading"><div><h2>Informasi profil</h2><p>Perubahan profil tidak memerlukan transaksi blockchain.</p></div></div>{loadFailed ? <EmptyState title="Profil gagal dimuat" action={<button className="btn ghost" onClick={load}>Muat ulang profil</button>} /> : values === null ? <Skeleton /> : <form className="profile-form" onSubmit={save}><ProfileFields values={values} change={setValues} disabled={busy} /><div className="form-footer"><small>Disimpan di database aplikasi.</small><button className="btn" disabled={busy}>{busy ? "Menyimpan…" : "Simpan profil"}</button></div></form>}</section><aside className="info-card"><Icon name="roles" size={25} /><h3>Wallet adalah identitas Anda</h3><p>Alamat wallet terikat pada sesi login. Mengubah profil tidak mengubah role atau kepemilikan wallet.</p><p>Data profil tersimpan pada volume SQLite dan tetap tersedia setelah container dimulai ulang.</p></aside></div></>;
}
function Users({ api, me, role, notify, fail }) {
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const load = useCallback(async () => {
    setLoadFailed(false);
    try { setRows(await api("/api/users")); } catch (error) { setLoadFailed(true); fail(error); }
  }, [api, fail]);
  useEffect(() => { load(); }, [load]);
  async function remove() {
    setBusy(true);
    try { await api(`/api/users/${deleting.address}`, { method: "DELETE" }); setDeleting(null); notify("Profil dihapus."); await load(); }
    catch (error) { fail(error); } finally { setBusy(false); }
  }
  async function save(event) {
    event.preventDefault(); setBusy(true);
    try { await api(`/api/users/${editing.address}`, { method: "PUT", body: JSON.stringify(editing.values) }); setEditing(null); notify("Profil diperbarui."); await load(); }
    catch (error) { fail(error); } finally { setBusy(false); }
  }
  const filtered = (rows || []).filter((u) => [u.address, u.name, u.email, u.department].some((v) => (v || "").toLowerCase().includes(query.toLowerCase())));
  return <><div className="page-heading"><div><span className="eyebrow">DIREKTORI TIM</span><h1>Data pengguna</h1><p className="sub">Profil yang dibagikan pengguna di aplikasi.</p></div><Badge>{rows?.length ?? "—"} profil</Badge></div><section className="panel"><div className="table-toolbar"><label className="search"><Icon name="search" size={18} /><input placeholder="Cari pengguna…" aria-label="Cari pengguna" value={query} onChange={(e) => setQuery(e.target.value)} /></label></div><div className="sheet">{loadFailed ? <EmptyState title="Data gagal dimuat" action={<button className="btn ghost" onClick={load}>Muat ulang data pengguna</button>} /> : rows === null ? <Skeleton /> : !filtered.length ? <EmptyState title="Belum ada profil yang cocok" icon="users">Profil akan muncul setelah pengguna menyimpannya.</EmptyState> : <table><thead><tr><th>Pengguna</th><th>Email</th><th>Departemen</th><th>Wallet</th>{role === "Admin" && <th>Aksi</th>}</tr></thead><tbody>{filtered.map((user) => <tr key={user.address}><td><strong>{user.name}</strong></td><td>{user.email}</td><td>{user.department}</td><td className="addr" title={user.address}>{short(user.address)}</td>{role === "Admin" && <td>{me.toLowerCase() !== user.address.toLowerCase() && <div className="acts"><button className="icon-button" aria-label={`Ubah profil ${user.name}`} disabled={busy} onClick={() => setEditing({ address: user.address, values: profileFields(user) })}><Icon name="edit" size={17} /></button><button className="icon-button danger-text" aria-label={`Hapus profil ${user.name}`} disabled={busy} onClick={() => setDeleting(user)}><Icon name="trash" size={17} /></button></div>}</td>}</tr>)}</tbody></table>}</div></section>
    {role === "Admin" && editing && <Dialog title="Ubah profil pengguna" busy={busy} onClose={() => setEditing(null)}><p className="addr">{editing.address}</p><form className="form-grid" onSubmit={save}><ProfileFields values={editing.values} disabled={busy} change={(values) => setEditing({ ...editing, values })} /><div className="dialog-actions"><button className="btn ghost" type="button" disabled={busy} onClick={() => setEditing(null)}>Batal</button><button className="btn" disabled={busy}>Simpan perubahan profil</button></div></form></Dialog>}
    {role === "Admin" && deleting && <Dialog title="Hapus profil pengguna?" busy={busy} onClose={() => setDeleting(null)}><p>Profil {deleting.name} di SQLite akan dihapus. Role di blockchain tidak berubah.</p><div className="dialog-actions"><button className="btn ghost" disabled={busy} onClick={() => setDeleting(null)}>Batal</button><button className="btn danger" disabled={busy} onClick={remove}>Konfirmasi hapus profil</button></div></Dialog>}
  </>;
}

/* ---------------- On-chain: Admin roles ---------------- */
function Roles({ contract, me, pending, transact, notify, fail }) {
  const [list, setList] = useState(null);
  const [addr, setAddr] = useState("");
  const [role, setRole] = useState("1");
  const [revoking, setRevoking] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const load = useCallback(async () => {
    setLoadFailed(false);
    try { const [addresses, roles] = await contract.getMembers(); setList(addresses.map((address, i) => ({ address, role: Number(roles[i]) })).filter((member) => member.role > 0)); }
    catch (error) { setLoadFailed(true); fail(error); }
  }, [contract, fail]);
  useEffect(() => { load(); }, [load]);
  async function assign(event) {
    event.preventDefault(); const address = addr.trim();
    if (!validWallet(address)) return notify("Alamat wallet belum valid.", "err");
    if (await transact(() => contract.setRole(address, Number(role)), "Role disimpan.")) { setAddr(""); await load(); }
  }
  async function revoke() {
    if (await transact(() => contract.revokeRole(revoking), "Role dicabut.")) { setRevoking(null); await load(); }
  }
  return <><div className="page-heading"><div><span className="eyebrow">KONTROL AKSES</span><h1>Kelola role</h1><p className="sub">Tetapkan tanggung jawab dan akses tim melalui smart contract.</p></div><Badge tone="blue">Khusus Admin</Badge></div><div className="governance-note"><Icon name="roles" size={19} /><p>Semua Admin memiliki kewenangan setara, termasuk mencabut Admin lain. Admin tidak dapat mencabut atau menurunkan role sendiri.</p></div><section className="panel role-form-panel"><div className="panel-heading"><div><h2>Tetapkan role</h2><p>Gunakan alamat publik wallet. Private key tidak diperlukan.</p></div></div><form className="role-form" onSubmit={assign}><fieldset disabled={pending}><label>Alamat wallet<input required spellCheck="false" placeholder="0x…" value={addr} onChange={(e) => setAddr(e.target.value)} /></label><label>Role<select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)}>{ROLE.slice(1).map((r, i) => <option key={r} value={i + 1}>{r}</option>)}</select></label><button className="btn">Simpan role</button></fieldset></form></section><section className="panel"><div className="panel-heading"><div><h2>Wallet berizin</h2><p>Role berlaku setelah transaksi dikonfirmasi.</p></div><button className="btn ghost" disabled={pending} onClick={load}><Icon name="refresh" size={16} />Muat ulang role</button></div><div className="sheet">{loadFailed ? <EmptyState title="Daftar role gagal dimuat">Periksa RPC. Daftar anggota legacy belum mendukung pagination.</EmptyState> : list === null ? <Skeleton /> : <table><thead><tr><th>Wallet</th><th>Role</th><th>Aksi</th></tr></thead><tbody>{list.map((member) => <tr key={member.address}><td className="addr">{member.address}{member.address.toLowerCase() === me.toLowerCase() && <span className="you-label">Anda</span>}</td><td><Badge tone={member.role === 4 ? "blue" : "neutral"}>{ROLE[member.role]}</Badge></td><td>{member.address.toLowerCase() !== me.toLowerCase() && <button className="btn danger subtle" disabled={pending} onClick={() => setRevoking(member.address)}>Cabut</button>}</td></tr>)}</tbody></table>}</div></section>
    {revoking && <Dialog title="Cabut akses wallet?" busy={pending} onClose={() => setRevoking(null)}><p className="addr">{revoking}</p><p>Wallet ini menjadi None dan kehilangan akses aplikasi setelah transaksi dikonfirmasi.</p><div className="dialog-actions"><button className="btn ghost" disabled={pending} onClick={() => setRevoking(null)}>Batal</button><button className="btn danger" disabled={pending} onClick={revoke}>Konfirmasi cabut role</button></div></Dialog>}
  </>;
}
