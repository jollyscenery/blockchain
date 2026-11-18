import { useEffect, useRef } from "react";

const paths = {
  assets: "M12 3 3 8l9 5 9-5-9-5ZM3 8v9l9 5 9-5V8M12 13v9",
  profile: "M20 21v-2a7 7 0 0 0-14 0v2M13 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  users: "M16 21v-2a6 6 0 0 0-12 0v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM19 4a4 4 0 0 1 0 8M22 21v-2a6 6 0 0 0-4-5",
  roles: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6",
  arrow: "M7 17 17 7M7 7h10v10",
  plus: "M12 5v14M5 12h14",
  search: "M21 21l-5-5M18 10a8 8 0 1 0-16 0 8 8 0 0 0 16 0Z",
  refresh: "M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3",
  wallet: "M20 8V5H4v15h16V8H4M16 11h6v5h-6z",
  logout: "M10 4H4v16h6M9 12h12M17 8l4 4-4 4",
  check: "m5 12 4 4L19 6",
  clock: "M12 8v5l3 2M22 12a10 10 0 1 0-20 0 10 10 0 0 0 20 0Z",
  close: "m6 6 12 12M6 18 18 6",
  edit: "m16 3 5 5L9 20l-6 1 1-6L16 3Z",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
};
export function Icon({ name, size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.assets} /></svg>;
}
export function Badge({ children, tone = "neutral" }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function EmptyState({ title, children, icon = "assets", action }) {
  return <div className="empty"><span className="empty-icon"><Icon name={icon} size={28} /></span><h3>{title}</h3><p>{children}</p>{action}</div>;
}
export function Skeleton({ label = "Memuat data…" }) {
  return <div className="skeletons" role="status" aria-label={label}><span>{label}</span>{[1, 2, 3].map((i) => <div className="skeleton" key={i} />)}</div>;
}
export function Stat({ label, value, note, icon = "assets" }) {
  return <div className="stat"><div className="stat-top"><span>{label}</span><span className="stat-icon"><Icon name={icon} /></span></div><strong>{value}</strong><small>{note}</small></div>;
}
export function Dialog({ title, children, onClose, busy = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);
  return <dialog ref={ref} className="dialog" aria-labelledby="dialog-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="dialog-heading"><h2 id="dialog-title">{title}</h2><button type="button" className="icon-button" aria-label="Tutup dialog" disabled={busy} onClick={onClose}><Icon name="close" /></button></div>{children}
  </dialog>;
}
