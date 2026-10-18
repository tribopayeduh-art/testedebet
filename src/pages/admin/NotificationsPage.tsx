import { useState, useEffect } from "react";
import { supabaseEnabled } from "../../lib/supabase";
import { adminApi } from "../../lib/adminApi";
import { PageTitle, Status, fmtDate } from "./AdminComponents";

export default function NotificationsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ title: "", body: "", audience: "ALL", channel: "IN_APP", status: "DRAFT" });
  const [message, setMessage] = useState("");

  const load = () => adminApi<any>("/api/admin/notifications").then(d => setItems(d.notifications || [])).catch(e => setMessage(e?.message || ""));
  useEffect(() => { void load(); }, []);

  async function create() {
    try {
      await adminApi("/api/admin/notifications", { method: "POST", body: JSON.stringify(form) });
      setForm({ ...form, title: "", body: "" });
      await load();
    } catch (e: any) { setMessage(e?.message || ""); }
  }

  async function publish(id: string) {
    setMessage("Publicando...");
    try {
      const d: any = await adminApi(`/api/admin/notifications/${id}/publish`, { method: "POST" });
      setMessage(`Campanha publicada para ${d.delivered} usuários.`);
      await load();
    } catch (e: any) { setMessage(e.message); }
  }

  return <>
    <PageTitle eyebrow="CRM" title="Notificações" text="Crie campanhas internas e publique para os usuários." />
    <div className="admin-two-cols unequal">
      <div className="admin-card admin-form-card">
        <h3>Nova mensagem</h3>
        <label className="admin-field"><span>Título</span><input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
        <label className="admin-field"><span>Mensagem</span><textarea value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} /></label>
        <div className="admin-form-grid">
          <label className="admin-field"><span>Público</span><select value={form.audience} onChange={e => setForm({ ...form, audience: e.target.value })}><option>ALL</option><option>ACTIVE</option><option>DEPOSITORS</option><option>VIP</option></select></label>
          <label className="admin-field"><span>Canal</span><select value={form.channel} onChange={e => setForm({ ...form, channel: e.target.value })}><option>IN_APP</option>{!supabaseEnabled && <><option>PUSH</option><option>EMAIL</option></>}</select></label>
        </div>
        <button className="admin-primary full" onClick={create}>Salvar campanha</button>
        {message && <div className="admin-message">{message}</div>}
      </div>
      <div className="admin-card admin-table-wrap">
        <table>
          <thead><tr><th>Título</th><th>Público</th><th>Canal</th><th>Status</th><th>Data</th><th></th></tr></thead>
          <tbody>
            {items.map(x => <tr key={x.id}>
              <td><b>{x.title}</b><small>{x.body}</small></td>
              <td>{x.audience}</td>
              <td>{x.channel}</td>
              <td><Status value={x.status} /></td>
              <td>{fmtDate(x.createdAt)}</td>
              <td><button className="admin-secondary" disabled={x.status === "PUBLISHED"} onClick={() => publish(x.id)}>{x.status === "PUBLISHED" ? "Publicado" : "Publicar"}</button></td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </div>
  </>;
}
