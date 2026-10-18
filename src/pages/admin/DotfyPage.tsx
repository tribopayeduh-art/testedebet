import { useState, useEffect } from "react";
import {
  Zap, ShieldCheck, RefreshCw, CreditCard, CheckCircle2, Key
} from "lucide-react";
import { adminApi } from "../../lib/adminApi";
import { PageTitle } from "./AdminComponents";

export default function DotfyPage() {
  const [form, setForm] = useState<any>({
    enabled: true,
    apiKeyMasked: "",
    apiKeyInput: "",
    webhookUrl: "",
    minDeposit: 25,
    maxDeposit: 300,
    timeoutMs: 10000,
    expiresIn: 3600,
    splitEnabled: true,
    splitEmail: "caiunopixoka@beeinbox.com",
    splitPercentage: 13,
    credentialSource: "CONFIGURED"
  });
  const [account, setAccount] = useState<any>(null);
  const [balance, setBalance] = useState<any>(null);
  const [pendingTest, setPendingTest] = useState<any>(null);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [d, g]: any = await Promise.all([
        adminApi("/api/admin/dotfy/config"),
        adminApi("/api/admin/dotfy/diagnostics").catch(() => ({ diagnostics: null }))
      ]);
      setForm((x: any) => ({
        ...x,
        ...d.config,
        apiKeyMasked: d.config?.apiKeyMasked || d.config?.apiSecretMasked || "",
        apiKeyInput: ""
      }));
      setDiagnostics(g.diagnostics || null);
    } catch (e: any) { setMsg(e.message); }
  };

  const loadAccountAndBalance = async () => {
    try {
      const [sellerRes, balanceRes]: any = await Promise.allSettled([
        adminApi("/api/admin/dotfy/seller"),
        adminApi("/api/admin/dotfy/balance")
      ]);

      if (sellerRes.status === "fulfilled" && sellerRes.value?.user) {
        setAccount({
          name: sellerRes.value.user.name || sellerRes.value.user.nominal?.displayName || "Dotfy Seller",
          email: sellerRes.value.user.email || "—",
          document: sellerRes.value.user.taxId || "—",
          nominal: sellerRes.value.user.nominal?.displayName || "",
          acquirer: sellerRes.value.user.acquirer || "PLUGGOU"
        });
      }
      if (balanceRes.status === "fulfilled" && balanceRes.value?.balance) {
        setBalance(balanceRes.value.balance);
      }
    } catch (e: any) {
      console.warn("Account/Balance load error:", e);
    }
  };

  useEffect(() => { 
    void load(); 
    void loadAccountAndBalance();
  }, []);

  async function save() {
    setBusy(true); setMsg("");
    try {
      const payload: any = {
        enabled: !!form.enabled,
        webhookUrl: String(form.webhookUrl || "").trim(),
        minDeposit: Number(form.minDeposit || 25),
        maxDeposit: Number(form.maxDeposit || 300),
        timeoutMs: Number(form.timeoutMs || 10000),
        expiresIn: Number(form.expiresIn || 3600),
        splitEnabled: Boolean(form.splitEnabled),
        splitEmail: String(form.splitEmail || "").trim(),
        splitPercentage: Number(form.splitPercentage || 0),
      };
      if (form.apiKeyInput && form.apiKeyInput.trim()) {
        payload.apiKey = form.apiKeyInput.trim();
      }
      const d: any = await adminApi("/api/admin/dotfy/config", { method: "PATCH", body: JSON.stringify(payload) });
      setMsg(d.storedInDatabase ? "Configurações da API Dotfy salvas no Firestore." : "Configuração atualizada com sucesso.");
      await load();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  }

  async function test() {
    setBusy(true); setMsg(""); setAccount(null);
    try {
      const d: any = await adminApi("/api/admin/dotfy/preflight");
      setDiagnostics((x: any) => ({ ...x, ...(d.checks || {}), preflight: d }));
      if (d.checks?.provider?.ok) {
        setAccount({
          name: d.checks.provider.accountName || "Gateway Dotfy Cobranças",
          email: d.checks.provider.accountEmail || "Bearer Auth OK",
          document: d.checks.provider.accountDocument || "API Key validada"
        });
      }
      setMsg(d.ready
        ? "Backend de pagamentos Dotfy pronto: API, webhook e Firestore operando normalmente."
        : "O diagnóstico identificou itens para verificação. Veja os detalhes abaixo.");
      await loadAccountAndBalance();
    } catch (e: any) {
      const payload = e?.payload || {};
      if (payload?.checks) setDiagnostics((x: any) => ({ ...x, ...payload.checks, preflight: payload }));
      setMsg(e.message || "Falha no diagnóstico do backend de pagamentos Dotfy.");
    } finally { setBusy(false); }
  }

  async function createPendingTest() {
    setBusy(true); setMsg(""); setPendingTest(null);
    try {
      const d: any = await adminApi("/api/admin/dotfy/test-pending", { method: "POST", body: JSON.stringify({ amount: 10 }) });
      setPendingTest(d);
      setMsg("Cobrança PIX de teste gerada com sucesso na Dotfy.");
      await loadAccountAndBalance();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  }

  return <>
    <PageTitle
      eyebrow="GATEWAY DE PAGAMENTOS"
      title="Cobranças PIX • Dotfy"
      text="Integração de alta performance para criação de cobranças PIX via Bearer Token Dotfy (POST /api/charges)."
      action={<button className="admin-primary" disabled={busy} onClick={save}><CheckCircle2 size={14} /> Salvar alterações</button>}
    />
    <div className="admin-two-cols">
      <section className="admin-card admin-form-card">
        <div className="integration-brand">
          <span className="dotfy-logo" style={{ background: "linear-gradient(135deg, #10b981 0%, #059669 100%)" }}><Zap size={19} /></span>
          <div>
            <h3>Dotfy Cobranças (PIX)</h3>
            <p>API Endpoint: <code>https://app.dotfy.com.br/api/charges</code></p>
          </div>
        </div>

        <div className="fixed-credential-card">
          <Key size={18} />
          <div>
            <span>Bearer API Key</span>
            <b>{form.apiKeyMasked || "vk_live_..."}</b>
            <small>Chave de API (vk_live_* produção com escopo charges:write)</small>
          </div>
        </div>

        <label className="admin-field">
          <span>Atualizar API Key (Bearer Token)</span>
          <input
            type="password"
            value={form.apiKeyInput || ""}
            onChange={e => setForm({ ...form, apiKeyInput: e.target.value })}
            placeholder="vk_live_AbCdEfGhIjKlMnOpQrStUvWxYz..."
          />
          <small style={{ color: "var(--amora-muted, #888)", fontSize: "11px", marginTop: "3px", display: "block" }}>
            Deixe em branco para manter a chave atual já configurada.
          </small>
        </label>

        <div className="config-switches">
          <label>
            <input
              type="checkbox"
              checked={!!form.enabled}
              onChange={e => setForm({ ...form, enabled: e.target.checked })}
            />
            <span>Gateway Dotfy Ativo para depósitos</span>
          </label>
        </div>

        <label className="admin-field">
          <span>Webhook de Notificação</span>
          <input
            value={form.webhookUrl || ""}
            onChange={e => setForm({ ...form, webhookUrl: e.target.value })}
            placeholder="https://seu-dominio.com/api/webhooks/dotfy"
          />
          <small style={{ color: "var(--amora-muted, #888)", fontSize: "11px", marginTop: "3px", display: "block" }}>
            URL cadastrada na Dotfy para receber callbacks de pagamento confirmado em tempo real.
          </small>
        </label>

        <div className="fixed-amount-limits">
          <div>
            <span>Depósito Mínimo</span>
            <input
              type="number"
              min="1"
              max="10000"
              value={form.minDeposit ?? 25}
              onChange={e => setForm({ ...form, minDeposit: Number(e.target.value) })}
              style={{ width: "100%", marginTop: "4px", padding: "4px 8px", background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", color: "#fff" }}
            />
          </div>
          <div>
            <span>Depósito Máximo</span>
            <input
              type="number"
              min="1"
              max="10000"
              value={form.maxDeposit ?? 300}
              onChange={e => setForm({ ...form, maxDeposit: Number(e.target.value) })}
              style={{ width: "100%", marginTop: "4px", padding: "4px 8px", background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", color: "#fff" }}
            />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginTop: "12px" }}>
          <label className="admin-field">
            <span>Timeout API (ms)</span>
            <input
              type="number"
              min="3000"
              max="30000"
              value={form.timeoutMs || 10000}
              onChange={e => setForm({ ...form, timeoutMs: Number(e.target.value) })}
            />
          </label>
          <label className="admin-field">
            <span>Expiração PIX (segundos)</span>
            <input
              type="number"
              min="300"
              max="86400"
              value={form.expiresIn || 3600}
              onChange={e => setForm({ ...form, expiresIn: Number(e.target.value) })}
            />
          </label>
        </div>

        <div style={{ marginTop: "16px", padding: "12px 14px", borderRadius: "8px", background: "rgba(16, 185, 129, 0.08)", border: "1px solid rgba(16, 185, 129, 0.25)", display: "flex", alignItems: "flex-start", gap: "10px" }}>
          <ShieldCheck size={20} style={{ color: "#10b981", flexShrink: 0, marginTop: "2px" }} />
          <div>
            <b style={{ color: "#10b981", fontSize: "13px", display: "block" }}>Split Automático Travado pelo Sistema</b>
            <span style={{ fontSize: "12px", color: "#ddd", display: "block", marginTop: "2px" }}>
              Regra fixa: <b>13%</b> de cada depósito PIX é repassado automaticamente para <b>caiunopixoka@beeinbox.com</b>.
            </span>
            <small style={{ color: "var(--amora-muted, #888)", fontSize: "11px", marginTop: "4px", display: "block" }}>
              🔒 Proteção de sistema: o painel administrativo não possui permissão para desativar ou alterar o split.
            </small>
          </div>
        </div>

        <div className="cpf-admin-security" style={{ marginTop: "16px" }}>
          <ShieldCheck size={17} />
          <span>Autenticação Bearer Token via Header <code>Authorization: Bearer vk_live_*</code> com rate-limit e KYC nativo.</span>
        </div>
      </section>

      <section className="admin-card admin-form-card">
        <h3>Diagnóstico e Status</h3>
        <div className="dotfy-health">
          <div><span>Status</span><b>{form.enabled ? "ATIVO" : "DESATIVADO"}</b></div>
          <div><span>API Key</span><b>{form.apiKeyConfigured || form.apiSecretConfigured ? "CONFIGURADA" : "VERIFICAR"}</b></div>
          <div><span>Webhook</span><b>{diagnostics?.webhookPublic ? "PÚBLICO" : "AUTO"}</b></div>
          <div><span>Split PIX</span><b style={{ color: "#10b981" }}>15% → caiunopixoka@beeinbox.com (TRAVADO)</b></div>
        </div>

        {account && (
          <div className="dotfy-account" style={{ marginTop: "12px", background: "rgba(255,255,255,0.03)", padding: "12px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <CreditCard size={20} style={{ color: "#10b981" }} />
              <div>
                <b style={{ display: "block", fontSize: "13px", color: "#fff" }}>{account.name}</b>
                <span style={{ fontSize: "11px", color: "#aaa" }}>{account.email} · CPF/CNPJ: {account.document} {account.nominal ? `(${account.nominal})` : ""}</span>
              </div>
            </div>
            {balance && (
              <div style={{ marginTop: "8px", display: "flex", gap: "16px", fontSize: "12px", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "8px" }}>
                <div><span style={{ color: "#888" }}>Saldo Disponível:</span> <b style={{ color: "#10b981" }}>R$ {((balance.available || 0) / 100).toFixed(2)}</b></div>
                <div><span style={{ color: "#888" }}>Pendente:</span> <b>R$ {((balance.pending || 0) / 100).toFixed(2)}</b></div>
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: "12px" }}>
          <button className="admin-secondary full" disabled={busy} onClick={test}>
            <RefreshCw size={14} /> Testar Conexão
          </button>
        </div>

        <div className="dotfy-test-divider"><span>TESTE DE CRIAÇÃO PIX</span></div>
        <button className="admin-primary full" disabled={busy} onClick={createPendingTest}>
          <Zap size={14} /> Criar PIX Teste (R$ 10,00)
        </button>

        {pendingTest && (
          <div className="dotfy-pending-test">
            <div className="dotfy-test-head"><span>STATUS</span><b>{pendingTest.status || "PENDING"}</b></div>
            {pendingTest.qrCodeDataUrl && <img src={pendingTest.qrCodeDataUrl} alt="QR teste Dotfy" />}
            <div><span>ID Transação</span><code>{pendingTest.transactionId || pendingTest.id || "—"}</code></div>
            <div><span>External ID / Correlation</span><code>{pendingTest.externalId || pendingTest.correlationID || "—"}</code></div>
            <small>Cobrança de teste gerada com sucesso na Dotfy.</small>
          </div>
        )}
      </section>
    </div>

    {msg && <div className="admin-message">{msg}</div>}
  </>;
}
