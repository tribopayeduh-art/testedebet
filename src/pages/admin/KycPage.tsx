import { useState, useEffect } from "react";
import {
  FileText, CheckCircle2, XCircle, AlertCircle, RefreshCw, X
} from "lucide-react";
import { adminApi } from "../../lib/adminApi";
import { PageTitle, Status, fmtDate } from "./AdminComponents";

export default function KycPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [filter, setFilter] = useState("PENDING");
  const [selected, setSelected] = useState<any>(null);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const d: any = await adminApi(`/api/admin/users?limit=100`);
      setUsers((d.users || []).filter((u: any) => Boolean(u.kycStatus || u.kycDocs || u.kycData)));
    } catch (e: any) { setMsg(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const visible = users.filter((u: any) => {
    if (filter === "ALL") return true;
    if (filter === "PENDING") return ["PENDING", "REVIEW", "NOT_STARTED"].includes(u.kycStatus) && (u.kycDocs?.front || u.kycData?.cpf);
    return u.kycStatus === filter;
  });

  return <>
    <PageTitle eyebrow="CONFORMIDADE & KYC" title="Validação de Identidade" text="Análise de documentos (RG/CNH), selfie, CPF e aprovação/rejeição com registro de auditoria." action={<button className="admin-primary" onClick={load}><RefreshCw size={15} /> Atualizar</button>} />
    <div className="admin-filter-row">
      {["PENDING", "APPROVED", "REJECTED", "ALL"].map(k => <button key={k} className={filter === k ? "active" : ""} onClick={() => setFilter(k)}>{k === "PENDING" ? "Pendentes" : k === "APPROVED" ? "Aprovados" : k === "REJECTED" ? "Rejeitados" : "Todos"}</button>)}
    </div>

    {loading && <div className="admin-inline-loader"><RefreshCw className="spin" size={14} /> Carregando lista...</div>}

    <div className="admin-card admin-table-wrap">
      <table>
        <thead><tr><th>Jogador</th><th>CPF / Documento</th><th>Documentos enviados</th><th>Status KYC</th><th>Data</th><th>Ação</th></tr></thead>
        <tbody>
          {visible.map((u: any) => (
            <tr key={u.uid}>
              <td><b>{u.displayName || "Jogador"}</b><small>{u.email || u.uid}</small></td>
              <td>{u.kycData?.cpf || u.cpf || "—"}</td>
              <td>
                <span className="kyc-doc-chips">
                  {u.kycDocs?.front && <span className="chip good">Frente</span>}
                  {u.kycDocs?.back && <span className="chip good">Verso</span>}
                  {u.kycDocs?.selfie && <span className="chip good">Selfie</span>}
                  {!u.kycDocs?.front && !u.kycDocs?.back && !u.kycDocs?.selfie && <span className="chip warn">Dados manuais</span>}
                </span>
              </td>
              <td><Status value={u.kycStatus || "NOT_STARTED"} /></td>
              <td>{fmtDate(u.kycUpdatedAt || u.createdAt)}</td>
              <td><button className="admin-primary" onClick={() => setSelected(u)}>Analisar</button></td>
            </tr>
          ))}
          {!visible.length && !loading && <tr><td colSpan={6} style={{ textAlign: "center", color: "#888" }}>Nenhum cadastro KYC encontrado neste filtro.</td></tr>}
        </tbody>
      </table>
    </div>

    {selected && <KycReview user={selected} close={() => setSelected(null)} onDone={() => { setSelected(null); load(); }} />}
    {msg && <div className="admin-message">{msg}</div>}
  </>;
}

function KycReview({ user, close, onDone }: any) {
  const [status, setStatus] = useState(user.kycStatus || "REVIEW");
  const [notes, setNotes] = useState(user.kycNotes || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const docs = user.kycDocs || {};
  const data = user.kycData || {};

  async function submit(newStatus: string) {
    setBusy(true); setError("");
    try {
      await adminApi(`/api/admin/users/${user.uid}`, {
        method: "PATCH",
        body: JSON.stringify({ kycStatus: newStatus, kycNotes: notes, kycReviewedAt: new Date().toISOString() })
      });
      onDone();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="admin-drawer-backdrop" onClick={close}>
      <aside className="admin-drawer kyc-drawer" onClick={e => e.stopPropagation()}>
        <div className="admin-drawer-head">
          <div><span>ANÁLISE DE DOCUMENTOS</span><h2>{user.displayName || "Jogador"}</h2><p>{user.email || user.uid}</p></div>
          <button onClick={close}><X /></button>
        </div>

        <div className="kyc-drawer-body">
          <div className="kyc-info-grid">
            <div><span>Nome Completo</span><b>{data.fullName || user.displayName || "—"}</b></div>
            <div><span>CPF</span><b>{data.cpf || user.cpf || "—"}</b></div>
            <div><span>Chave PIX</span><b>{data.payout?.pixKey || data.pixKey || user.pixKey || "—"}</b></div>
            <div><span>Instituição</span><b>{data.payout?.bankInstitution || data.bankInstitution || user.bankInstitution || "—"}</b></div>
          </div>

          <h3>Documentos Submetidos</h3>
          <div className="kyc-images-grid">
            <KycFile label="Frente do Documento (RG/CNH)" url={docs.front} />
            <KycFile label="Verso do Documento" url={docs.back} />
            <KycFile label="Selfie com Documento" url={docs.selfie} />
            <KycFile label="Comprovante de Residência" url={docs.proof} />
          </div>

          <label className="admin-field"><span>Parecer / Motivo da decisão</span><textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ex.: Documento legível, dados conferem com CPF..." /></label>

          {error && <div className="admin-error">{error}</div>}

          <div className="kyc-review-actions">
            <button className="admin-danger full" disabled={busy} onClick={() => submit("REJECTED")}><XCircle size={15} /> Rejeitar KYC</button>
            <button className="admin-secondary full" disabled={busy} onClick={() => submit("REVIEW")}><AlertCircle size={15} /> Pedir Revisão</button>
            <button className="admin-primary full" disabled={busy} onClick={() => submit("APPROVED")}><CheckCircle2 size={15} /> Aprovar KYC</button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function KycFile({ label, url }: { label: string; url?: string }) {
  const [zoom, setZoom] = useState(false);
  if (!url) return <div className="kyc-doc-slot empty"><span>{label}</span><small>Não enviado</small></div>;
  return (
    <div className="kyc-doc-slot">
      <span>{label}</span>
      <img src={url} alt={label} onClick={() => setZoom(true)} />
      <a href={url} target="_blank" rel="noreferrer"><FileText size={12} /> Abrir original</a>
      {zoom && (
        <div className="kyc-zoom-modal" onClick={() => setZoom(false)}>
          <img src={url} alt={label} />
        </div>
      )}
    </div>
  );
}
