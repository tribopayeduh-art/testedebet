import { useState, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { adminApi } from "../../lib/adminApi";
import { PageTitle, AdminError, Status, money, fmtDate } from "./AdminComponents";

export default function ResponsibleAdminPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");

  const load = () => adminApi<any>("/api/admin/responsible-gaming").then(d => setRows(d.rows || [])).catch(e => setError(e.message));
  useEffect(() => { void load(); }, []);

  return <>
    <PageTitle eyebrow="PROTEÇÃO AO JOGADOR" title="Jogo responsável" text="Acompanhe limites voluntários e períodos de autoexclusão." action={<button className="admin-primary" onClick={load}><RefreshCw size={15} /> Atualizar</button>} />
    {error && <AdminError text={error} />}
    <div className="admin-card admin-table-wrap">
      <table>
        <thead><tr><th>Jogador</th><th>Status</th><th>Autoexclusão até</th><th>Limite diário</th><th>Limite semanal</th><th>Limite mensal</th><th>Sessão</th></tr></thead>
        <tbody>
          {rows.map(x => (
            <tr key={x.uid}>
              <td><b>{x.displayName || "Jogador"}</b><small>{x.email || x.uid}</small></td>
              <td><Status value={x.status || "ACTIVE"} /></td>
              <td>{x.selfExcludedUntil ? fmtDate(x.selfExcludedUntil) : "—"}</td>
              <td>{money(x.responsibleLimits?.dailyDeposit || 0)}</td>
              <td>{money(x.responsibleLimits?.weeklyDeposit || 0)}</td>
              <td>{money(x.responsibleLimits?.monthlyDeposit || 0)}</td>
              <td>{x.responsibleLimits?.sessionMinutes ? `${x.responsibleLimits.sessionMinutes} min` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>;
}
