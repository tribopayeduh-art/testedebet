import { useState, useEffect } from "react";
import { adminApi } from "../../lib/adminApi";
import { PageTitle } from "./AdminComponents";

export default function ExperimentsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [f, setF] = useState<any>({
    name: "", type: "VISUAL", trigger: "SECRET_CLICK", rewardType: "BADGE",
    rewardValue: "", maxActivations: 0, cooldownMinutes: 60, message: ""
  });

  const load = () => adminApi<any>("/api/admin/experiments").then(d => setItems(d.items || [])).catch(() => {});
  useEffect(() => { void load(); }, []);

  async function create() {
    try {
      await adminApi("/api/admin/experiments", { method: "POST", body: JSON.stringify(f) });
      setF({ ...f, name: "", message: "" });
      await load();
    } catch { }
  }

  async function toggle(x: any) {
    try {
      await adminApi(`/api/admin/experiments/${x.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !x.enabled }) });
      await load();
    } catch { }
  }

  return <>
    <PageTitle eyebrow="EXPERIMENTOS" title="Easter Eggs & Experimentos" text="Efeitos visuais, badges, missões e recompensas legítimas sem alterar resultados de jogos." />
    <div className="admin-two-cols unequal">
      <section className="admin-card admin-form-card">
        <h3>Novo experimento</h3>
        <label className="admin-field"><span>Nome</span><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
        <div className="admin-form-grid">
          <label className="admin-field"><span>Tipo</span><select value={f.type} onChange={e => setF({ ...f, type: e.target.value })}><option>VISUAL</option><option>MISSION</option><option>SECRET</option><option>THEME</option></select></label>
          <label className="admin-field"><span>Gatilho</span><select value={f.trigger} onChange={e => setF({ ...f, trigger: e.target.value })}><option>SECRET_CLICK</option><option>LOGIN_STREAK</option><option>VISIT_SECTION</option><option>SCHEDULE</option></select></label>
        </div>
        <label className="admin-field"><span>Recompensa</span><select value={f.rewardType} onChange={e => setF({ ...f, rewardType: e.target.value })}><option>NONE</option><option>BADGE</option><option>XP</option><option>AVATAR</option><option>THEME</option><option>COUPON</option></select></label>
        <label className="admin-field"><span>Valor/identificador</span><input value={f.rewardValue} onChange={e => setF({ ...f, rewardValue: e.target.value })} /></label>
        <label className="admin-field"><span>Mensagem</span><textarea value={f.message} onChange={e => setF({ ...f, message: e.target.value })} /></label>
        <button className="admin-primary full" onClick={create}>Criar experimento</button>
      </section>
      <section className="admin-card">
        <h3>Experimentos</h3>
        <div className="experiment-list">
          {items.map(x => (
            <div key={x.id}>
              <span><b>{x.name}</b><small>{x.type} · {x.trigger} · {x.rewardType}</small></span>
              <button onClick={() => toggle(x)}>{x.enabled ? "Desativar" : "Ativar"}</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  </>;
}
