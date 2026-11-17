import { useState, useEffect, useCallback, useRef } from "react";
import { BrowserProvider, Contract, getAddress, isAddress, keccak256, ZeroAddress } from "ethers";

const deployments = import.meta.glob("./contract.json", { eager: true, import: "default" });
const info = deployments["./contract.json"];
const networkLabel = info?.chainId === 11155111 ? "Sepolia (chain ID 11155111)" : `chain ID ${info?.chainId ?? 31337}`;
const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:4000";
const ROLE = ["None", "Viewer", "Editor", "Manager", "Admin"];
const EMPTY = { name: "", category: "", location: "", condition: "Baik", custodian: "" };
const canReadUsers = (role) => ROLE.indexOf(role) >= 2;
const validWallet = (address) => isAddress(address) && getAddress(address) !== ZeroAddress;
const tag = (id) => "AST-" + String(id).padStart(4, "0");
const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);

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

  const notify = useCallback((text, type = "ok") => setMsg({ text, type }), []);
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
    if (pending) return false;
    const version = walletVersion.current;
    setPending(true);
    notify("Konfirmasi transaksi di MetaMask.");
    try {
      const tx = await send();
      if (version === walletVersion.current) notify("Menunggu konfirmasi blockchain…");
      try {
        await tx.wait();
      } catch (error) {
        if (error.code !== "TRANSACTION_REPLACED" || error.cancelled || error.receipt?.status !== 1) throw error;
      }
      if (version !== walletVersion.current) return false;
      notify(success);
      return true;
    } catch (error) {
      if (version === walletVersion.current) fail(error);
      return false;
    } finally {
      setPending(false);
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
        body: JSON.stringify({ address, signature }),
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

  if (!session) {
    return (
      <div className="login"><div className="box">
        <h1>Buku Aset</h1>
        <p className="sub">Catatan aset kantor yang tersimpan di blockchain dan tidak bisa diubah diam-diam.</p>
        {msg && <div className={`msg ${msg.type}`} role="alert">{msg.text}</div>}
        <button className="btn" onClick={login} disabled={busy}>{busy ? "Menunggu MetaMask…" : "Masuk dengan MetaMask"}</button>
      </div></div>
    );
  }

  const { role, contract } = session;
  const tabs = [["assets", "Aset"], ["profile", "Profil saya"]];
  if (canReadUsers(role)) tabs.push(["users", "Data pengguna"]);
  if (role === "Admin") tabs.push(["roles", "Kelola role"]);

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">Buku Aset<small>Asset Logging dApp</small></div>
        <nav className="nav">
          {tabs.map(([k, l]) => (
            <button key={k} disabled={pending} aria-current={tab === k} onClick={() => { setTab(k); setMsg(null); }}>{l}</button>
          ))}
        </nav>
        <div className="me"><b>{role}</b><br />{session.address}<br />
          <button className="btn ghost" style={{ marginTop: 10, color: "#e9eef2", borderColor: "#5c6b7a" }} onClick={() => resetSession()}>Keluar</button>
        </div>
      </aside>
      <main className="main">
        {msg && <div className={`msg ${msg.type}`} role="status">{msg.text}</div>}
        {tab === "assets" && <Assets contract={contract} role={role} pending={pending} transact={transact} notify={notify} fail={sessionFail} />}
        {tab === "profile" && <Profile api={api} notify={notify} fail={sessionFail} />}
        {tab === "users" && canReadUsers(role) && <Users api={api} me={session.address} role={role} notify={notify} fail={sessionFail} />}
        {tab === "roles" && role === "Admin" && <Roles contract={contract} me={session.address} pending={pending} transact={transact} notify={notify} fail={sessionFail} />}
      </main>
    </div>
  );
}

