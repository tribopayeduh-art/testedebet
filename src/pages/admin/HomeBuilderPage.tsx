import { useState, useEffect } from "react";
import { adminApi } from "../../lib/adminApi";
import { PageTitle } from "./AdminComponents";

export default function HomeBuilderPage() {
  const defaultSections = [
    "BANNER", "CATEGORIES", "FEATURED", "WINNERS", "PRAGMATIC_LIVE", "MOST_PLAYED",
    "FAST_GAMES", "NEW_RELEASES", "PROMO_BANNER", "SLOTS", "LIVE_CASINO", "PROVIDERS",
    "PLAYZADA_CLUB", "AFFILIATE", "RESPONSIBLE", "POPULAR"
  ];
  const [sections, setSections] = useState<string[]>(defaultSections);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    adminApi<any>("/api/admin/home-layout")
      .then(d => d.layout?.length && setSections(d.layout))
      .catch(() => {});
  }, []);

  const move = (i: number, d: number) => {
    const n = [...sections];
    const j = i + d;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j], n[i]];
    setSections(n);
  };

  async function save() {
    try {
      await adminApi("/api/admin/home-layout", { method: "PATCH", body: JSON.stringify({ sections }) });
      setMsg("Ordem da Home salva.");
    } catch (e: any) {
      setMsg(e?.message || "");
    }
  }

  return (
    <>
      <PageTitle
        eyebrow="LAYOUT"
        title="Home Builder"
        text="Defina a ordem lógica das seções da página inicial."
        action={<button className="admin-primary" onClick={save}>Salvar ordem</button>}
      />
      <div className="admin-card home-builder-list">
        {sections.map((x, i) => (
          <div key={x}>
            <span>
              <b>{i + 1}</b>
              <strong>{x}</strong>
            </span>
            <div>
              <button onClick={() => move(i, -1)}>↑</button>
              <button onClick={() => move(i, 1)}>↓</button>
            </div>
          </div>
        ))}
      </div>
      {msg && <div className="admin-message">{msg}</div>}
    </>
  );
}
