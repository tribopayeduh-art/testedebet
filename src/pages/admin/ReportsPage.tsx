import { useState, useEffect } from "react";
import { RefreshCw, Users, BadgeDollarSign, Wallet, BarChart3, Network } from "lucide-react";
import { adminApi } from "../../lib/adminApi";
import { PageTitle, Metric, money } from "./AdminComponents";

export default function ReportsPage() {
  const [error,setError]=useState("");
  const [data, setData] = useState<any>(null);

  const load = () => adminApi<any>("/api/admin/reports").then(setData).catch(e => setError(e.message));
  useEffect(() => { void load(); }, []);

  const t = data?.totals || {};

  return <>
    <PageTitle eyebrow="BI" title="Relatórios" text="Resumo operacional dos últimos registros disponíveis." action={<button className="admin-primary" onClick={load}><RefreshCw size={15} /> Atualizar</button>} />
    {error && <div role="alert" className="admin-card">{error}</div>}
    <div className="admin-metrics">
      <Metric icon={Users} label="Cadastros" value={t.registrations ?? 0} hint={`${t.users ?? 0} usuários total`} />
      <Metric icon={BadgeDollarSign} label="Depósitos" value={money(t.deposits)} hint="Período" />
      <Metric icon={Wallet} label="Saques" value={money(t.withdraws)} hint="Período" />
      <Metric icon={BarChart3} label="GGR" value={money(t.ggr)} hint="Apostas - prêmios" />
      <Metric icon={Network} label="Afiliados" value={t.affiliates ?? 0} hint="Cadastrados" />
    </div>
    <div className="admin-card admin-table-wrap">
      <h3>Últimos 30 dias</h3>
      <table>
        <thead><tr><th>Data</th><th>Cadastros</th><th>Depósitos</th><th>Saques</th><th>Apostas</th><th>Prêmios</th><th>GGR</th></tr></thead>
        <tbody>
          {(data?.daily || []).map((x: any) => (
            <tr key={x.date}>
              <td>{x.date}</td>
              <td>{x.registrations}</td>
              <td>{money(x.deposits)}</td>
              <td>{money(x.withdraws)}</td>
              <td>{money(x.bets)}</td>
              <td>{money(x.wins)}</td>
              <td>{money(x.bets - x.wins)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>;
}