/* ---------------- On-chain: aset ---------------- */
function Assets({ contract, role, pending, transact, notify, fail }) {
  const [items, setItems] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const canWrite = ["Admin", "Manager", "Editor"].includes(role);
  const canDelete = role === "Admin" || role === "Manager";

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      setItems((await contract.getAllAssets()).map((a) => a.toObject()));
    } catch (error) {
      setLoadFailed(true);
      fail(error);
    }
  }, [contract, fail]);
  useEffect(() => { load(); }, [load]);

  function resetForm() {
    setForm(EMPTY);
    setEditId(null);
  }

  async function submit(e) {
    e.preventDefault();
    const fields = [form.name, form.category, form.location, form.condition].map((value) => value.trim());
    if (fields.some((value) => !value)) return notify("Lengkapi nama, kategori, lokasi, dan kondisi.", "err");
    const custodian = form.custodian.trim();
    if (!validWallet(custodian)) return notify("Alamat penanggung jawab belum valid.", "err");
    const args = [...fields, custodian];
    const created = editId === null;
    const saved = await transact(
      () => created ? contract.createAsset(...args) : contract.updateAsset(editId, ...args),
      created ? "Aset ditambahkan." : "Aset diperbarui.",
    );
    if (saved) { resetForm(); await load(); }
  }

  async function remove(id) {
    if (!confirm(`Hapus ${tag(id)}? Aset disembunyikan, riwayatnya tetap ada di blockchain.`)) return;
    if (await transact(() => contract.deleteAsset(id), "Aset dihapus.")) {
      if (id === editId) resetForm();
      await load();
    }
  }

  const conditions = ["Baik", "Perlu perbaikan", "Rusak"];
  if (!conditions.includes(form.condition)) conditions.push(form.condition);
  return (<>
    <h1>Aset</h1>
    <p className="sub">Setiap perubahan dicatat sebagai transaksi di blockchain.</p>
    {canWrite && (
      <form className="card" onSubmit={submit}>
        <strong>{editId === null ? "Tambah aset" : `Ubah ${tag(editId)}`}</strong>
        <label>Nama aset<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <div className="row">
          <label style={{ flex: 1 }}>Kategori<input required value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></label>
          <label style={{ flex: 1 }}>Lokasi<input required value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
        </div>
        <label>Kondisi
          <select aria-label="Kondisi" value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })}>
            {conditions.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label>Alamat wallet penanggung jawab<input required placeholder="0x…" value={form.custodian} onChange={(e) => setForm({ ...form, custodian: e.target.value })} /></label>
        <div className="row">
          <button className="btn" disabled={pending}>{editId === null ? "Simpan aset" : "Simpan perubahan"}</button>
          {editId !== null && <button type="button" className="btn ghost" disabled={pending} onClick={resetForm}>Batal</button>}
        </div>
      </form>
    )}
    <div className="bar"><button className="btn ghost" disabled={pending} onClick={load}>Muat ulang aset</button></div>
    <div className="sheet">
      {loadFailed ? <div className="empty">Daftar aset gagal dimuat.</div> :
        items === null ? <div className="empty">Memuat dari blockchain…</div> :
        items.length === 0 ? <div className="empty">Belum ada aset.{canWrite && " Tambahkan aset pertama lewat formulir di atas."}</div> : (
        <table>
          <thead><tr><th>Tag</th><th>Nama</th><th>Kategori</th><th>Lokasi</th><th>Kondisi</th><th>Penanggung jawab</th>{canWrite && <th></th>}</tr></thead>
          <tbody>{items.map((a) => (
            <tr key={a.id.toString()}>
              <td><span className="tagid">{tag(a.id)}</span></td>
              <td>{a.name}</td><td>{a.category}</td><td>{a.location}</td><td>{a.condition}</td>
              <td className="addr" title={a.custodian}>{short(a.custodian)}</td>
              {canWrite && <td><div className="acts">
                <button className="btn ghost" disabled={pending} onClick={() => { setEditId(a.id); setForm({ name: a.name, category: a.category, location: a.location, condition: a.condition, custodian: a.custodian }); window.scrollTo(0, 0); }}>Ubah</button>
                {canDelete && <button className="btn danger" disabled={pending} onClick={() => remove(a.id)}>Hapus</button>}
              </div></td>}
            </tr>))}
          </tbody>
        </table>)}
    </div>
  </>);
}

/* ---------------- Off-chain: profil ---------------- */
const profileFields = ({ name, email, department } = {}) => ({
  name: name || "", email: email || "", department: department || "",
});

function ProfileFields({ values, change, disabled }) {
  return (<>
    <label>Nama<input required maxLength={120} disabled={disabled} value={values.name} onChange={(e) => change({ ...values, name: e.target.value })} /></label>
    <label>Email<input required maxLength={254} disabled={disabled} type="email" value={values.email} onChange={(e) => change({ ...values, email: e.target.value })} /></label>
    <label>Departemen<input required maxLength={120} disabled={disabled} value={values.department} onChange={(e) => change({ ...values, department: e.target.value })} /></label>
  </>);
}

function Profile({ api, notify, fail }) {
  const [values, setValues] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const load = useCallback(async () => {
    setLoadFailed(false);
    try { setValues(profileFields(await api("/api/users/me"))); }
    catch (error) { setLoadFailed(true); fail(error); }
  }, [api, fail]);
  useEffect(() => { load(); }, [load]);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const saved = await api("/api/users/me", { method: "PUT", body: JSON.stringify(values) });
      setValues(profileFields(saved));
      notify("Profil disimpan.");
    } catch (error) { fail(error); }
    finally { setBusy(false); }
  }
  return (<>
    <h1>Profil saya</h1>
    <p className="sub">Profil disimpan di database SQLite aplikasi.</p>
    {loadFailed ? <button className="btn ghost" onClick={load}>Muat ulang profil</button> :
      values === null ? <div className="empty">Memuat profil…</div> :
      <form className="card" onSubmit={save}>
        <ProfileFields values={values} change={setValues} disabled={busy} />
        <div><button className="btn" disabled={busy}>Simpan profil</button></div>
      </form>}
  </>);
}

