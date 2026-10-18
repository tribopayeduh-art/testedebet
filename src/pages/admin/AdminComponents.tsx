import type { ReactNode } from "react";

export const money = (n: any) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(n || 0));

export const fmtDate = (v: any) => {
  try {
    const d = v?.seconds ? new Date(v.seconds * 1000) : new Date(v || Date.now());
    return d.toLocaleString("pt-BR");
  } catch {
    return "—";
  }
};

export function PageTitle({
  eyebrow,
  title,
  text,
  action,
}: {
  eyebrow: string;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="admin-page-title">
      <div>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {action}
    </div>
  );
}

export function Metric({ icon: Icon, label, value, hint }: any) {
  return (
    <div className="admin-metric">
      <div className="admin-metric-icon">
        <Icon size={19} />
      </div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

export function Status({ value,label }: { value: string;label?:string }) {
  const v = String(value || "UNKNOWN");
  const good = ["ACTIVE", "APPROVED", "PAID", "SUCCESS", "CLOSED", "ONLINE"].includes(v);
  const bad = ["BLOCKED", "REJECTED", "CANCELLED", "FAILED", "SUSPENDED"].includes(v);
  return <span className={`admin-status ${good ? "good" : bad ? "bad" : "warn"}`}>{label||v}</span>;
}

export function AdminError({ text, message }: { text?: string; message?: string }) {
  return <div className="admin-error">{text || message}</div>;
}

export function Empty({ text = "Sem registros." }: { text?: string }) {
  return <div className="admin-empty">{text}</div>;
}

export function SimpleTable({
  title,
  headers,
  rows,
}: {
  title: string;
  headers: string[];
  rows: any[][];
}) {
  return (
    <div className="admin-card admin-table-wrap">
      <h3>{title}</h3>
      <table>
        <thead>
          <tr>
            {headers.map((x) => (
              <th key={x}>{x}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>{String(c ?? "—")}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={headers.length}>Sem registros.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function AdminLazyFallback() {
  return (
    <div className="admin-loading-card" style={{ minHeight: "280px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px" }}>
      <div className="admin-inline-loader" style={{ fontSize: "14px", color: "var(--amora-primary, #00b85c)" }}>
        Carregando módulo...
      </div>
    </div>
  );
}
