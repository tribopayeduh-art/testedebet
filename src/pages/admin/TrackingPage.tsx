import { useState, useEffect, useMemo } from "react";
import {
  Megaphone, CheckCircle2, AlertCircle, Copy, Check, Users, DollarSign,
  TrendingUp, Activity, ExternalLink, RefreshCw, Sparkles, Filter, Search,
  ShieldCheck, ArrowUpRight
} from "lucide-react";
import { adminApi } from "../../lib/adminApi";
import { PageTitle, money, fmtDate } from "./AdminComponents";
import { DEFAULT_META_PIXEL_ID } from "../../lib/metaTracking";

export default function TrackingPage() {
  const [form, setForm] = useState<any>({
    enabled: true,
    metaPixelId: DEFAULT_META_PIXEL_ID,
    metaAccessToken: "",
    tiktokPixelId: "",
    tiktokAccessToken: "",
    googleAdsId: "",
    googleConversions: { SignUp: "", Deposit: "", Purchase: "" }
  });
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [analytics, setAnalytics] = useState<any>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState("");
  const [testEventsLog, setTestEventsLog] = useState<{ time: string; event: string; status: string; data?: any }[]>([]);

  // Carregar dados de configuração e analíticos da Meta
  const loadData = async () => {
    try {
      setLoadingAnalytics(true);
      const [cfg, metaData] = await Promise.all([
        adminApi<any>("/api/admin/integrations/tracking").catch(() => ({ config: {} })),
        adminApi<any>("/api/admin/tracking/meta-analytics").catch(() => null),
      ]);

      setForm((prev: any) => ({
        ...prev,
        ...cfg.config,
        metaPixelId: cfg.config?.metaPixelId || DEFAULT_META_PIXEL_ID,
        googleConversions: { ...prev.googleConversions, ...(cfg.config?.googleConversions || {}) },
      }));

      if (metaData && metaData.success) {
        setAnalytics(metaData);
      }
    } catch (e: any) {
      setMsg(e.message || "Erro ao carregar configurações de tracking.");
    } finally {
      setLoadingAnalytics(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const set = (k: string, v: any) => setForm((x: any) => ({ ...x, [k]: v }));
  const conv = (k: string, v: string) => setForm((x: any) => ({ ...x, googleConversions: { ...(x.googleConversions || {}), [k]: v } }));

  async function save() {
    setSaving(true);
    setMsg("");
    try {
      await adminApi("/api/admin/integrations/tracking", { method: "PATCH", body: JSON.stringify(form) });
      setMsg("Configuração de tracking salva com sucesso!");
      setTimeout(() => setMsg(""), 4000);
    } catch (e: any) {
      setMsg(e.message || "Erro ao salvar integrações.");
    } finally {
      setSaving(false);
    }
  }

  const handleCopy = (text: string, id: string) => {
    if (!text) return;
    navigator.clipboard?.writeText(text);
    setCopiedText(id);
    setTimeout(() => setCopiedText(null), 2000);
  };

  // Disparar teste de evento no navegador do admin
  const triggerTestEvent = (eventName: "PageView" | "CompleteRegistration" | "InitiateCheckout" | "Purchase") => {
    const time = new Date().toLocaleTimeString("pt-BR");
    try {
      if (typeof window !== "undefined" && window.fbq) {
        if (eventName === "Purchase") {
          window.fbq("track", "Purchase", {
            value: 50.0,
            currency: "BRL",
            content_name: "Teste de Venda (Depósito Trevo da Sorte)",
            content_type: "product",
          });
        } else if (eventName === "InitiateCheckout") {
          window.fbq("track", "InitiateCheckout", {
            value: 50.0,
            currency: "BRL",
            content_name: "Teste de Depósito PIX",
          });
        } else if (eventName === "CompleteRegistration") {
          window.fbq("track", "CompleteRegistration", {
            content_name: "Teste de Cadastro de Jogador",
            status: true,
          });
        } else {
          window.fbq("track", "PageView");
        }
        setTestEventsLog(prev => [{ time, event: eventName, status: "DISPARADO COM SUCESSO NO PIXEL", data: { pixelId: form.metaPixelId } }, ...prev.slice(0, 9)]);
      } else {
        setTestEventsLog(prev => [{ time, event: eventName, status: "AVISO: window.fbq não inicializado nesta tela", data: {} }, ...prev.slice(0, 9)]);
      }
    } catch (err: any) {
      setTestEventsLog(prev => [{ time, event: eventName, status: `ERRO: ${err.message}`, data: {} }, ...prev.slice(0, 9)]);
    }
  };

  // Filtragem de cadastros de Meta Ads
  const filteredMetaUsers = useMemo(() => {
    if (!analytics?.metaUsers) return [];
    if (!searchFilter.trim()) return analytics.metaUsers;
    const q = searchFilter.toLowerCase().trim();
    return analytics.metaUsers.filter((u: any) =>
      String(u.displayName || "").toLowerCase().includes(q) ||
      String(u.email || "").toLowerCase().includes(q) ||
      String(u.campaign || "").toLowerCase().includes(q) ||
      String(u.fbclid || "").toLowerCase().includes(q) ||
      String(u.phone || "").includes(q)
    );
  }, [analytics?.metaUsers, searchFilter]);

  const totalUsers = analytics?.totalMetaUsers || 0;
  const totalDepositors = analytics?.totalMetaDepositors || 0;
  const totalSales = analytics?.totalMetaSalesVolume || 0;
  const convRate = analytics?.conversionRate || (totalUsers > 0 ? ((totalDepositors / totalUsers) * 100).toFixed(1) : 0);
  const avgTicket = totalDepositors > 0 ? (totalSales / totalDepositors) : 0;

  return (
    <>
      <PageTitle
        eyebrow="GROWTH & PERFORMANCE ADS"
        title="Meta Pixel & Rastreamento de Anúncios"
        text="Acompanhe em tempo real cadastros e vendas (depósitos) originados de campanhas da Meta (Facebook & Instagram Ads)."
        action={
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <button className="admin-secondary" onClick={loadData} disabled={loadingAnalytics}>
              <RefreshCw size={13} className={loadingAnalytics ? "animate-spin" : ""} />
              <span>Atualizar Métricas</span>
            </button>
            <button className="admin-primary" onClick={save} disabled={saving}>
              {saving ? "Salvando..." : "Salvar Configurações"}
            </button>
          </div>
        }
      />

      {msg && (
        <div className={`p-3.5 mb-4 rounded-xl text-xs font-semibold flex items-center gap-2 ${
          msg.includes("Erro") ? "bg-rose-500/15 border border-rose-500/30 text-rose-300" : "bg-emerald-500/15 border border-emerald-500/30 text-emerald-300"
        }`}>
          {msg.includes("Erro") ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
          <span>{msg}</span>
        </div>
      )}

      {/* CARD PRINCIPAL DE STATUS DO PIXEL DA META */}
      <section className="admin-card" style={{
        background: "linear-gradient(135deg, rgba(24, 119, 242, 0.12) 0%, rgba(15, 17, 26, 0.95) 100%)",
        border: "1px solid rgba(24, 119, 242, 0.35)",
        marginBottom: "16px",
        padding: "18px 20px"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <div style={{
              width: "44px",
              height: "44px",
              borderRadius: "12px",
              background: "#1877f2",
              display: "grid",
              placeItems: "center",
              fontSize: "22px",
              fontWeight: 900,
              color: "#fff",
              boxShadow: "0 4px 14px rgba(24, 119, 242, 0.4)"
            }}>
              f
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 800, color: "#fff" }}>Meta Pixel Oficial Conectado</h3>
                <span style={{
                  background: "rgba(52, 211, 153, 0.15)",
                  color: "#34d399",
                  border: "1px solid rgba(52, 211, 153, 0.3)",
                  fontSize: "10px",
                  fontWeight: 800,
                  padding: "2px 8px",
                  borderRadius: "6px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px"
                }}>
                  <Check size={11} /> ATIVO
                </span>
              </div>
              <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#94a3b8" }}>
                Pixel ID: <strong style={{ color: "#60a5fa", letterSpacing: "0.5px" }}>{form.metaPixelId || DEFAULT_META_PIXEL_ID}</strong>
                <button
                  onClick={() => handleCopy(form.metaPixelId || DEFAULT_META_PIXEL_ID, "pixelId")}
                  style={{ background: "transparent", border: "none", color: copiedText === "pixelId" ? "#34d399" : "#60a5fa", cursor: "pointer", marginLeft: "6px" }}
                  title="Copiar Pixel ID"
                >
                  {copiedText === "pixelId" ? <Check size={12} style={{ display: "inline" }} /> : <Copy size={12} style={{ display: "inline" }} />}
                </button>
                <span style={{ margin: "0 8px", color: "#475569" }}>•</span>
                Marcação de Venda (Purchase) automática em cada depósito aprovado.
              </p>
            </div>
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            <button
              className="admin-secondary"
              style={{ fontSize: "11px", padding: "6px 12px" }}
              onClick={() => triggerTestEvent("Purchase")}
              title="Dispara evento de teste de Venda (R$ 50,00)"
            >
              <DollarSign size={13} style={{ color: "#34d399" }} />
              <span>Testar Venda (Purchase)</span>
            </button>
            <button
              className="admin-secondary"
              style={{ fontSize: "11px", padding: "6px 12px" }}
              onClick={() => triggerTestEvent("CompleteRegistration")}
              title="Dispara evento de teste de Cadastro"
            >
              <Users size={13} style={{ color: "#60a5fa" }} />
              <span>Testar Cadastro</span>
            </button>
          </div>
        </div>
      </section>

      {/* DASHBOARD DE KPIS DE CONVERSÃO DE META ADS */}
      <div className="users-kpi-grid" style={{ marginBottom: "20px" }}>
        <div className="user-kpi-card" style={{ borderColor: "rgba(24, 119, 242, 0.3)" }}>
          <div className="kpi-head">
            <span style={{ color: "#60a5fa" }}>Cadastros Meta Ads</span>
            <Users size={16} style={{ color: "#1877f2" }} />
          </div>
          <strong style={{ color: "#60a5fa" }}>{totalUsers}</strong>
          <small style={{ color: "#93c5fd" }}>Jogadores vindos do Facebook/Instagram</small>
        </div>

        <div className="user-kpi-card emerald" style={{ borderColor: "rgba(52, 211, 153, 0.3)" }}>
          <div className="kpi-head">
            <span style={{ color: "#34d399" }}>Vendas Marcadas (Depósitos)</span>
            <TrendingUp size={16} style={{ color: "#34d399" }} />
          </div>
          <strong style={{ color: "#34d399" }}>{totalDepositors}</strong>
          <small style={{ color: "#a7f3d0" }}>Jogadores que realizaram depósito</small>
        </div>

        <div className="user-kpi-card gold" style={{ borderColor: "rgba(251, 191, 36, 0.3)" }}>
          <div className="kpi-head">
            <span style={{ color: "#fbbf24" }}>Faturamento em Vendas (R$)</span>
            <DollarSign size={16} style={{ color: "#fbbf24" }} />
          </div>
          <strong style={{ color: "#fbbf24" }}>{money(totalSales)}</strong>
          <small style={{ color: "#fef08a" }}>Volume total gerado pelos anúncios</small>
        </div>

        <div className="user-kpi-card rose" style={{ borderColor: "rgba(244, 63, 94, 0.3)" }}>
          <div className="kpi-head">
            <span style={{ color: "#f43f5e" }}>Taxa de Conversão</span>
            <Activity size={16} style={{ color: "#f43f5e" }} />
          </div>
          <strong style={{ color: "#f43f5e" }}>{convRate}%</strong>
          <small style={{ color: "#fecdd3" }}>Tíquete Médio: {money(avgTicket)}</small>
        </div>
      </div>

      {/* SEÇÃO 1: TABELA DE DESEMPENHO POR CAMPANHA */}
      <section className="admin-card" style={{ marginBottom: "20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 800, color: "#fff", display: "flex", alignItems: "center", gap: "8px" }}>
              <Megaphone size={15} style={{ color: "#1877f2" }} /> Campanhas Meta Ads Rastreadas (UTM Campaign)
            </h3>
            <p style={{ margin: "3px 0 0", fontSize: "11px", color: "#94a3b8" }}>
              Identificação automática da campanha via <code>utm_campaign</code> e <code>fbclid</code> na URL de entrada.
            </p>
          </div>
        </div>

        {analytics?.campaigns && analytics.campaigns.length > 0 ? (
          <div className="admin-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Campanha (utm_campaign)</th>
                  <th style={{ textAlign: "center" }}>Cadastros</th>
                  <th style={{ textAlign: "center" }}>Vendas (Depositantes)</th>
                  <th style={{ textAlign: "right" }}>Volume em Vendas</th>
                  <th style={{ textAlign: "right" }}>Conversão</th>
                </tr>
              </thead>
              <tbody>
                {analytics.campaigns.map((c: any, idx: number) => (
                  <tr key={idx}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{
                          width: "20px",
                          height: "20px",
                          borderRadius: "4px",
                          background: "rgba(24, 119, 242, 0.15)",
                          color: "#60a5fa",
                          display: "grid",
                          placeItems: "center",
                          fontSize: "10px",
                          fontWeight: 800
                        }}>
                          {idx + 1}
                        </span>
                        <strong style={{ color: "#fff", fontSize: "12px" }}>{c.campaign}</strong>
                      </div>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <span style={{ fontWeight: 700, color: "#60a5fa" }}>{c.users}</span>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <span style={{ fontWeight: 700, color: c.depositors > 0 ? "#34d399" : "#94a3b8" }}>
                        {c.depositors}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <span style={{ fontWeight: 700, color: "#fbbf24" }}>{money(c.salesVolume)}</span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <span style={{
                        padding: "2px 8px",
                        borderRadius: "6px",
                        fontSize: "11px",
                        fontWeight: 800,
                        background: c.conversionRate > 0 ? "rgba(52, 211, 153, 0.15)" : "rgba(255, 255, 255, 0.05)",
                        color: c.conversionRate > 0 ? "#34d399" : "#94a3b8"
                      }}>
                        {c.conversionRate}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "28px 10px", color: "#64748b", fontSize: "12px" }}>
            Nenhuma campanha com cadastros detectada ainda. Ao vincular links de anúncios com <code>?utm_source=facebook&utm_campaign=nome_da_campanha</code> ou com <code>fbclid</code>, as conversões serão agrupadas automaticamente aqui.
          </div>
        )}
      </section>

      {/* SEÇÃO 2: LISTAGEM DE CADASTROS VINDOS DE ADS DA META */}
      <section className="admin-card" style={{ marginBottom: "20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", marginBottom: "14px" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 800, color: "#fff", display: "flex", alignItems: "center", gap: "8px" }}>
              <Users size={15} style={{ color: "#60a5fa" }} /> Cadastros Rastreados de Anúncios da Meta ({filteredMetaUsers.length})
            </h3>
            <p style={{ margin: "3px 0 0", fontSize: "11px", color: "#94a3b8" }}>
              Rastreamento de jogadores que acessaram via Facebook/Instagram Ads antes de criar a conta.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{ position: "relative", minWidth: "240px" }}>
              <Search size={13} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#64748b" }} />
              <input
                type="text"
                value={searchFilter}
                onChange={e => setSearchFilter(e.target.value)}
                placeholder="Buscar por nome, e-mail ou campanha..."
                style={{
                  width: "100%",
                  padding: "7px 10px 7px 30px",
                  borderRadius: "8px",
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  color: "#fff",
                  fontSize: "11px"
                }}
              />
            </div>
          </div>
        </div>

        {filteredMetaUsers.length > 0 ? (
          <div className="admin-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Jogador</th>
                  <th>Contato</th>
                  <th>Campanha UTM</th>
                  <th>FBCLID (Click ID)</th>
                  <th style={{ textAlign: "center" }}>Venda (Depósito)</th>
                  <th style={{ textAlign: "right" }}>Total Vendas (R$)</th>
                  <th style={{ textAlign: "right" }}>Saldo Atual</th>
                </tr>
              </thead>
              <tbody>
                {filteredMetaUsers.map((u: any) => {
                  const isCopied = copiedText === u.uid;
                  return (
                    <tr key={u.uid}>
                      <td>
                        <div>
                          <b style={{ color: "#fff", fontSize: "12px" }}>{u.displayName}</b>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "2px" }}>
                            <span style={{
                              fontSize: "9px",
                              padding: "1px 5px",
                              borderRadius: "4px",
                              background: "rgba(24, 119, 242, 0.15)",
                              color: "#60a5fa",
                              fontWeight: 700
                            }}>
                              Meta Ads
                            </span>
                            <small style={{ color: "#64748b", fontSize: "10px" }}>
                              {u.createdAt ? fmtDate(u.createdAt) : "—"}
                            </small>
                          </div>
                        </div>
                      </td>

                      <td>
                        <div style={{ fontSize: "11px" }}>
                          <span style={{ color: "#cbd5e1" }}>{u.email || "Sem e-mail"}</span>
                          {u.phone && <div style={{ color: "#64748b", fontSize: "10px" }}>{u.phone}</div>}
                        </div>
                      </td>

                      <td>
                        <span style={{
                          padding: "2px 7px",
                          borderRadius: "5px",
                          background: "rgba(255, 255, 255, 0.05)",
                          border: "1px solid rgba(255, 255, 255, 0.08)",
                          color: "#94a3b8",
                          fontSize: "11px",
                          fontWeight: 600
                        }}>
                          {u.campaign || "Direto / Anúncio"}
                        </span>
                      </td>

                      <td>
                        {u.fbclid ? (
                          <button
                            type="button"
                            onClick={() => handleCopy(u.fbclid, u.uid)}
                            style={{
                              background: "transparent",
                              border: "none",
                              color: isCopied ? "#34d399" : "#60a5fa",
                              cursor: "pointer",
                              fontSize: "10px",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              maxWidth: "140px",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap"
                            }}
                            title={`FBCLID: ${u.fbclid}\nClique para copiar`}
                          >
                            <span>{u.fbclid.slice(0, 12)}…</span>
                            {isCopied ? <Check size={10} /> : <Copy size={10} />}
                          </button>
                        ) : (
                          <span style={{ color: "#475569", fontSize: "10px" }}>—</span>
                        )}
                      </td>

                      <td style={{ textAlign: "center" }}>
                        {u.hasDeposited || Number(u.totalDeposits || 0) > 0 ? (
                          <span style={{
                            padding: "3px 8px",
                            borderRadius: "6px",
                            background: "rgba(52, 211, 153, 0.15)",
                            color: "#34d399",
                            border: "1px solid rgba(52, 211, 153, 0.3)",
                            fontSize: "10px",
                            fontWeight: 800,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px"
                          }}>
                            <Check size={11} /> VENDA CONFIRMADA
                          </span>
                        ) : (
                          <span style={{
                            padding: "3px 8px",
                            borderRadius: "6px",
                            background: "rgba(148, 163, 184, 0.1)",
                            color: "#94a3b8",
                            fontSize: "10px",
                            fontWeight: 600
                          }}>
                            Aguardando Depósito
                          </span>
                        )}
                      </td>

                      <td style={{ textAlign: "right" }}>
                        <strong style={{ color: Number(u.totalDeposits || 0) > 0 ? "#fbbf24" : "#64748b", fontSize: "12px" }}>
                          {money(u.totalDeposits || 0)}
                        </strong>
                      </td>

                      <td style={{ textAlign: "right" }}>
                        <span style={{ color: "#34d399", fontSize: "12px", fontWeight: 700 }}>
                          {money(u.balance || 0)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "30px 10px", color: "#64748b", fontSize: "12px" }}>
            {searchFilter ? "Nenhum cadastro encontrado para a busca informada." : "Nenhum cadastro originado de Meta Ads registrado até o momento."}
          </div>
        )}
      </section>

      {/* SEÇÃO 3: FORMULÁRIOS DE INTEGRAÇÃO (META, TIKTOK, GOOGLE ADS) */}
      <div className="integration-grid">
        <section className="admin-card integration-card">
          <div className="integration-brand">
            <span className="meta-logo">f</span>
            <div>
              <h3>Meta Ads (Facebook & Instagram)</h3>
              <p>Meta Pixel ID & Conversions API</p>
            </div>
          </div>
          <label className="admin-field">
            <span>Pixel ID (Padrão: 1150103850693228)</span>
            <input
              value={form.metaPixelId || ""}
              onChange={e => set("metaPixelId", e.target.value)}
              placeholder="1150103850693228"
            />
          </label>
          <label className="admin-field">
            <span>Access Token (Meta Conversions API)</span>
            <input
              type="password"
              value={form.metaAccessToken || ""}
              onChange={e => set("metaAccessToken", e.target.value)}
              placeholder="EAAG..."
            />
          </label>
        </section>

        <section className="admin-card integration-card">
          <div className="integration-brand">
            <span className="tiktok-logo">TT</span>
            <div>
              <h3>TikTok Ads</h3>
              <p>Pixel + Events API</p>
            </div>
          </div>
          <label className="admin-field">
            <span>Pixel ID</span>
            <input
              value={form.tiktokPixelId || ""}
              onChange={e => set("tiktokPixelId", e.target.value)}
              placeholder="CXXXXXXXXXXXXXX"
            />
          </label>
          <label className="admin-field">
            <span>Events API Token</span>
            <input
              type="password"
              value={form.tiktokAccessToken || ""}
              onChange={e => set("tiktokAccessToken", e.target.value)}
            />
          </label>
        </section>

        <section className="admin-card integration-card">
          <div className="integration-brand">
            <span className="google-logo">G</span>
            <div>
              <h3>Google Ads</h3>
              <p>Google Tag & Rastreamento de Conversões</p>
            </div>
          </div>
          <label className="admin-field">
            <span>Google Ads ID</span>
            <input
              value={form.googleAdsId || ""}
              onChange={e => set("googleAdsId", e.target.value)}
              placeholder="AW-XXXXXXXXX"
            />
          </label>
          <div className="admin-form-grid">
            <label className="admin-field">
              <span>Label Cadastro</span>
              <input
                value={form.googleConversions?.SignUp || ""}
                onChange={e => conv("SignUp", e.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>Label Depósito (Venda)</span>
              <input
                value={form.googleConversions?.Deposit || ""}
                onChange={e => conv("Deposit", e.target.value)}
              />
            </label>
          </div>
        </section>
      </div>

      {/* SEÇÃO 4: EVENTOS PREPARADOS & TESTADOR AO VIVO */}
      <section className="admin-card tracking-events-card" style={{ marginTop: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 800, color: "#fff" }}>
              Testador de Eventos Meta Pixel em Tempo Real
            </h3>
            <p style={{ margin: "4px 0 0", fontSize: "11px", color: "#94a3b8" }}>
              Dispare eventos de teste diretamente deste painel para validar a recepção no Meta Events Manager.
            </p>
          </div>

          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            <button className="admin-secondary" onClick={() => triggerTestEvent("PageView")}>
              Disparar PageView
            </button>
            <button className="admin-secondary" onClick={() => triggerTestEvent("CompleteRegistration")}>
              Disparar CompleteRegistration
            </button>
            <button className="admin-secondary" onClick={() => triggerTestEvent("InitiateCheckout")}>
              Disparar InitiateCheckout
            </button>
            <button className="admin-primary" onClick={() => triggerTestEvent("Purchase")}>
              Disparar Purchase (Venda R$ 50)
            </button>
          </div>
        </div>

        <div style={{ marginTop: "14px" }}>
          <h4 style={{ margin: "0 0 6px", fontSize: "11px", color: "#64748b", textTransform: "uppercase" }}>Eventos Nativos Conectados:</h4>
          <div className="tracking-event-chips">
            {[
              { name: "PageView", desc: "Navegação entre páginas" },
              { name: "CompleteRegistration", desc: "Cadastro concluído" },
              { name: "InitiateCheckout", desc: "Abertura de modal de depósito" },
              { name: "AddPaymentInfo", desc: "Geração de chave PIX" },
              { name: "Purchase", desc: "Venda confirmada após depósito PIX" },
              { name: "ViewContent", desc: "Abertura de jogo" },
              { name: "Contact", desc: "Acesso ao suporte / WhatsApp" },
            ].map(x => (
              <span key={x.name} title={x.desc} style={{ cursor: "default" }}>
                <strong style={{ color: "#60a5fa" }}>{x.name}</strong> ({x.desc})
              </span>
            ))}
          </div>
        </div>

        {testEventsLog.length > 0 && (
          <div style={{ marginTop: "14px", background: "rgba(0, 0, 0, 0.4)", borderRadius: "8px", padding: "10px 12px", border: "1px solid rgba(255, 255, 255, 0.05)" }}>
            <div style={{ fontSize: "10px", fontWeight: 700, color: "#94a3b8", marginBottom: "6px" }}>Log de Testes Disparados nesta Sessão:</div>
            {testEventsLog.map((log, i) => (
              <div key={i} style={{ fontSize: "11px", display: "flex", gap: "8px", alignItems: "center", padding: "3px 0", borderBottom: i < testEventsLog.length - 1 ? "1px solid rgba(255, 255, 255, 0.03)" : "none" }}>
                <span style={{ color: "#64748b", fontFamily: "monospace" }}>[{log.time}]</span>
                <strong style={{ color: "#60a5fa" }}>{log.event}</strong>
                <span style={{ color: log.status.includes("SUCESSO") ? "#34d399" : "#fbbf24" }}>{log.status}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
