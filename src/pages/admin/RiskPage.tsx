import { useState, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { adminApi } from "../../lib/adminApi";
import { PageTitle, Status, money } from "./AdminComponents";

export default function RiskPage() {
  const [msg,setMsg]=useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [filter, setFilter] = useState("ALL");

  const load = () => adminApi<any>("/api/admin/risk").then(d => setRows(d.rows || [])).catch(e => setMsg(e.message));
  useEffect(() => { void load(); }, []);

  const visible = rows.filter(x => filter === "ALL" || (filter === "HIGH" ? x.score >= 50 : filter === "MEDIUM" ? x.score >= 20 && x.score < 50 : x.score < 20));

  async function action(uid: string, a: string) {
    try {
      await adminApi(`/api/admin/risk/${uid}/action`, { method: "POST", body: JSON.stringify({ action: a }) });
      await load();
    } catch(e:any) { setMsg(e.message); }
  }

  return <>
    <PageTitle eyebrow="SEGURANÇA" title="Risco & Fraude" text="Sinais operacionais baseados em status, KYC e movimentações." action={<button className="admin-primary" onClick={load}><RefreshCw size={15} /> Recalcular</button>} />
    {msg && <div role="alert" className="admin-card">{msg}</div>}
    <div className="admin-filter-row">
      {["ALL", "HIGH", "MEDIUM", "LOW"].map(x => <button key={x} className={filter === x ? "active" : ""} onClick={() => setFilter(x)}>{x}</button>)}
    </div>
    <div className="admin-card admin-table-wrap">
      <table>
        <thead><tr><th>Jogador</th><th>Score</th><th>Sinais</th><th>Depósitos</th><th>Saques</th><th>Status</th><th>Ações</th></tr></thead>
        <tbody>
          {visible.map(x => (
            <tr key={x.uid}>
              <td><b>{x.displayName || "Jogador"}</b><small>{x.email}</small></td>
              <td><span className={`risk-score r${x.score >= 50 ? "high" : x.score >= 20 ? "med" : "low"}`}>{x.score}</span></td>
              <td>{(x.flags || []).join(", ") || "—"}</td>
              <td>{x.deposits == null ? '—' : money(x.deposits)}</td>
              <td>{x.withdraws == null ? '—' : money(x.withdraws)}</td>
              <td><Status value={x.status} /></td>
              <td>
                <div className="admin-actions">
                  <button onClick={() => action(x.uid, "LOCK_WITHDRAW")}>Bloquear saque</button>
                  <button onClick={() => action(x.uid, "SUSPEND")}>Suspender</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>;
}
