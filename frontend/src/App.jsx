import { useState, useEffect, useCallback } from "react";
import { BrowserProvider, Contract, isAddress } from "ethers";
import info from "./contract.json"; // dibuat otomatis oleh scripts/deploy.js

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";
const ROLE = ["None", "Viewer", "Editor", "Manager", "Admin"];
const EMPTY = { name: "", category: "", location: "", condition: "Baik", custodian: "" };
const tag = (id) => "AST-" + String(id).padStart(4, "0");
const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);

export default function App() {
  const [session, setSession] = useState(null); // {address, role, token, signer}
  const [tab, setTab] = useState("assets");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const notify = (text, type = "ok") => setMsg({ text, type });
  const fail = (e) => notify(e?.reason || e?.shortMessage || e?.message || String(e), "err");

  const api = useCallback(async (path, opts = {}) => {
    const res = await fetch(API + path, {
      ...opts,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.token || ""}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Permintaan gagal");
    return data;
  }, [session]);

  async function login() {
    setBusy(true); setMsg(null);
    try {
      if (!window.ethereum) throw new Error("MetaMask belum terpasang.");
      const provider = new BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const net = await provider.getNetwork();
      if (Number(net.chainId) !== info.chainId)
        throw new Error(`Pindah jaringan MetaMask ke chain ID ${info.chainId}.`);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      const { message } = await (await fetch(`${API}/api/auth/nonce/${address}`)).json();
      const signature = await signer.signMessage(message); // bukti kepemilikan wallet
      const res = await fetch(`${API}/api/auth/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, signature }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSession({ address: data.address, role: data.role, token: data.token, signer });
    } catch (e) { fail(e); } finally { setBusy(false); }
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

  const { role } = session;
  const contract = new Contract(info.address, info.abi, session.signer);
  const tabs = [["assets", "Aset"], ["profile", "Profil saya"]];
  if (["Admin", "Manager", "Editor"].includes(role)) tabs.push(["users", "Data pengguna"]);
  if (role === "Admin") tabs.push(["roles", "Kelola role"]);

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">Buku Aset<small>Asset Logging dApp</small></div>
        <nav className="nav">
          {tabs.map(([k, l]) => (
            <button key={k} aria-current={tab === k} onClick={() => { setTab(k); setMsg(null); }}>{l}</button>
          ))}
        </nav>
        <div className="me"><b>{role}</b><br />{session.address}<br />
          <button className="btn ghost" style={{ marginTop: 10, color: "#e9eef2", borderColor: "#5c6b7a" }} onClick={() => setSession(null)}>Keluar</button>
        </div>
      </aside>
      <main className="main">
        {msg && <div className={`msg ${msg.type}`} role="status">{msg.text}</div>}
        {tab === "assets" && <Assets contract={contract} role={role} notify={notify} fail={fail} />}
        {tab === "profile" && <Profile api={api} notify={notify} fail={fail} />}
        {tab === "users" && <Users api={api} role={role} notify={notify} fail={fail} />}
        {tab === "roles" && <Roles contract={contract} me={session.address} notify={notify} fail={fail} />}
      </main>
    </div>
  );
}

/* ---------------- On-chain: aset ---------------- */
function Assets({ contract, role, notify, fail }) {
  const [items, setItems] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [busy, setBusy] = useState(false);
  const canWrite = ["Admin", "Manager", "Editor"].includes(role);
  const canDelete = role === "Admin" || role === "Manager";

  const load = useCallback(async () => {
    try { setItems((await contract.getAllAssets()).map((a) => ({ ...a.toObject() }))); } catch (e) { fail(e); }
  }, [contract.target]); // eslint-disable-line
  useEffect(() => { load(); }, [load]);

  async function submit(e) {
    e.preventDefault();
    if (!isAddress(form.custodian)) return notify("Alamat penanggung jawab belum valid.", "err");
    setBusy(true);
    try {
      const args = [form.name, form.category, form.location, form.condition, form.custodian];
      const tx = editId === null ? await contract.createAsset(...args) : await contract.updateAsset(editId, ...args);
      notify("Menunggu konfirmasi blockchain…");
      await tx.wait();
      notify(editId === null ? "Aset ditambahkan." : "Aset diperbarui.");
      setForm(EMPTY); setEditId(null); load();
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  async function remove(id) {
    if (!confirm(`Hapus ${tag(id)}? Aset disembunyikan, riwayatnya tetap ada di blockchain.`)) return;
    try { const tx = await contract.deleteAsset(id); await tx.wait(); notify("Aset dihapus."); load(); } catch (e) { fail(e); }
  }

  return (<>
    <h1>Aset</h1>
    <p className="sub">Setiap perubahan dicatat sebagai transaksi di blockchain.</p>
    {canWrite && (
      <form className="card" onSubmit={submit}>
        <strong>{editId === null ? "Tambah aset" : `Ubah ${tag(editId)}`}</strong>
        <label>Nama aset<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <div className="row">
          <label style={{ flex: 1 }}>Kategori<input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></label>
          <label style={{ flex: 1 }}>Lokasi<input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
        </div>
        <label>Kondisi
          <select value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })}>
            {["Baik", "Perlu perbaikan", "Rusak"].map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label>Alamat wallet penanggung jawab<input required placeholder="0x…" value={form.custodian} onChange={(e) => setForm({ ...form, custodian: e.target.value })} /></label>
        <div className="row">
          <button className="btn" disabled={busy}>{busy ? "Menyimpan…" : editId === null ? "Simpan aset" : "Simpan perubahan"}</button>
          {editId !== null && <button type="button" className="btn ghost" onClick={() => { setEditId(null); setForm(EMPTY); }}>Batal</button>}
        </div>
      </form>
    )}
    <div className="sheet">
      {items === null ? <div className="empty">Memuat dari blockchain…</div> :
        items.length === 0 ? <div className="empty">Belum ada aset.{canWrite && " Tambahkan aset pertama lewat formulir di atas."}</div> : (
        <table>
          <thead><tr><th>Tag</th><th>Nama</th><th>Kategori</th><th>Lokasi</th><th>Kondisi</th><th>Penanggung jawab</th>{canWrite && <th></th>}</tr></thead>
          <tbody>{items.map((a) => (
            <tr key={a.id.toString()}>
              <td><span className="tagid">{tag(a.id)}</span></td>
              <td>{a.name}</td><td>{a.category}</td><td>{a.location}</td><td>{a.condition}</td>
              <td className="addr">{short(a.custodian)}</td>
              {canWrite && <td><div className="acts">
                <button className="btn ghost" onClick={() => { setEditId(a.id); setForm({ name: a.name, category: a.category, location: a.location, condition: a.condition, custodian: a.custodian }); window.scrollTo(0, 0); }}>Ubah</button>
                {canDelete && <button className="btn danger" onClick={() => remove(a.id)}>Hapus</button>}
              </div></td>}
            </tr>))}
          </tbody>
        </table>)}
    </div>
  </>);
}

/* ---------------- Off-chain: profil ---------------- */
function Profile({ api, notify, fail }) {
  const [f, setF] = useState({ name: "", email: "", department: "" });
  useEffect(() => { api("/api/users/me").then((d) => setF({ name: d.name || "", email: d.email || "", department: d.department || "" })).catch(fail); }, []); // eslint-disable-line
  async function save(e) {
    e.preventDefault();
    try { await api("/api/users/me", { method: "PUT", body: JSON.stringify(f) }); notify("Profil disimpan."); } catch (err) { fail(err); }
  }
  return (<>
    <h1>Profil saya</h1>
    <p className="sub">Disimpan di database aplikasi, bukan di blockchain.</p>
    <form className="card" onSubmit={save}>
      <label>Nama<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label>Email<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
      <label>Departemen<input value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} /></label>
      <div><button className="btn">Simpan profil</button></div>
    </form>
  </>);
}

/* ---------------- Off-chain: daftar user ---------------- */
function Users({ api, role, notify, fail }) {
  const [rows, setRows] = useState(null);
  const load = useCallback(() => api("/api/users").then(setRows).catch(fail), [api]); // eslint-disable-line
  useEffect(() => { load(); }, [load]);
  async function del(a) {
    if (!confirm("Hapus data profil ini? Role di blockchain tidak berubah.")) return;
    try { await api(`/api/users/${a}`, { method: "DELETE" }); notify("Profil dihapus."); load(); } catch (e) { fail(e); }
  }
  async function edit(u) {
    const name = prompt("Nama baru:", u.name || ""); if (name === null) return;
    try { await api(`/api/users/${u.address}`, { method: "PUT", body: JSON.stringify({ ...u, name }) }); notify("Profil diperbarui."); load(); } catch (e) { fail(e); }
  }
  return (<>
    <h1>Data pengguna</h1>
    <p className="sub">Profil yang diisi pengguna di database aplikasi.</p>
    <div className="sheet">
      {rows === null ? <div className="empty">Memuat…</div> : rows.length === 0 ? <div className="empty">Belum ada pengguna yang mengisi profil.</div> : (
        <table><thead><tr><th>Wallet</th><th>Nama</th><th>Email</th><th>Departemen</th>{role === "Admin" && <th></th>}</tr></thead>
          <tbody>{rows.map((u) => (<tr key={u.address}>
            <td className="addr">{short(u.address)}</td><td>{u.name}</td><td>{u.email}</td><td>{u.department}</td>
            {role === "Admin" && <td><div className="acts">
              <button className="btn ghost" onClick={() => edit(u)}>Ubah</button>
              <button className="btn danger" onClick={() => del(u.address)}>Hapus</button></div></td>}
          </tr>))}</tbody></table>)}
    </div>
  </>);
}

/* ---------------- On-chain: role (Admin) ---------------- */
function Roles({ contract, me, notify, fail }) {
  const [list, setList] = useState(null);
  const [addr, setAddr] = useState(""); const [role, setRole] = useState("1"); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const [a, r] = await contract.getMembers(); setList(a.map((x, i) => ({ address: x, role: Number(r[i]) })).filter((m) => m.role > 0)); } catch (e) { fail(e); }
  }, [contract.target]); // eslint-disable-line
  useEffect(() => { load(); }, [load]);
  async function run(fn, okText) {
    setBusy(true);
    try { const tx = await fn(); notify("Menunggu konfirmasi blockchain…"); await tx.wait(); notify(okText); load(); } catch (e) { fail(e); } finally { setBusy(false); }
  }
  return (<>
    <h1>Kelola role</h1>
    <p className="sub">Role disimpan di smart contract dan berlaku langsung setelah transaksi dikonfirmasi.</p>
    <form className="card" onSubmit={(e) => { e.preventDefault(); if (!isAddress(addr)) return notify("Alamat wallet belum valid.", "err"); run(() => contract.setRole(addr, Number(role)), "Role disimpan."); }}>
      <label>Alamat wallet<input required placeholder="0x…" value={addr} onChange={(e) => setAddr(e.target.value)} /></label>
      <label>Role<select value={role} onChange={(e) => setRole(e.target.value)}><option value="1">Viewer</option><option value="2">Editor</option><option value="3">Manager</option><option value="4">Admin</option></select></label>
      <div><button className="btn" disabled={busy}>Simpan role</button></div>
    </form>
    <div className="sheet">
      {list === null ? <div className="empty">Memuat…</div> : (
        <table><thead><tr><th>Wallet</th><th>Role</th><th></th></tr></thead>
          <tbody>{list.map((m) => (<tr key={m.address}>
            <td className="addr">{m.address}{m.address.toLowerCase() === me.toLowerCase() && " (Anda)"}</td>
            <td>{ROLE[m.role]}</td>
            <td>{m.address.toLowerCase() !== me.toLowerCase() && <button className="btn danger" disabled={busy} onClick={() => run(() => contract.revokeRole(m.address), "Role dicabut.")}>Cabut</button>}</td>
          </tr>))}</tbody></table>)}
    </div>
  </>);
}
