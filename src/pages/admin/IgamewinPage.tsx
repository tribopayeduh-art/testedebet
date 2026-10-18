import { useState, useEffect } from "react";
import {
  RefreshCw, Server, CircleDollarSign, Database, Activity, ListChecks, ShieldCheck
} from "lucide-react";
import { adminApi } from "../../lib/adminApi";
import { PageTitle, Metric } from "./AdminComponents";

export default function IgamewinPage() {
  const [status, setStatus] = useState<any>(null);
  const [logs, setLogs] = useState<any>(null);
  const [message, setMessage] = useState("");

  const load = () => adminApi<any>("/api/admin/igamewin/status").then(setStatus).catch(e => setMessage(e.message));
  useEffect(() => { void load(); }, []);

  async function refresh() {
    setMessage("Sincronizando...");
    try {
      const d: any = await adminApi("/api/admin/igamewin/refresh-catalog", { method: "POST" });
      setMessage(`${d.providers} providers sincronizados.`);
      load();
    } catch (e: any) { setMessage(e.message); }
  }

  async function gameLogs() {
    try {
      setLogs(await adminApi("/api/admin/igamewin/game-logs?limit=50"));
    } catch (e: any) { setMessage(e.message); }
  }

  return <>
    <PageTitle eyebrow="PROVEDOR" title="iGameWin" text="Status do agente, catálogo, logs e ferramentas operacionais." action={<button className="admin-primary" onClick={load}><RefreshCw size={15} /> Testar conexão</button>} />
    <div className="admin-metrics">
      <Metric icon={Server} label="Conexão" value={status?.connected ? "ONLINE" : "—"} hint={status?.agentCode || "Agent"} />
      <Metric icon={CircleDollarSign} label="Saldo do agente" value={status?.balance ?? "—"} hint="money_info" />
      <Metric icon={Database} label="Providers" value={status?.providers ?? "—"} hint="provider_list" />
      <Metric icon={Activity} label="Wallet sync" value={status?.syncWallet ? "ATIVA" : "DESATIVADA"} hint="Configuração" />
    </div>
    <div className="admin-action-cards">
      <button onClick={refresh}><RefreshCw /><span><b>Atualizar catálogo</b><small>Recarrega providers e jogos.</small></span></button>
      <button onClick={gameLogs}><ListChecks /><span><b>Consultar logs</b><small>Executa get_game_log.</small></span></button>
    </div>
    {message && <div className="admin-message">{message}</div>}
    {logs && <pre className="admin-json">{JSON.stringify(logs, null, 2)}</pre>}
    <div className="admin-card admin-note">
      <ShieldCheck />
      <div>
        <b>Controles de RTP</b>
        <p>Não expus controles de RTP individual por jogador no painel. Essa configuração pode ter implicações regulatórias e deve ser tratada apenas em configuração autorizada do provedor.</p>
      </div>
    </div>
  </>;
}
