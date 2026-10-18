import { useState, useEffect } from "react";
import { adminApi } from "../../lib/adminApi";
import { PageTitle, fmtDate } from "./AdminComponents";

export default function AuditPage() {
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    adminApi<any>("/api/admin/audit")
      .then(d => setItems(d.logs || []))
      .catch(() => {});
  }, []);

  return <>
    <PageTitle eyebrow="SEGURANÇA" title="Auditoria" text="Registro de ações administrativas críticas." />
    <div className="admin-card admin-table-wrap">
      <table>
        <thead><tr><th>Ação</th><th>Administrador</th><th>Detalhes</th><th>Data</th></tr></thead>
        <tbody>
          {items.map(x => (
            <tr key={x.id}>
              <td><b>{x.action}</b></td>
              <td><code>{String(x.actorUid || "").slice(0, 14)}…</code></td>
              <td><code className="metadata">{JSON.stringify(x.metadata || {})}</code></td>
              <td>{fmtDate(x.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>;
}
