import { useState, useEffect } from "react";
import {
  Wifi, WifiOff, QrCode, ShieldAlert, ShieldCheck, RefreshCw, Send
} from "lucide-react";
import { adminApi } from "../../lib/adminApi";
import { PageTitle, Metric, Status } from "./AdminComponents";

export default function WhatsAppPage() {
  const [status, setStatus] = useState<any>({ status: "DISCONNECTED", connected: false });
  const [diag, setDiag] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ title: "", text: "", audience: "OPTED_IN", delayMs: 1500 });
  const [test, setTest] = useState({ phone: "", text: "Olá! Esta é uma mensagem de teste da Canário Bet." });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [s, c, d]: any = await Promise.all([
        adminApi("/api/admin/whatsapp/status"),
        adminApi("/api/admin/whatsapp/campaigns"),
        adminApi("/api/admin/whatsapp/diagnostics")
      ]);
      setStatus(s); setItems(c.campaigns || []); setDiag(d.diagnostics || null);
    } catch (e: any) { setMsg(e.message); }
  };

  useEffect(() => {
    load();
    const i = setInterval(load, 1800);
    return () => clearInterval(i);
  }, []);

  async function connect() {
    setBusy(true); setMsg("Inicializando Baileys e aguardando QR Code...");
    try {
      const d: any = await adminApi("/api/admin/whatsapp/connect", { method: "POST" });
      setStatus(d);
      setMsg(d.qrDataUrl ? "QR Code gerado. Escaneie com o WhatsApp." : d.connected ? "WhatsApp conectado." : "Conexão iniciada. O painel atualizará automaticamente.");
      await load();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  }

  async function regenerate() {
    setBusy(true); setMsg("Limpando sessão anterior e gerando um QR novo...");
    try {
      const d: any = await adminApi("/api/admin/whatsapp/regenerate-qr", { method: "POST" });
      setStatus(d);
      setMsg(d.qrDataUrl ? "Novo QR Code gerado." : "Solicitação enviada; aguardando QR Code.");
      await load();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  }

  async function disconnect(clearAuth = false) {
    setBusy(true);
    try {
      await adminApi("/api/admin/whatsapp/disconnect", { method: "POST", body: JSON.stringify({ clearAuth }) });
      setMsg(clearAuth ? "Sessão e autenticação removidas." : "WhatsApp desconectado.");
      await load();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  }

  async function sendTest() { try { await adminApi("/api/admin/whatsapp/test", { method: "POST", body: JSON.stringify(test) }); setMsg("Mensagem de teste enviada."); } catch (e: any) { setMsg(e.message); } }
  async function create() { try { await adminApi("/api/admin/whatsapp/campaigns", { method: "POST", body: JSON.stringify(form) }); setForm({ ...form, title: "", text: "" }); load(); } catch (e: any) { setMsg(e.message); } }
  async function send(id: string) { if (!confirm("Enviar para usuários com opt-in de WhatsApp?")) return; try { const d: any = await adminApi(`/api/admin/whatsapp/campaigns/${id}/send`, { method: "POST" }); setMsg(`Disparo iniciado para ${d.recipientCount} contatos com consentimento.`); load(); } catch (e: any) { setMsg(e.message); } }

  const qrReady = Boolean(status.qrDataUrl);
  const netlifyMode = Boolean(status.netlify || diag?.platform === "NETLIFY_FUNCTIONS");
  const statusTone = netlifyMode ? "error" : status.connected ? "connected" : qrReady ? "qr" : status.status === "ERROR" || status.status === "LOGGED_OUT" ? "error" : "waiting";

  return <>
    <PageTitle eyebrow="CRM & MENSAGERIA" title="WhatsApp • Baileys" text="Central de conexão, QR Code, diagnóstico, testes e campanhas com opt-in." action={<div className="wa-top-actions">
      {status.connected
        ? <button className="admin-secondary" disabled={busy || netlifyMode} onClick={() => disconnect(false)}><WifiOff size={14} /> Desconectar</button>
        : <button className="admin-primary" disabled={busy || netlifyMode} onClick={connect}><Wifi size={14} /> {netlifyMode ? "Backend dedicado" : "Conectar"}</button>}
      <button className="admin-secondary" disabled={busy || netlifyMode} onClick={regenerate}><QrCode size={14} /> Gerar novo QR</button>
    </div>} />

    <div className={`wa-connection-hero ${statusTone}`}>
      <div className="wa-connection-icon">{status.connected ? <Wifi size={25} /> : qrReady ? <QrCode size={25} /> : statusTone === "error" ? <ShieldAlert size={25} /> : <RefreshCw size={25} />}</div>
      <div className="wa-connection-copy">
        <span>STATUS DA SESSÃO</span>
        <h3>{netlifyMode ? "Baileys requer backend persistente" : status.connected ? "WhatsApp conectado" : qrReady ? "QR Code pronto para escanear" : status.status === "ERROR" ? "Falha ao iniciar Baileys" : status.status === "LOGGED_OUT" ? "Sessão desconectada pelo WhatsApp" : "Preparando conexão"}</h3>
        <p>{netlifyMode ? "A Canário Bet está rodando em Netlify Functions. O restante do painel funciona normalmente, mas a sessão WebSocket do Baileys precisa ficar em um servidor/VPS permanente." : status.connected ? "A sessão está pronta para mensagens de teste e campanhas." : qrReady ? "Abra o WhatsApp no celular → Dispositivos conectados → Conectar dispositivo." : status.lastError || "Clique em Conectar ou Gerar novo QR. O QR pode levar alguns segundos."}</p>
      </div>
      <Status value={status.connected ? "ONLINE" : qrReady ? "QR_READY" : status.status || "DISCONNECTED"} />
    </div>

    {netlifyMode && <section className="admin-card wa-netlify-note">
      <ShieldAlert size={24} />
      <div><span>NETLIFY SERVERLESS</span><h3>WhatsApp isolado sem quebrar o painel</h3><p>Netlify Functions não mantém uma conexão Baileys aberta entre requisições. Para QR e disparos contínuos, aponte este módulo para um backend persistente ou migre para a API oficial do WhatsApp.</p></div>
    </section>}

    <div className="wa-status-grid">
      <Metric icon={status.connected ? Wifi : QrCode} label="Conexão" value={status.status || "—"} hint={status.qrUpdatedAt ? `QR ${new Date(status.qrUpdatedAt).toLocaleTimeString("pt-BR")}` : "Sessão Baileys"} />
      <Metric icon={RefreshCw} label="Tentativas" value={status.connectionAttempts || 0} hint={status.baileysVersion ? `Baileys ${status.baileysVersion}` : "Versão automática"} />
      <Metric icon={Send} label="Campanhas" value={items.length} hint={`${items.filter(x => x.status === "FINISHED").length} finalizadas`} />
      <Metric icon={ShieldCheck} label="Audiência" value="OPT-IN" hint="Envio somente com consentimento" />
    </div>

    {qrReady && <section className="admin-card wa-qr wa-qr-premium">
      <div className="wa-qr-copy">
        <span>QR CODE ATIVO</span>
        <h3>Escaneie para vincular o WhatsApp</h3>
        <ol><li>Abra o WhatsApp no celular.</li><li>Entre em <b>Dispositivos conectados</b>.</li><li>Toque em <b>Conectar dispositivo</b>.</li><li>Aponte a câmera para este QR.</li></ol>
        <small>O QR é temporário. Se expirar, clique em “Gerar novo QR”.</small>
      </div>
      <div className="wa-qr-frame"><img src={status.qrDataUrl} alt="QR Code WhatsApp" /></div>
    </section>}

    {!netlifyMode && !qrReady && !status.connected && <section className="admin-card wa-no-qr">
      <div><QrCode size={30} /><h3>QR ainda não disponível</h3><p>Se o status ficar parado em CONNECTING, use <b>Gerar novo QR</b>. Esse botão remove uma sessão de autenticação antiga e inicia um pareamento limpo.</p></div>
      <button className="admin-primary" disabled={busy} onClick={regenerate}>GERAR QR NOVO</button>
    </section>}

    <div className="admin-two-cols">
      <section className="admin-card admin-form-card">
        <h3>Nova campanha</h3>
        <label className="admin-field"><span>Nome interno</span><input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
        <label className="admin-field"><span>Mensagem</span><textarea rows={7} value={form.text} onChange={e => setForm({ ...form, text: e.target.value })} placeholder="Mensagem enviada apenas a contatos com opt-in." /></label>
        <label className="admin-field"><span>Intervalo entre mensagens (ms)</span><input type="number" min="1000" value={form.delayMs} onChange={e => setForm({ ...form, delayMs: Number(e.target.value) })} /></label>
        <div className="wa-consent-note"><ShieldCheck size={16} /><span>O backend seleciona somente usuários com <code>whatsappOptIn = true</code> e telefone cadastrado.</span></div>
        <button className="admin-primary full" onClick={create}>Salvar campanha</button>
      </section>

      <section className="admin-card admin-form-card">
        <h3>Teste & diagnóstico</h3>
        <label className="admin-field"><span>Telefone</span><input value={test.phone} onChange={e => setTest({ ...test, phone: e.target.value })} placeholder="11999999999" /></label>
        <label className="admin-field"><span>Mensagem</span><textarea value={test.text} onChange={e => setTest({ ...test, text: e.target.value })} /></label>
        <button className="admin-secondary full" disabled={!status.connected || netlifyMode} onClick={sendTest}>Enviar mensagem de teste</button>

        <div className="wa-diagnostics">
          <div><span>Node</span><b>{diag?.node || "—"}</b></div>
          <div><span>Auth persistido</span><b>{status.authExists ? "SIM" : "NÃO"}</b></div>
          <div><span>Baileys</span><b>{status.baileysVersion || "automático"}</b></div>
          <div><span>Auth dir</span><b title={diag?.authDir}>{diag?.authDir ? String(diag.authDir).split(/[\/]/).slice(-2).join("/") : "—"}</b></div>
        </div>
        {status.lastError && <div className="admin-error wa-error"><b>Último erro</b><span>{status.lastError}</span></div>}
        <button className="admin-danger full" disabled={busy || netlifyMode} onClick={() => disconnect(true)}>Limpar sessão e autenticação</button>
        <p className="admin-help">Baileys usa WhatsApp Web e não é a API oficial WhatsApp Business Platform. Para produção em grande escala, considere também a API oficial.</p>
      </section>
    </div>

    <div className="admin-card admin-table-wrap">
      <div className="finance-card-head"><div><span>CAMPANHAS</span><h3>Histórico de disparos</h3></div><button className="admin-secondary" onClick={load}><RefreshCw size={13} /> Atualizar</button></div>
      <table><thead><tr><th>Campanha</th><th>Status</th><th>Destinatários</th><th>Enviadas</th><th>Falhas</th><th></th></tr></thead><tbody>{items.map(x => <tr key={x.id}><td><b>{x.title}</b><small>{String(x.text || "").slice(0, 70)}</small></td><td><Status value={x.status} /></td><td>{x.recipientCount || "—"}</td><td>{x.sent || 0}</td><td>{x.failed || 0}</td><td><button className="admin-secondary" disabled={!status.connected || x.status === "SENDING"} onClick={() => send(x.id)}>Disparar</button></td></tr>)}</tbody></table>
    </div>
    {msg && <div className="admin-message">{msg}</div>}
  </>;
}
