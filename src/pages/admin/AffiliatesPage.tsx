import { useState, useEffect, useMemo } from "react";
import {
  Network, Search, Plus, Copy, Check, ExternalLink, RefreshCw, DollarSign,
  TrendingUp, Users, MousePointerClick, UserPlus, Wallet, Sparkles, CheckCircle2
} from "lucide-react";
import { adminApi } from "../../lib/adminApi";
import { PageTitle, Status, AdminError, money, fmtDate } from "./AdminComponents";

export default function AffiliatesPage() {
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState<any>({
    uid: "",
    code: "",
    commissionPercent: 20,
    model: "DEPOSIT",
    status: "ACTIVE"
  });
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true); setMsg("");
    try {
      const d: any = await adminApi("/api/admin/affiliates");
      setItems(d.affiliates || []);
    } catch (e: any) {
      setMsg(e?.message || "");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  async function create() {
    if (!form.uid.trim() || !form.code.trim()) {
      setMsg("Informe o UID do usuário e o Código de afiliado.");
      return;
    }
    setCreating(true); setMsg("");
    try {
      await adminApi("/api/admin/affiliates", { method: "POST", body: JSON.stringify(form) });
      setForm({ uid: "", code: "", commissionPercent: 20, model: "DEPOSIT", status: "ACTIVE" });
      setMsg("Afiliado / Parceiro cadastrado com sucesso!");
      await load();
    } catch (e: any) {
      setMsg(e?.message || "");
    } finally {
      setCreating(false);
    }
  }

  function handleCopyLink(code: string) {
    const origin = typeof window !== "undefined" ? window.location.origin : "https://borah.bet";
    const refLink = `${origin}/?ref=${encodeURIComponent(code)}`;
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(refLink);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2500);
    }
  }

  function generateRandomCode() {
    const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
    setForm((prev: any) => ({ ...prev, code: `VIP_${rand}` }));
  }

  // Summary Metrics
  const summary = useMemo(() => {
    let clicks = 0;
    let regs = 0;
    let depositors = 0;
    let totalComm = 0;
    for (const item of items) {
      clicks += Number(item.clicks || 0);
      regs += Number(item.registrations || 0);
      depositors += Number(item.depositors || 0);
      totalComm += Number(item.commissionBalance || 0);
    }
    return {
      total: items.length,
      clicks,
      regs,
      depositors,
      totalComm,
      conversionRate: regs > 0 ? ((depositors / regs) * 100).toFixed(1) : "0.0"
    };
  }, [items]);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const term = search.toLowerCase();
    return items.filter(x =>
      String(x.code || "").toLowerCase().includes(term) ||
      String(x.uid || "").toLowerCase().includes(term) ||
      String(x.email || "").toLowerCase().includes(term) ||
      String(x.displayName || "").toLowerCase().includes(term) ||
      String(x.model || "").toLowerCase().includes(term)
    );
  }, [items, search]);

  return (
    <>
      <PageTitle
        eyebrow="AQUISIÇÃO & PARCERIAS"
        title="Afiliados & Influenciadores"
        text="Gestão de links de divulgação com rastreamento automático, comissão por depósito (% de cada recarga PIX), conversões e saldos."
        action={
          <button className="admin-secondary" disabled={loading} onClick={load}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            {loading ? "Atualizando..." : "Atualizar"}
          </button>
        }
      />

      {msg && (
        <div style={{
          background: msg.toLowerCase().includes("erro") ? "rgba(244, 63, 94, 0.15)" : "rgba(34, 197, 94, 0.15)",
          border: `1px solid ${msg.toLowerCase().includes("erro") ? "rgba(244, 63, 94, 0.3)" : "rgba(34, 197, 94, 0.3)"}`,
          color: msg.toLowerCase().includes("erro") ? "#fda4af" : "#4ade80",
          padding: "10px 14px",
          borderRadius: "8px",
          marginBottom: "16px",
          fontSize: "12px",
          display: "flex",
          alignItems: "center",
          gap: "8px"
        }}>
          <CheckCircle2 size={16} />
          <span>{msg}</span>
        </div>
      )}

      {/* Grid de Métricas de Aquisição */}
      <div className="users-kpi-grid">
        <div className="user-kpi-card red">
          <div className="kpi-head">
            <span style={{ color: "#36e68b" }}>Afiliados Ativos</span>
            <Network size={16} style={{ color: "#36e68b" }} />
          </div>
          <strong style={{ color: "#36e68b" }}>{summary.total}</strong>
          <small>Parceiros e Influenciadores</small>
        </div>

        <div className="user-kpi-card cyan">
          <div className="kpi-head">
            <span>Cliques Totais</span>
            <MousePointerClick size={16} style={{ color: "#38bdf8" }} />
          </div>
          <strong style={{ color: "#38bdf8" }}>{summary.clicks.toLocaleString()}</strong>
          <small>Tráfego gerado por links</small>
        </div>

        <div className="user-kpi-card emerald">
          <div className="kpi-head">
            <span>Depositantes (FTD)</span>
            <UserPlus size={16} style={{ color: "#34d399" }} />
          </div>
          <strong style={{ color: "#34d399" }}>{summary.depositors}</strong>
          <small>{summary.regs} cadastros ({summary.conversionRate}% conversão)</small>
        </div>

        <div className="user-kpi-card rose">
          <div className="kpi-head">
            <span>Comissões Acumuladas</span>
            <Wallet size={16} style={{ color: "#fb7185" }} />
          </div>
          <strong style={{ color: "#fb7185" }}>{money(summary.totalComm)}</strong>
          <small>Saldos de comissão a pagar</small>
        </div>
      </div>

      {/* Banner de Afiliados 100% Automáticos */}
      <div style={{
        background: "rgba(16, 185, 129, 0.08)",
        border: "1px solid rgba(16, 185, 129, 0.25)",
        borderRadius: "8px",
        padding: "12px 16px",
        marginBottom: "16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{
            width: "32px",
            height: "32px",
            borderRadius: "50%",
            background: "rgba(16, 185, 129, 0.2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#34d399",
            flexShrink: 0
          }}>
            <CheckCircle2 size={18} />
          </div>
          <div>
            <b style={{ color: "#34d399", fontSize: "13px", display: "block" }}>
              Sistema de Afiliados 100% Automático e Ativado
            </b>
            <span style={{ color: "#cbd5e1", fontSize: "11px" }}>
              Todas as contas cadastradas já possuem link e código de afiliados ativados nativamente. Nenhum jogador precisa ativar link nem código para começar a indicar.
            </span>
          </div>
        </div>
      </div>

      <div className="admin-two-cols unequal">
        {/* Formulário de Personalização de Afiliado */}
        <div className="admin-card admin-form-card" style={{ borderLeft: "3px solid #00b85c" }}>
          <div className="flex items-center justify-between gap-2 mb-3">
            <div>
              <span style={{ fontSize: "8px", color: "#00b85c", fontWeight: 800, textTransform: "uppercase" }}>CONFIGURAÇÃO VIP</span>
              <h3 style={{ margin: "2px 0 0", fontSize: "14px", color: "#fff" }}>Personalizar Parceria / VIP</h3>
              <p style={{ margin: "2px 0 0", fontSize: "10px", color: "#94a3b8" }}>
                Ajuste taxas especiais ou crie códigos personalizados para influenciadores.
              </p>
            </div>
            <Sparkles size={16} style={{ color: "#00b85c" }} />
          </div>

          <label className="admin-field">
            <span>UID do Usuário na Plataforma</span>
            <input
              value={form.uid}
              onChange={e => setForm({ ...form, uid: e.target.value })}
              placeholder="Ex.: cF1vPZt..."
            />
          </label>

          <label className="admin-field">
            <span>Código Personalizado (Link Ref)</span>
            <div style={{ display: "flex", gap: "6px" }}>
              <input
                value={form.code}
                onChange={e => setForm({ ...form, code: e.target.value.toUpperCase().replace(/\s+/g, "_") })}
                placeholder="Ex.: INFLUENCER_LIVES"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="admin-secondary"
                onClick={generateRandomCode}
                style={{ padding: "0 10px", fontSize: "10px" }}
              >
                Gerar
              </button>
            </div>
          </label>

          <div className="admin-form-grid">
            <label className="admin-field">
              <span>Modelo de Parceria</span>
              <select value={form.model} onChange={e => setForm({ ...form, model: e.target.value })}>
                <option value="DEPOSIT">Comissão por Depósito (% do Depósito)</option>
                <option value="CPA">CPA Fixo (Por 1º Depósito FTD)</option>
                <option value="HYBRID">Híbrido (% Depósito + CPA)</option>
              </select>
            </label>

            <label className="admin-field">
              <span>Comissão %</span>
              <input
                type="number"
                min={0}
                max={100}
                value={form.commissionPercent}
                onChange={e => setForm({ ...form, commissionPercent: Number(e.target.value) })}
              />
            </label>
          </div>

          <button
            className="admin-primary full mt-2"
            style={{ background: "#00b85c", color: "#fff", fontWeight: 800 }}
            onClick={create}
            disabled={creating}
          >
            {creating ? "Salvando..." : "Salvar Parceria Personalizada"}
          </button>
        </div>

        {/* Tabela de Afiliados */}
        <div className="admin-card admin-table-wrap">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h3 style={{ margin: 0, fontSize: "13px" }}>Afiliados Cadastrados ({filtered.length})</h3>
              <span style={{ fontSize: "10px", color: "#10b981", fontWeight: 600 }}>Todos os links 100% ativos</span>
            </div>
            <div style={{ position: "relative", width: "200px" }}>
              <Search size={13} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#666" }} />
              <input
                type="text"
                placeholder="Buscar código ou UID..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{
                  background: "#29111c",
                  border: "1px solid #411c2b",
                  borderRadius: "6px",
                  padding: "5px 10px 5px 28px",
                  fontSize: "11px",
                  color: "#fff",
                  width: "100%"
                }}
              />
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Código / Link</th>
                <th>Jogador / Email</th>
                <th>Modelo</th>
                <th>Comissão</th>
                <th>Cliques</th>
                <th>Cadastros</th>
                <th>Depositantes</th>
                <th>Saldo Comissão</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: "30px", color: "#888" }}>
                    Nenhum afiliado encontrado.
                  </td>
                </tr>
              ) : (
                filtered.map(x => {
                  const isCopied = copiedCode === x.code;
                  return (
                    <tr key={x.id}>
                      <td>
                        <div className="flex items-center gap-2">
                          <b style={{ color: "#36e68b" }}>{x.code}</b>
                          <button
                            onClick={() => handleCopyLink(x.code)}
                            title="Copiar Link de Afiliado"
                            style={{
                              background: "rgba(0,184,92, 0.15)",
                              border: "1px solid rgba(0,184,92, 0.3)",
                              color: isCopied ? "#34d399" : "#36e68b",
                              borderRadius: "5px",
                              padding: "2px 6px",
                              fontSize: "9px",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "3px",
                              cursor: "pointer"
                            }}
                          >
                            {isCopied ? <Check size={10} /> : <Copy size={10} />}
                            {isCopied ? "Copiado!" : "Copiar Link"}
                          </button>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                          <b style={{ color: "#fff", fontSize: "11px" }}>{x.displayName || x.email || "Jogador"}</b>
                          {x.email && <span style={{ color: "#888", fontSize: "10px" }}>{x.email}</span>}
                          <code>{String(x.uid || "").slice(0, 10)}…</code>
                        </div>
                      </td>
                      <td>
                        <span style={{
                          fontSize: "9px",
                          fontWeight: 700,
                          padding: "2px 6px",
                          borderRadius: "4px",
                          background: x.model === "CPA" ? "rgba(168, 85, 247, 0.15)" : "rgba(34, 197, 94, 0.15)",
                          color: x.model === "CPA" ? "#c084fc" : "#4ade80",
                          border: `1px solid ${x.model === "CPA" ? "rgba(168, 85, 247, 0.3)" : "rgba(34, 197, 94, 0.3)"}`,
                        }}>
                          {x.model === "CPA" ? "CPA (FTD)" : "Depósito (%)"}
                        </span>
                      </td>
                      <td>
                        <strong style={{ color: "#fff" }}>{x.commissionPercent}%</strong>
                      </td>
                      <td>{x.clicks || 0}</td>
                      <td>
                        <span style={{ color: "#a855f7", fontWeight: 700 }}>
                          {x.registrations || 0}
                        </span>
                      </td>
                      <td>
                        <span style={{ color: "#34d399", fontWeight: 700 }}>
                          {x.depositors || 0}
                        </span>
                      </td>
                      <td>
                        <strong style={{ color: "#4ade80" }}>{money(x.commissionBalance || 0)}</strong>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