/* ---------------- Off-chain: daftar user ---------------- */
function Users({ api, me, role, notify, fail }) {
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const load = useCallback(async () => {
    setLoadFailed(false);
    try { setRows(await api("/api/users")); }
    catch (error) { setLoadFailed(true); fail(error); }
  }, [api, fail]);
  useEffect(() => { load(); }, [load]);

  async function del(a) {
    if (!confirm("Hapus data profil ini? Role di blockchain tidak berubah.")) return;
    setBusy(true);
    try {
      await api(`/api/users/${a}`, { method: "DELETE" });
      if (editing?.address === a) setEditing(null);
      notify("Profil dihapus.");
      await load();
    } catch (error) { fail(error); }
    finally { setBusy(false); }
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/users/${editing.address}`, { method: "PUT", body: JSON.stringify(editing.values) });
      setEditing(null);
      notify("Profil diperbarui.");
      await load();
    } catch (error) { fail(error); }
    finally { setBusy(false); }
  }
  return (<>
    <h1>Data pengguna</h1>
    <p className="sub">Profil yang diisi pengguna di database aplikasi.</p>
    {role === "Admin" && editing && <form className="card" onSubmit={save}>
      <strong>Ubah profil {short(editing.address)}</strong>
      <ProfileFields values={editing.values} disabled={busy} change={(values) => setEditing({ ...editing, values })} />
      <div className="row">
        <button className="btn" disabled={busy}>Simpan perubahan profil</button>
        <button className="btn ghost" type="button" disabled={busy} onClick={() => setEditing(null)}>Batal</button>
      </div>
    </form>}
    <div className="sheet">
      {loadFailed ? <div className="empty"><button className="btn ghost" onClick={load}>Muat ulang data pengguna</button></div> :
        rows === null ? <div className="empty">Memuat…</div> : rows.length === 0 ? <div className="empty">Belum ada pengguna yang mengisi profil.</div> : (
        <table><thead><tr><th>Wallet</th><th>Nama</th><th>Email</th><th>Departemen</th>{role === "Admin" && <th></th>}</tr></thead>
          <tbody>{rows.map((u) => (<tr key={u.address}>
            <td className="addr" title={u.address}>{short(u.address)}</td><td>{u.name}</td><td>{u.email}</td><td>{u.department}</td>
            {role === "Admin" && <td>{me !== u.address && <div className="acts">
              <button className="btn ghost" disabled={busy} onClick={() => setEditing({ address: u.address, values: profileFields(u) })}>Ubah</button>
              <button className="btn danger" disabled={busy} onClick={() => del(u.address)}>Hapus</button></div>}</td>}
          </tr>))}</tbody></table>)}
    </div>
  </>);
}

/* ---------------- On-chain: role (Admin) ---------------- */
function Roles({ contract, me, pending, transact, notify, fail }) {
  const [list, setList] = useState(null);
  const [addr, setAddr] = useState("");
  const [role, setRole] = useState("1");
  const [loadFailed, setLoadFailed] = useState(false);
  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const [addresses, roles] = await contract.getMembers();
      setList(addresses.map((address, i) => ({ address, role: Number(roles[i]) })).filter((member) => member.role > 0));
    } catch (error) { setLoadFailed(true); fail(error); }
  }, [contract, fail]);
  useEffect(() => { load(); }, [load]);

  async function assign(e) {
    e.preventDefault();
    const address = addr.trim();
    if (!validWallet(address)) return notify("Alamat wallet belum valid.", "err");
    if (await transact(() => contract.setRole(address, Number(role)), "Role disimpan.")) {
      setAddr("");
      await load();
    }
  }

  async function revoke(address) {
    if (await transact(() => contract.revokeRole(address), "Role dicabut.")) await load();
  }
  return (<>
    <h1>Kelola role</h1>
    <p className="sub">Role disimpan di smart contract dan berlaku langsung setelah transaksi dikonfirmasi.</p>
    <form className="card" onSubmit={assign}>
      <label>Alamat wallet<input required placeholder="0x…" value={addr} onChange={(e) => setAddr(e.target.value)} /></label>
      <label>Role<select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)}><option value="1">Viewer</option><option value="2">Editor</option><option value="3">Manager</option><option value="4">Admin</option></select></label>
      <div><button className="btn" disabled={pending}>Simpan role</button></div>
    </form>
    <div className="sheet">
      {loadFailed ? <div className="empty"><button className="btn ghost" onClick={load}>Muat ulang role</button></div> :
        list === null ? <div className="empty">Memuat…</div> : (
        <table><thead><tr><th>Wallet</th><th>Role</th><th></th></tr></thead>
          <tbody>{list.map((m) => (<tr key={m.address}>
            <td className="addr">{m.address}{m.address.toLowerCase() === me.toLowerCase() && " (Anda)"}</td>
            <td>{ROLE[m.role]}</td>
            <td>{m.address.toLowerCase() !== me.toLowerCase() && <button className="btn danger" disabled={pending} onClick={() => revoke(m.address)}>Cabut</button>}</td>
          </tr>))}</tbody></table>)}
    </div>
  </>);
}
