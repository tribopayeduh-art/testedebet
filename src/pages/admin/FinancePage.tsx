import { useState, useEffect } from "react";
import {
  RefreshCw, TrendingUp, TrendingDown, Banknote, Clock3, Wallet, BadgeDollarSign,
  CircleDollarSign, CircleX, BadgePercent, CircleCheck, Gauge, Sliders, CheckCircle2,
  Calendar, Layers, ArrowDownUp, Zap, ShieldCheck, Search, Check, AlertTriangle
} from "lucide-react";
import { adminApi } from "../../lib/adminApi";
import { PageTitle, AdminError, Status, Empty, money, fmtDate } from "./AdminComponents";

export default function FinancePage() {
  const [rows, setRows] = useState<any[]>([]);
  const [dash, setDash] = useState<any>(null);
  const [filter, setFilter] = useState("ALL");
  const [sortBy, setSortBy] = useState<"PRIORITY" | "DATE" | "AMOUNT">("PRIORITY");
  const [period, setPeriod] = useState("30D");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  // Dynamic Queue Priority Configuration state
  const [weightAccountAge, setWeightAccountAge] = useState(2);
  const [weightDepositVolume, setWeightDepositVolume] = useState(3);
  const [queuePriorityEnabled, setQueuePriorityEnabled] = useState(true);
  const [savingWeights, setSavingWeights] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const load = async () => {
    setBusy(true); setError("");
    try {
      const [pay, analytics, qCfg]: any = await Promise.all([
        adminApi("/api/admin/payments"),
        adminApi("/api/admin/finance/dashboard"),
        adminApi("/api/admin/finance/queue-config").catch(() => null)
      ]);
      setRows(pay.payments || []);
      setDash(analytics);
      if (qCfg?.config) {
        setWeightAccountAge(Number(qCfg.config.weightAccountAge || 2));
        setWeightDepositVolume(Number(qCfg.config.weightDepositVolume || 3));
        setQueuePriorityEnabled(qCfg.config.enabled !== false);
      }
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  useEffect(() => { load(); }, []);

  async function handleSyncSystem() {
    setSyncing(true); setError(""); setSyncFeedback(null);
    try {
      const res: any = await adminApi("/api/admin/finance/sync", { method: "POST" });
      setSyncFeedback(`Sincronização concluída: ${res.checked || 0} depósitos verificados, ${res.credited || 0} creditados/reconciliados.`);
      setTimeout(() => setSyncFeedback(null), 6000);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  }

  async function saveQueueConfig() {
    setSavingWeights(true); setError(""); setSavedSuccess(false);
    try {
      await adminApi("/api/admin/finance/queue-config", {
        method: "PATCH",
        body: JSON.stringify({
          enabled: queuePriorityEnabled,
          weightAccountAge,
          weightDepositVolume
        })
      });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
      await load();
    } catch (e: any) { setError(e.message); } finally { setSavingWeights(false); }
  }

  async function change(id: string, status: string) {
    try {
      await adminApi(`/api/admin/payments/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      await load();
    } catch (e: any) { setError(e.message); }
  }

  async function reconcilePix(id: string) {
    try {
      setBusy(true);
      const res: any = await adminApi(`/api/admin/payments/${encodeURIComponent(id)}/reconcile`, { method: "POST" });
      if (res?.success || res?.status === "APPROVED") {
        setSyncFeedback(`PIX reconciliado com sucesso! Status: ${res.status}`);
      } else {
        setSyncFeedback(`Reconciliação executada. Status retornado: ${res?.status || 'PENDING'}`);
      }
      setTimeout(() => setSyncFeedback(null), 5000);
      await load();
    } catch (e: any) {
      setError(e?.message || "Erro ao reconciliar com o gateway");
    } finally {
      setBusy(false);
    }
  }

  // Filter & Dynamic Sorting & Search
  const filtered = rows.filter(p => {
    const matchesFilter = filter === "ALL" || p.type === filter || p.status === filter;
    if (!matchesFilter) return false;
    if (!search.trim()) return true;
    const term = search.toLowerCase();
    return (
      (p.playerName || "").toLowerCase().includes(term) ||
      (p.uid || "").toLowerCase().includes(term) ||
      (p.correlationID || p.correlationId || "").toLowerCase().includes(term) ||
      (p.id || "").toLowerCase().includes(term)
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "PRIORITY" && queuePriorityEnabled) {
      const scoreA = Number(a.priorityScore ?? 0);
      const scoreB = Number(b.priorityScore ?? 0);
      if (scoreB !== scoreA) return scoreB - scoreA;
    }
    if (sortBy === "AMOUNT") {
      return Number(b.amount || 0) - Number(a.amount || 0);
    }
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return timeB - timeA;
  });

  const s = dash?.summary || {};
  const dotfy = dash?.dotfy || {};
  const dotfyBal = dotfy.balance || {};

  const days = (dash?.daily || []);
  const shownDays = period === "7D" ? days.slice(-7) : period === "15D" ? days.slice(-15) : days.slice(-30);
  const maxFlow = Math.max(1, ...shownDays.flatMap((d: any) => [Number(d.deposits || 0), Number(d.withdrawals || 0)]));

  const getWeightLabel = (w: number) => {
    if (w === 1) return "1 (Mínimo)";
    if (w === 2) return "2 (Leve)";
    if (w === 3) return "3 (Moderado)";
    if (w === 4) return "4 (Alto)";
    return "5 (Máximo)";
  };

  return (
    <>
      <PageTitle
        eyebrow="FINANCEIRO"
        title="Central Financeira"
        text="Fluxo de caixa, integração Dotfy, saldos, depósitos, saques e fila com priorização dinâmica."
        action={
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              className="admin-primary"
              style={{ background: "#22c55e", borderColor: "#16a34a" }}
              disabled={syncing || busy}
              onClick={handleSyncSystem}
              title="Reconcilia cobranças PIX da Dotfy com o Firestore em tempo real"
            >
              <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
              {syncing ? "Sincronizando..." : "Sincronizar Sistema"}
            </button>
            <button className="admin-secondary" disabled={busy} onClick={load}>
              <RefreshCw size={14} /> {busy ? "Atualizando..." : "Atualizar"}
            </button>
          </div>
        }
      />

      {error && <AdminError text={error} />}

      {syncFeedback && (
        <div style={{
          background: "rgba(34, 197, 94, 0.15)",
          border: "1px solid rgba(34, 197, 94, 0.3)",
          color: "#4ade80",
          padding: "10px 14px",
          borderRadius: "8px",
          marginBottom: "16px",
          fontSize: "12px",
          display: "flex",
          alignItems: "center",
          gap: "8px"
        }}>
          <CheckCircle2 size={16} />
          <span>{syncFeedback}</span>
        </div>
      )}

      {/* Grid Principal de KPIs */}
      <div className="finance-kpi-grid">
        <FinanceKpi icon={TrendingUp} label="Depósitos pagos" value={money(s.depositPaid)} meta={`${s.paidDepositsCount || 0} transações`} tone="positive" />
        <FinanceKpi icon={TrendingDown} label="Saques pagos" value={money(s.withdrawPaid)} meta={`${s.paidWithdrawalsCount || 0} transações`} tone="negative" />
        <FinanceKpi icon={Banknote} label="Fluxo líquido" value={money(s.netCashFlow)} meta="Depósitos - saques" tone={Number(s.netCashFlow) >= 0 ? "positive" : "negative"} />
        <FinanceKpi icon={Clock3} label="Depósitos pendentes" value={money(s.depositPending)} meta="Aguardando conclusão" tone="warning" />
        <FinanceKpi icon={Wallet} label="Saques pendentes" value={money(s.withdrawPending)} meta="Fila de análise" tone="warning" />
        <FinanceKpi icon={BadgeDollarSign} label="Ticket médio depósito" value={money(s.avgDepositTicket)} meta={`${Number(s.depositApprovalRate || 0).toFixed(1)}% aprovação`} tone="neutral" />
        <FinanceKpi icon={CircleDollarSign} label="Ticket médio saque" value={money(s.avgWithdrawTicket)} meta={`${Number(s.withdrawApprovalRate || 0).toFixed(1)}% aprovação`} tone="neutral" />
        <FinanceKpi icon={CircleX} label="Custódia dos Jogadores" value={money(s.totalPlayerBalances || 0)} meta="Saldos totais em conta" tone="neutral" />
      </div>

      {/* Módulo de Saldo Gateway Dotfy */}
      <div style={{ marginBottom: "20px" }}>
        <section className="admin-card" style={{ borderLeft: "3px solid #00b85c" }}>
          <div className="finance-card-head">
            <div>
              <span>INTEGRAÇÃO PIX</span>
              <h3><ShieldCheck size={16} style={{ color: "#00b85c", verticalAlign: "middle" }} /> Saldo em Conta Dotfy</h3>
            </div>
            <span style={{ fontSize: "10px", background: "rgba(0,184,92,0.15)", color: "#36e68b", padding: "3px 8px", borderRadius: "4px", fontWeight: 700 }}>
              AO VIVO
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px", marginTop: "10px" }}>
            <div style={{ background: "#111111", padding: "12px", borderRadius: "6px" }}>
              <span style={{ fontSize: "11px", color: "#888" }}>Saldo Disponível</span>
              <strong style={{ display: "block", fontSize: "18px", color: "#22c55e", marginTop: "4px" }}>
                {dotfyBal.available !== undefined ? money(dotfyBal.available) : "Consultando..."}
              </strong>
            </div>
            <div style={{ background: "#111111", padding: "12px", borderRadius: "6px" }}>
              <span style={{ fontSize: "11px", color: "#888" }}>Saldo a Liberar</span>
              <strong style={{ display: "block", fontSize: "18px", color: "#36e68b", marginTop: "4px" }}>
                {dotfyBal.pending !== undefined ? money(dotfyBal.pending) : "Consultando..."}
              </strong>
            </div>
          </div>
        </section>
      </div>

      {/* Dynamic Queue Priority Configuration Module */}
      <section className="admin-card queue-config-card">
        <div className="queue-config-head">
          <div>
            <span>ALGORITMO DE FILA</span>
            <h3><Sliders size={16} /> Priorização Dinâmica de Fila (Score Ponderado)</h3>
            <p>Configure os pesos objetivos para ordenar o processamento operacional com base no histórico do jogador.</p>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <label className="admin-field checkbox" style={{ margin: 0, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={queuePriorityEnabled}
                onChange={e => setQueuePriorityEnabled(e.target.checked)}
              />
              <span style={{ fontSize: "9px", fontWeight: 800 }}>Priorização Ativa</span>
            </label>
            <button className="admin-primary" disabled={savingWeights} onClick={saveQueueConfig}>
              {savingWeights ? "Salvando..." : savedSuccess ? <><CheckCircle2 size={13} /> Salvo!</> : "Salvar Pesos"}
            </button>
          </div>
        </div>

        <div className="queue-weights-grid">
          <div className="queue-weight-box">
            <div className="queue-weight-box-head">
              <span><Calendar size={13} style={{ verticalAlign: "middle", marginRight: "4px" }} /> Tempo de Cadastro</span>
              <b>Peso {getWeightLabel(weightAccountAge)}</b>
            </div>
            <small>Valoriza o tempo de fidelidade do jogador desde a data de registro na plataforma.</small>
            <div className="queue-weight-slider">
              <input
                type="range"
                min={1}
                max={5}
                step={1}
                value={weightAccountAge}
                onChange={e => setWeightAccountAge(Number(e.target.value))}
              />
            </div>
            <div className="queue-weight-levels">
              <span>1 (1x)</span><span>2</span><span>3</span><span>4</span><span>5 (5x)</span>
            </div>
          </div>

          <div className="queue-weight-box">
            <div className="queue-weight-box-head">
              <span><Layers size={13} style={{ verticalAlign: "middle", marginRight: "4px" }} /> Volume de Depósitos</span>
              <b>Peso {getWeightLabel(weightDepositVolume)}</b>
            </div>
            <small>Prioriza jogadores com maior histórico de depósitos confirmados no sistema.</small>
            <div className="queue-weight-slider">
              <input
                type="range"
                min={1}
                max={5}
                step={1}
                value={weightDepositVolume}
                onChange={e => setWeightDepositVolume(Number(e.target.value))}
              />
            </div>
            <div className="queue-weight-levels">
              <span>1 (1x)</span><span>2</span><span>3</span><span>4</span><span>5 (5x)</span>
            </div>
          </div>
        </div>

        <div className="queue-config-foot">
          <div className="queue-formula-tag">
            Fórmula ativa: <code>Score = (Idade × {weightAccountAge} + Depósitos × {weightDepositVolume}) / {weightAccountAge + weightDepositVolume}</code>
          </div>
          <small style={{ color: "#777785", fontSize: "8px" }}>
            Os itens da fila recebem um score de 0 a 100 e são ordenados automaticamente.
          </small>
        </div>
      </section>

      {/* Gráficos e Status */}
      <div className="finance-dashboard-grid">
        <section className="admin-card finance-chart-card">
          <div className="finance-card-head">
            <div><span>FLUXO FINANCEIRO</span><h3>Depósitos x Saques</h3></div>
            <div className="finance-period">
              {["7D", "15D", "30D"].map(x => (
                <button className={period === x ? "active" : ""} key={x} onClick={() => setPeriod(x)}>{x}</button>
              ))}
            </div>
          </div>
          <div className="finance-chart-legend">
            <span><i className="deposit" />Depósitos</span>
            <span><i className="withdraw" />Saques</span>
          </div>
          <div className="finance-bars">
            {shownDays.length ? shownDays.map((d: any) => (
              <div className="finance-bar-day" key={d.date} title={`${d.date} • Depósitos ${money(d.deposits)} • Saques ${money(d.withdrawals)}`}>
                <div className="finance-bar-stack">
                  <i className="deposit" style={{ height: `${Math.max(3, (Number(d.deposits || 0) / maxFlow) * 100)}%` }} />
                  <i className="withdraw" style={{ height: `${Math.max(3, (Number(d.withdrawals || 0) / maxFlow) * 100)}%` }} />
                </div>
                <small>{d.date.slice(8, 10)}</small>
              </div>
            )) : <Empty text="Sem movimentações no período." />}
          </div>
        </section>

        <section className="admin-card finance-status-card">
          <div className="finance-card-head">
            <div><span>CONVERSÃO</span><h3>Taxa de aprovação</h3></div>
            <Gauge size={19} />
          </div>
          <ApprovalRing label="Depósitos" value={Number(s.depositApprovalRate || 0)} />
          <ApprovalRing label="Saques" value={Number(s.withdrawApprovalRate || 0)} />
          <div className="finance-mini-status">
            <div><span>Solicitado em depósitos</span><strong>{money(s.depositRequested)}</strong></div>
            <div><span>Solicitado em saques</span><strong>{money(s.withdrawRequested)}</strong></div>
          </div>
        </section>
      </div>

      {/* Maiores Depositantes & Status */}
      <div className="admin-two-cols finance-secondary-grid">
        <section className="admin-card admin-table-wrap">
          <h3>Maiores depositantes</h3>
          <table>
            <thead>
              <tr><th>Jogador</th><th>Depósitos</th><th>Saques</th><th>Líquido</th></tr>
            </thead>
            <tbody>
              {(dash?.topDepositors || []).map((x: any) => (
                <tr key={x.uid}>
                  <td><b>{x.displayName}</b><small>{x.email || x.uid}</small></td>
                  <td className="finance-positive">{money(x.deposits)}</td>
                  <td>{money(x.withdrawals)}</td>
                  <td className={x.net >= 0 ? "finance-positive" : "finance-negative"}>{money(x.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="admin-card">
          <h3>Status das transações</h3>
          <div className="finance-status-list">
            {(dash?.statuses || []).slice(0, 12).map((x: any) => (
              <div key={`${x.type}-${x.status}`}>
                <span><b>{x.type}</b> · {x.status}</span>
                <strong>{x.count}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Fila Operacional */}
      <div className="finance-queue-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "10px", marginTop: "24px" }}>
        <div><span>FILA OPERACIONAL</span><h3>Depósitos e saques da plataforma</h3></div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ position: "relative" }}>
            <Search size={13} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#666" }} />
            <input
              type="text"
              placeholder="Buscar jogador, ID ou correlation..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                background: "#29111c",
                border: "1px solid #411c2b",
                borderRadius: "6px",
                padding: "6px 10px 6px 30px",
                fontSize: "11px",
                color: "#fff",
                width: "220px"
              }}
            />
          </div>
          <div className="queue-sort-toolbar">
            <span><ArrowDownUp size={12} style={{ verticalAlign: "middle" }} /> Ordenar:</span>
            <button className={sortBy === "PRIORITY" ? "active" : ""} onClick={() => setSortBy("PRIORITY")}>
              <Zap size={11} style={{ verticalAlign: "middle" }} /> Score Prioridade
            </button>
            <button className={sortBy === "DATE" ? "active" : ""} onClick={() => setSortBy("DATE")}>
              Mais Recentes (FIFO)
            </button>
            <button className={sortBy === "AMOUNT" ? "active" : ""} onClick={() => setSortBy("AMOUNT")}>
              Maior Valor
            </button>
          </div>
          <div className="admin-filter-row" style={{ margin: 0 }}>
            {["ALL", "DEPOSIT", "WITHDRAW", "PENDING_REVIEW", "PROCESSING", "APPROVED", "REJECTED"].map(x => (
              <button key={x} className={filter === x ? "active" : ""} onClick={() => setFilter(x)}>{x}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="admin-card admin-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Jogador</th>
              <th>Variáveis de Prioridade</th>
              <th>Score</th>
              <th>Valor</th>
              <th>Status</th>
              <th>Data</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length ? sorted.map(p => {
              const score = Number(p.priorityScore ?? 0);
              const badgeClass = score >= 60 ? "high" : score >= 30 ? "med" : "low";
              return (
                <tr key={p.id}>
                  <td><b>{p.type}</b></td>
                  <td>
                    <b>{p.playerName || `Jogador`}</b>
                    <small><code>{String(p.uid || "").slice(0, 14)}…</code></small>
                  </td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "7.5px" }}>
                      <span style={{ color: "#aaa" }}>Cadastro: <b>{p.accountAgeDays ?? 0}</b> dias</span>
                      <span style={{ color: "#32d583" }}>Depósitos: <b>{money(p.depositVolume || 0)}</b></span>
                    </div>
                  </td>
                  <td>
                    <span className={`priority-score-badge ${badgeClass}`}>
                      <Zap size={10} /> {score.toFixed(1)}
                    </span>
                  </td>
                  <td><strong>{money(p.amount)}</strong></td>
                  <td><Status value={p.status} /></td>
                  <td>{fmtDate(p.createdAt)}</td>
                  <td>
                    <div className="admin-actions">
                      {p.type === "DEPOSIT" && p.status !== "APPROVED" && (
                        <button onClick={() => reconcilePix(p.id)} title="Reconciliar PIX diretamente com o gateway Dotfy" style={{ color: "#38bdf8", borderColor: "rgba(56, 189, 248, 0.3)" }}>
                          <RefreshCw size={12} /> Reconciliar
                        </button>
                      )}
                      <button onClick={() => change(p.id, "APPROVED")} title="Aprovar e sincronizar saldo"><CircleCheck size={12} /> Aprovar</button>
                      <button onClick={() => change(p.id, "PROCESSING")}>Processar</button>
                      <button onClick={() => change(p.id, "REJECTED")} title="Rejeitar e estornar saldo (se saque)"><CircleX size={12} /> Rejeitar</button>
                    </div>
                  </td>
                </tr>
              );
            }) : (
              <tr><td colSpan={8}><Empty text="Nenhuma solicitação na fila com os filtros selecionados." /></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function FinanceKpi({ icon: Icon, label, value, meta, tone }: { icon: any; label: string; value: string; meta: string; tone: string }) {
  return (
    <div className={`finance-kpi ${tone}`}>
      <div className="finance-kpi-icon"><Icon size={18} /></div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{meta}</small>
    </div>
  );
}

function ApprovalRing({ label, value }: { label: string; value: number }) {
  const safe = Math.max(0, Math.min(100, value));
  return (
    <div className="approval-row">
      <div className="approval-ring" style={{ background: `conic-gradient(#00b85c ${safe * 3.6}deg,#222222 0deg)` }}>
        <i>{safe.toFixed(0)}%</i>
      </div>
      <div>
        <strong>{label}</strong>
        <span>{safe.toFixed(1)}% das solicitações concluídas</span>
      </div>
    </div>
  );
}
