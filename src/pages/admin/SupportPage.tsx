import { useState, useEffect } from "react";
import { adminApi } from "../../lib/adminApi";
import { PageTitle, Status, Empty, fmtDate } from "./AdminComponents";

export default function SupportPage() {
  const [error,setError]=useState("");
  const [items, setItems] = useState<any[]>([]);

  const load = () => adminApi<any>("/api/admin/support").then(d => setItems(d.tickets || [])).catch(e => setError(e.message));
  useEffect(() => { void load(); }, []);

  async function update(id: string, status: string) {
    try {
      await adminApi(`/api/admin/support/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      await load();
    } catch(e:any) {setError(e.message);}
  }

  return <>
    <PageTitle eyebrow="ATENDIMENTO" title="Suporte" text="Gerencie fila, andamento e encerramento de tickets." />
    {error&&<div role="alert" className="admin-card">{error}</div>}
    <div className="admin-support-grid">
      {items.length ? items.map(t => (
        <article className="admin-card" key={t.id}>
          <div className="admin-ticket-head">
            <Status value={t.status || "OPEN"} />
            <small>{fmtDate(t.createdAt)}</small>
          </div>
          <p>{t.message || "Sem mensagem"}</p>
          <code>{t.uid}</code>
          <div className="admin-actions">
            <button onClick={() => update(t.id, "IN_PROGRESS")}>Em andamento</button>
            <button onClick={() => update(t.id, "CLOSED")}>Encerrar</button>
          </div>
        </article>
      )) : <Empty />}
    </div>
  </>;
}
